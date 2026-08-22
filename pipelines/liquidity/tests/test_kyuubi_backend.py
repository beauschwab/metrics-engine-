"""The Kyuubi backend's SQL contract, pinned against a stub connection.

The prod backend is a SQL client of a gateway — there is no cluster in CI,
but the *statements* it would submit are the whole behavior, so they are
asserted here: namespace bootstrap, string-typed external landing, Iceberg
DDL on first write, and INSERT OVERWRITE (dynamic partition mode riding the
session configuration) on every write after.
"""

from __future__ import annotations

from liquidity_pipeline.backend import KyuubiSparkBackend


class StubCursor:
    def __init__(self, log, results):
        self.log = log
        self.results = results
        self.description = [("t.col_a",), ("col_b",)]

    def execute(self, query):
        self.log.append(" ".join(query.split()))
        self.query = query

    def fetchall(self):
        for pattern, rows in self.results.items():
            if pattern in self.query:
                return rows
        return []


class StubConnection:
    def __init__(self, results=None):
        self.log: list[str] = []
        self.results = results or {}
        self.closed = False

    def cursor(self):
        return StubCursor(self.log, self.results)

    def close(self):
        self.closed = True


def test_bootstraps_namespaces_and_reports_dialect():
    con = StubConnection()
    backend = KyuubiSparkBackend(connection=con)
    assert backend.dialect == "spark"
    assert con.log[:3] == [
        "CREATE NAMESPACE IF NOT EXISTS raw",
        "CREATE NAMESPACE IF NOT EXISTS alm",
        "CREATE NAMESPACE IF NOT EXISTS reg",
    ]


def test_landing_is_string_typed_external_ddl():
    con = StubConnection({"count(*)": [(240,)]})
    backend = KyuubiSparkBackend(connection=con)
    rows = backend.land_csv("raw.gl_core_positions_daily", "s3a://bank-landing/gl.csv")
    assert rows == 240
    assert "DROP TABLE IF EXISTS raw.gl_core_positions_daily" in con.log
    ddl = next(q for q in con.log if q.startswith("CREATE TABLE raw."))
    # Strings exactly as the file arrived: the contract casts, not the loader.
    assert "USING csv" in ddl and "inferSchema 'false'" in ddl and "header 'true'" in ddl
    assert "s3a://bank-landing/gl.csv" in ddl


def test_first_write_creates_partitioned_iceberg_table():
    con = StubConnection({"SHOW TABLES": [], "count(*)": [(275,)]})
    backend = KyuubiSparkBackend(connection=con)
    n = backend.overwrite_partition("reg.fr2052a_daily", "as_of_date", "2026-06-30", "SELECT 1")
    assert n == 275
    ddl = next(q for q in con.log if "CREATE TABLE reg.fr2052a_daily" in q)
    assert "USING iceberg" in ddl and "PARTITIONED BY (as_of_date)" in ddl


def test_rewrite_is_insert_overwrite_not_recreate():
    con = StubConnection({"SHOW TABLES": [("reg", "fr2052a_daily", False)], "count(*)": [(275,)]})
    backend = KyuubiSparkBackend(connection=con)
    backend.overwrite_partition("reg.fr2052a_daily", "as_of_date", "2026-06-30", "SELECT 1")
    assert any(q.startswith("INSERT OVERWRITE reg.fr2052a_daily") for q in con.log)
    assert not any("CREATE TABLE reg.fr2052a_daily" in q for q in con.log)


def test_columns_strip_hiveserver2_table_prefix():
    con = StubConnection()
    backend = KyuubiSparkBackend(connection=con)
    assert backend.columns("raw.t") == ["col_a", "col_b"]


def test_close_releases_the_gateway_session():
    con = StubConnection()
    KyuubiSparkBackend(connection=con).close()
    assert con.closed
