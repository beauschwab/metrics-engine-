"""The whole pipeline, once, on the dev engine — then assertions per stage.

This is the e2e proof: land three contracted extracts, conform them with dbt,
fetch the deployed rules from the registry (snapshot mode — the same bytes a
live channel serves), classify and rate every position, file the FR 2052a
partition with the registry-compiled plan, compute the LCR, and reconcile.
The run happens once in a module fixture; each test then interrogates one
stage's output, so a failure names the stage that broke.
"""

from __future__ import annotations

import json

import duckdb
import pytest

from liquidity_pipeline import config, tasks

AS_OF = "2026-06-30"

BUCKETS = {"open", "overnight", "d2_7", "d8_14", "d15_30", "d31_90", "d91_180", "d181_365", "gt365"}
PRODUCT_IDS = {
    "O.D.1", "O.D.2", "O.D.3", "O.D.5", "O.D.6",
    "O.S.1", "O.S.2", "O.S.3", "O.S.5",
    "O.W.1", "O.W.2", "O.W.3",
    "I.S.1", "I.S.2", "I.U.1", "I.O.1",
}


@pytest.fixture(scope="module")
def run():
    # The same per-feed chains the conformance DAG wires: each feed lands,
    # is held to its contract, and conforms its own (as_of_date, source_system)
    # sub-partition independently.
    out = {"landed": tasks.land_extracts(AS_OF)}
    out["contracts"] = {f: tasks.enforce_feed_contract(f, AS_OF) for f in config.FEEDS}
    out["conformed"] = {f: tasks.conform_feed(f, AS_OF) for f in config.FEEDS}
    out["release"] = tasks.fetch_release(AS_OF)
    out["rules"] = tasks.apply_rules(AS_OF)
    out["report"] = tasks.file_submission(AS_OF)
    out["lcr"] = tasks.compute_lcr(AS_OF)
    out["reconciled"] = tasks.reconcile_and_publish(AS_OF, out["release"])
    return out


@pytest.fixture()
def db(run):
    con = duckdb.connect(str(config.warehouse_path()), read_only=True)
    yield con
    con.close()


def test_all_feeds_landed_and_contracted(run):
    assert set(run["landed"]) == {"gl_core", "murex_eu", "treasury"}
    assert all(v["rows"] > 0 for v in run["landed"].values())
    assert all(c["passed"] for c in run["contracts"].values())


def test_dbt_conformed_the_union(run, db):
    n = db.execute(
        "SELECT count(*), count(DISTINCT source_system), count(DISTINCT entity_id) "
        "FROM alm.fct_2052a_positions WHERE as_of_date = ?::DATE", [AS_OF]
    ).fetchone()
    assert n[0] == run["landed"]["gl_core"]["rows"] + run["landed"]["murex_eu"]["rows"]
    assert n[1] == 2, "both source systems must reach the conformed table"
    assert n[2] == 4, "all four legal entities"
    # Murex codes must be gone: the conformed vocabulary is canonical.
    decoded = db.execute(
        "SELECT count(*) FROM alm.fct_2052a_positions "
        "WHERE segment IN ('RTL', 'SBB', 'WSL') OR direction IN ('I', 'O')"
    ).fetchone()[0]
    assert decoded == 0
    # Each conformance run reported the sub-partition it now holds — the same
    # numbers its asset event carries.
    for feed in ("gl_core", "murex_eu"):
        held = db.execute(
            "SELECT count(*) FROM alm.fct_2052a_positions "
            "WHERE as_of_date = ?::DATE AND source_system = ?", [AS_OF, feed]
        ).fetchone()[0]
        assert held == run["conformed"][feed]["rows"] == run["landed"][feed]["rows"]
    assert run["conformed"]["treasury"]["table"] == "alm.fct_liquidity_position"


def test_sub_partitions_replace_independently(run, db):
    """Re-conforming one feed touches only that feed's slice of the day.

    The daily partition is subdivided by producing system; the composite
    incremental key means a gl_core re-run deletes and reinserts gl_core's
    rows and leaves murex_eu's byte-identical — the isolation the per-feed
    DAG chains rely on.
    """
    def slice_of(feed):
        return db.execute(
            "SELECT count(*), round(sum(balance_usd), 2) FROM alm.fct_2052a_positions "
            "WHERE as_of_date = ?::DATE AND source_system = ?", [AS_OF, feed]
        ).fetchone()

    murex_before = slice_of("murex_eu")
    gl_before = slice_of("gl_core")
    db.close()

    tasks.conform_feed("gl_core", AS_OF)

    con = duckdb.connect(str(config.warehouse_path()), read_only=True)
    murex_after = con.execute(
        "SELECT count(*), round(sum(balance_usd), 2) FROM alm.fct_2052a_positions "
        "WHERE as_of_date = ?::DATE AND source_system = 'murex_eu'", [AS_OF]
    ).fetchone()
    gl_after = con.execute(
        "SELECT count(*), round(sum(balance_usd), 2) FROM alm.fct_2052a_positions "
        "WHERE as_of_date = ?::DATE AND source_system = 'gl_core'", [AS_OF]
    ).fetchone()
    con.close()

    assert murex_after == murex_before, "a gl_core re-run must not touch murex_eu's sub-partition"
    assert gl_after == gl_before, "the deterministic batch reconforms to the same slice"


def test_rules_came_from_the_deployed_release(run):
    assert run["release"]["channel"] == "production"
    assert run["release"]["release"] >= 1
    assert run["rules"]["release"] == run["release"]["release"]
    assert run["rules"]["rules"] == "fr2052a_product_id"


def test_every_position_classified(run, db):
    assert run["rules"]["rows"] > 0
    unmapped = db.execute(
        "SELECT count(*) FROM reg.fr2052a_enriched "
        "WHERE as_of_date = ?::DATE AND product_id IS NULL", [AS_OF]
    ).fetchone()[0]
    assert unmapped == 0
    fired = {c["product_id"] for c in run["rules"]["coverage"]}
    assert fired <= PRODUCT_IDS
    assert len(fired) >= 10, f"coverage suspiciously thin: {sorted(fired)}"
    # Every classified outflow/inflow drew a rate from the parameter set.
    rateless = db.execute(
        "SELECT count(*) FROM reg.fr2052a_enriched "
        "WHERE as_of_date = ?::DATE AND outflow_rate IS NULL", [AS_OF]
    ).fetchone()[0]
    assert rateless == 0


def test_2052a_report_filed_at_declared_grain(run, db):
    assert run["report"]["table"] == "reg.fr2052a_daily"
    assert run["report"]["rows"] > 0
    dup = db.execute(
        "SELECT count(*) FROM (SELECT product_id, maturity_bucket, currency, entity_id "
        "FROM reg.fr2052a_daily WHERE as_of_date = ?::DATE "
        "GROUP BY 1,2,3,4 HAVING count(*) > 1)", [AS_OF]
    ).fetchone()[0]
    assert dup == 0
    products, buckets = db.execute(
        "SELECT list(DISTINCT product_id), list(DISTINCT maturity_bucket) "
        "FROM reg.fr2052a_daily WHERE as_of_date = ?::DATE", [AS_OF]
    ).fetchone()
    assert set(products) <= PRODUCT_IDS
    assert set(buckets) <= BUCKETS
    # The filed measures exist and are non-degenerate.
    gross, weighted = db.execute(
        "SELECT sum(gross_outflow_balance), sum(weighted_outflows_30d) "
        "FROM reg.fr2052a_daily WHERE as_of_date = ?::DATE", [AS_OF]
    ).fetchone()
    assert gross > 0 and weighted > 0
    assert weighted < gross, "run-off rates are fractions; weighted must not exceed gross"


def test_lcr_arithmetic_holds(run, db):
    rows = db.execute(
        "SELECT entity_id, hqla_total, weighted_outflows_30d, weighted_inflows_30d, "
        "capped_inflows_30d, net_outflows_30d, lcr_pct "
        "FROM reg.lcr_daily WHERE as_of_date = ?::DATE", [AS_OF]
    ).fetchall()
    by_entity = {r[0]: r for r in rows}
    assert set(by_entity) == {"BANK_US", "BANK_UK", "BANK_SG", "BANK_DE", "CONSOLIDATED"}
    for e, (_, hqla, outf, inf, capped, net, pct) in by_entity.items():
        assert hqla > 0, e
        assert capped == pytest.approx(min(inf, 0.75 * outf)), e
        assert net == pytest.approx(max(outf - capped, 0)), e
        if net > 0:
            assert pct == pytest.approx(100.0 * hqla / net), e
    # The consolidated cut is computed from positions, not by summing entities.
    assert run["lcr"]["lcr"]["CONSOLIDATED"]["lcr_pct"] is not None


def test_reconciliation_ties_plan_to_row_stage(run):
    checks = run["reconciled"]["checks"]
    assert checks["plan_vs_row_stage_outflows"]["passed"], (
        "the registry-compiled plan and the pipeline's row stage disagree: "
        f"{checks['plan_vs_row_stage_outflows']}"
    )
    assert checks["report_grain_unique"]["passed"]
    assert checks["balance_conservation"]["passed"]
    assert run["reconciled"]["publishable"]


def test_run_record_written(run):
    record_path = config.data_dir() / "runs" / AS_OF / "run_manifest.json"
    record = json.loads(record_path.read_text())
    assert record["release"]["release"] == run["release"]["release"]
    assert record["publishable"]
    assert "CONSOLIDATED" in record["lcr"]


def test_rerun_is_idempotent(run, db):
    """Filing the same day twice replaces the partition, never doubles it."""
    before = db.execute(
        "SELECT count(*), round(sum(weighted_outflows_30d), 2) FROM reg.fr2052a_daily "
        "WHERE as_of_date = ?::DATE", [AS_OF]
    ).fetchone()
    db.close()
    tasks.file_submission(AS_OF)
    con = duckdb.connect(str(config.warehouse_path()), read_only=True)
    after = con.execute(
        "SELECT count(*), round(sum(weighted_outflows_30d), 2) FROM reg.fr2052a_daily "
        "WHERE as_of_date = ?::DATE", [AS_OF]
    ).fetchone()
    con.close()
    assert after == before
