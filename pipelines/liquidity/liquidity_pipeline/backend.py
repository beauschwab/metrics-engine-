"""The execution seam: one narrow interface, two engines.

Everything downstream of landing — contract checks, rules application, the
LCR, the report — is expressed as SQL against tables, and this module is the
only place that knows *which* engine runs it. The product target is PySpark
over Iceberg; development and CI run DuckDB over one warehouse file. The
interface is kept narrow on purpose: if a method here needs an engine-specific
caller, the portability story is already broken.

  raw       landed extracts, strings exactly as the file arrived
  alm       the conformed layer dbt builds (fct_2052a_positions, …)
  reg       what the pipeline files (fr2052a_daily, lcr_daily)

``for_target()`` picks the backend from LIQ_TARGET, so the DAG, dbt and the
tests all switch together.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Protocol

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
# PySpark + Iceberg — the product engine
# ---------------------------------------------------------------------------

class SparkIcebergBackend:
    """The prod backend: Spark SQL against an Iceberg catalog.

    Assumes a session whose default catalog is the Iceberg one (REST or Glue),
    configured outside this module — on the Airflow worker image, or by
    ``spark-submit --conf spark.sql.catalog...``. The pipeline's SQL is engine
    -portable by construction; what differs is only landing (external tables
    over the object-store paths the contracts name) and the partition write,
    which Iceberg's INSERT OVERWRITE handles natively in dynamic mode.

    Not exercised by the local e2e run — DuckDB is the dev engine — but kept
    to the same Protocol so switching is LIQ_TARGET=spark, not a rewrite.
    """

    dialect = "spark"

    def __init__(self, spark=None):
        if spark is None:
            from pyspark.sql import SparkSession

            spark = (
                SparkSession.builder.appName("daily_liquidity_position")
                .config("spark.sql.sources.partitionOverwriteMode", "dynamic")
                .getOrCreate()
            )
        self.spark = spark
        for schema in SCHEMAS:
            self.spark.sql(f"CREATE NAMESPACE IF NOT EXISTS {schema}")

    def sql(self, query: str) -> list[tuple]:
        return [tuple(r) for r in self.spark.sql(query).collect()]

    def scalar(self, query: str) -> Any:
        rows = self.spark.sql(query).collect()
        return rows[0][0] if rows else None

    def columns(self, table: str) -> list[str]:
        return self.spark.table(table).columns

    def land_csv(self, table: str, path: Path) -> int:
        df = (
            self.spark.read.option("header", True)
            .option("inferSchema", False)  # strings, same as dev: contract casts later
            .csv(str(path))
        )
        df.writeTo(table).using("iceberg").createOrReplace()
        return self.spark.table(table).count()

    def overwrite_partition(self, table: str, partition_col: str, value: str,
                            select_sql: str) -> int:
        df = self.spark.sql(select_sql)
        if not self.spark.catalog.tableExists(table):
            df.writeTo(table).using("iceberg").partitionedBy(partition_col).create()
        else:
            # Dynamic partition overwrite: only the partitions present in the
            # select are replaced — the daily idempotency contract.
            df.writeTo(table).overwritePartitions()
        return self.spark.sql(
            f"SELECT count(*) FROM {table} WHERE {partition_col} = DATE '{value}'"
        ).collect()[0][0]

    def close(self) -> None:
        pass  # the session belongs to the worker, not to one task


def for_target(target: str | None = None) -> Backend:
    which = target or config.target()
    if which == "duckdb":
        return DuckDBBackend()
    if which == "spark":
        return SparkIcebergBackend()
    raise ValueError(f"unknown LIQ_TARGET {which!r} — duckdb or spark")
