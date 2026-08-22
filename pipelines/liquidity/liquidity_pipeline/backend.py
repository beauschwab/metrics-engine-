"""The execution seam: one narrow interface, two engines.

Everything downstream of landing — contract checks, rules application, the
LCR, the report — is expressed as SQL against tables, and this module is the
only place that knows *which* engine runs it. The product target is Spark
over Iceberg **reached through Apache Kyuubi**; development and CI run DuckDB
over one warehouse file. The interface is kept narrow on purpose: if a method
here needs an engine-specific caller, the portability story is already
broken — and Kyuubi enforces that at the protocol level, since a SQL gateway
accepts nothing but SQL.

  raw       landed extracts, strings exactly as the file arrived
  alm       the conformed layer dbt builds (fct_2052a_positions, …)
  reg       what the pipeline files (fr2052a_daily, lcr_daily)

``for_target()`` picks the backend from LIQ_TARGET, so the DAG, dbt and the
tests all switch together.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Protocol

from . import config

SCHEMAS = ["raw", "alm", "reg"]


class Backend(Protocol):
    dialect: str

    def sql(self, query: str) -> list[tuple]: ...
    def scalar(self, query: str) -> Any: ...
    def columns(self, table: str) -> list[str]: ...
    def land_csv(self, table: str, path: Path) -> int:
        """Load one extract into a raw table, every column as a string."""
        ...
    def overwrite_partition(self, table: str, partition_col: str, value: str,
                            select_sql: str) -> int:
        """Idempotent daily write: replace one partition, never the table."""
        ...
    def close(self) -> None: ...


# ---------------------------------------------------------------------------
# DuckDB — the dev engine
# ---------------------------------------------------------------------------

class DuckDBBackend:
    dialect = "duckdb"

    def __init__(self, db_path: Path | None = None):
        import duckdb

        self.path = Path(db_path or config.warehouse_path())
        self.con = duckdb.connect(str(self.path))
        for schema in SCHEMAS:
            self.con.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")

    def sql(self, query: str) -> list[tuple]:
        return self.con.execute(query).fetchall()

    def scalar(self, query: str) -> Any:
        row = self.con.execute(query).fetchone()
        return row[0] if row else None

    def columns(self, table: str) -> list[str]:
        self.con.execute(f"SELECT * FROM {table} LIMIT 0")
        return [d[0] for d in self.con.description]

    def land_csv(self, table: str, path: Path) -> int:
        # all_varchar: the raw layer holds what the producer sent. Casting
        # before the contract has checked castability would turn a producer's
        # bad field into a loader crash with no named culprit.
        self.con.execute(f"DROP TABLE IF EXISTS {table}")
        self.con.execute(
            f"CREATE TABLE {table} AS SELECT * FROM read_csv(?, all_varchar=true, header=true)",
            [str(path)],
        )
        return self.con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]

    def overwrite_partition(self, table: str, partition_col: str, value: str,
                            select_sql: str) -> int:
        exists = self.con.execute(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
            table.split("."),
        ).fetchone()[0]
        if exists:
            self.con.execute(f"DELETE FROM {table} WHERE {partition_col} = DATE '{value}'")
            self.con.execute(f"INSERT INTO {table} BY NAME ({select_sql})")
        else:
            self.con.execute(f"CREATE TABLE {table} AS {select_sql}")
        return self.con.execute(
            f"SELECT count(*) FROM {table} WHERE {partition_col} = DATE '{value}'"
        ).fetchone()[0]

    def close(self) -> None:
        self.con.close()


# ---------------------------------------------------------------------------
# Spark over Iceberg, through Apache Kyuubi — the product engine
# ---------------------------------------------------------------------------

class KyuubiSparkBackend:
    """The prod backend: Spark SQL over Kyuubi's HiveServer2-compatible Thrift.

    In production nothing in this pipeline owns a SparkSession. Kyuubi is the
    multi-tenant gateway in front of the Spark fleet: the pipeline connects as
    a service user (engine share level and pooling are Kyuubi's, configured
    server-side), submits SQL, and disconnects. Two consequences shape this
    class:

      * SQL only. The compiled plans, the rules CASE chain, the LCR and the
        contract checks are already SQL, so nothing is lost — and there is no
        DataFrame API to be tempted by.
      * The Iceberg catalog is *engine* configuration, not client
        configuration: ``spark.sql.catalog.*`` lives in kyuubi-defaults.conf
        (or the engine's spark-defaults), and the client sees Iceberg tables
        as plain names. The one session-scoped setting the pipeline needs —
        dynamic partition overwrite — rides the connection's configuration
        overlay, which Kyuubi forwards to the engine it launches or reuses.

    Landing through a gateway means DDL over shared storage, not upload: the
    raw table is declared as an external CSV table over the object-store
    location the contract's ``servers`` block names (string-typed, header
    row, same shape as the DuckDB loader produces). A local path only works
    when the engine shares the filesystem — a dev nicety, not the contract.

    dbt reaches the same gateway via ``method: thrift`` in profiles.yml, so
    conformance and the pipeline's own SQL run on the same engines under the
    same service identity.

    Connection settings come from KYUUBI_HOST / KYUUBI_PORT (default 10009) /
    KYUUBI_USER; authentication (LDAP, Kerberos) is deployment-specific and
    belongs on the connection kwargs where the worker image configures it.
    Not exercised by the local e2e run — DuckDB is the dev engine — but held
    to the same Protocol, and its emitted SQL is pinned by unit tests against
    a stub connection.
    """

    dialect = "spark"

    def __init__(self, connection=None, host: str | None = None,
                 port: int | None = None, user: str | None = None):
        if connection is None:
            from pyhive import hive  # part of the `prod` extra

            connection = hive.Connection(
                host=host or os.environ.get("KYUUBI_HOST", "localhost"),
                port=port or int(os.environ.get("KYUUBI_PORT", "10009")),
                username=user or os.environ.get("KYUUBI_USER", "liquidity-pipeline"),
                configuration={
                    # Only touched partitions are replaced on INSERT OVERWRITE —
                    # the sub-partition idempotency contract.
                    "spark.sql.sources.partitionOverwriteMode": "dynamic",
                    # Names the workload in Kyuubi's session listing.
                    "kyuubi.session.name": "daily_liquidity_position",
                },
            )
        self.con = connection
        for schema in SCHEMAS:
            self._execute(f"CREATE NAMESPACE IF NOT EXISTS {schema}")

    def _execute(self, query: str):
        cursor = self.con.cursor()
        cursor.execute(query)
        return cursor

    def sql(self, query: str) -> list[tuple]:
        return [tuple(r) for r in self._execute(query).fetchall()]

    def scalar(self, query: str) -> Any:
        rows = self._execute(query).fetchall()
        return rows[0][0] if rows else None

    def columns(self, table: str) -> list[str]:
        cursor = self._execute(f"SELECT * FROM {table} LIMIT 0")
        # HiveServer2 metadata may qualify names as "table.column".
        return [d[0].split(".")[-1] for d in cursor.description]

    def land_csv(self, table: str, path: Path) -> int:
        self._execute(f"DROP TABLE IF EXISTS {table}")
        self._execute(
            f"CREATE TABLE {table} "
            f"USING csv OPTIONS (path '{path}', header 'true', inferSchema 'false')"
        )
        return int(self.scalar(f"SELECT count(*) FROM {table}"))

    def overwrite_partition(self, table: str, partition_col: str, value: str,
                            select_sql: str) -> int:
        schema, name = table.split(".")
        exists = bool(self.sql(f"SHOW TABLES IN {schema} LIKE '{name}'"))
        if exists:
            # Iceberg + dynamic overwrite: only the partitions present in the
            # select are replaced — the daily idempotency contract.
            self._execute(f"INSERT OVERWRITE {table} {select_sql}")
        else:
            self._execute(
                f"CREATE TABLE {table} USING iceberg "
                f"PARTITIONED BY ({partition_col}) AS {select_sql}"
            )
        return int(self.scalar(
            f"SELECT count(*) FROM {table} WHERE {partition_col} = DATE '{value}'"
        ))

    def close(self) -> None:
        self.con.close()


def for_target(target: str | None = None) -> Backend:
    which = target or config.target()
    if which == "duckdb":
        return DuckDBBackend()
    if which == "spark":
        return KyuubiSparkBackend()
    raise ValueError(f"unknown LIQ_TARGET {which!r} — duckdb or spark")
