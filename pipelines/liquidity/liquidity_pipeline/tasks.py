"""The task bodies the DAG orchestrates.

Airflow's file stays thin — every task calls a function here, so the same
functions run under `airflow dags test`, under pytest, and from a shell.
Each function opens its own backend and closes it before returning: DuckDB is
a single-writer engine and dbt needs the file to itself while it builds.

The order the DAG wires is the argument of this module read top to bottom:

  land → enforce contracts → dbt conformance → apply rules → file report
                                             ↘ (rules) → LCR ↗ → reconcile
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from . import config, lcr, rules, simulate
from .backend import for_target
from .contracts import enforce, load_contract
from .registry_client import get_registry

RAW_TABLES = {
    "gl_core": "raw.gl_core_positions_daily",
    "murex_eu": "raw.murex_eu_positions_daily",
    "treasury": "raw.treasury_hqla_daily",
}


def land_extracts(as_of_date: str, corrupt: set[str] = frozenset()) -> dict:
    """Pull each feed's daily extract and load it, stringly, into raw.

    In production this task fetches from the locations the contracts' server
    blocks name; here the simulators play the producers. ``corrupt`` exists
    for the tests that need to watch a bad batch get refused.
    """
    out = config.landing_dir(as_of_date)
    backend = for_target()
    try:
        landed = {}
        for feed, writer in simulate.WRITERS.items():
            path = writer(out, as_of_date, corrupt=corrupt)
            rows = backend.land_csv(RAW_TABLES[feed], path)
            landed[feed] = {"path": str(path), "rows": int(rows)}
        return landed
    finally:
        backend.close()


def enforce_feed_contract(feed: str, as_of_date: str) -> dict:
    """Hold one landed batch to its ODCS contract; refuse the run if broken."""
    contract = load_contract(config.CONTRACTS_DIR / config.FEEDS[feed])
    table = RAW_TABLES[feed]
    backend = for_target()
    try:
        results = enforce(
            backend.scalar, contract, table, as_of_date,
            columns=backend.columns(table),
            dialect=backend.dialect,
        )
        return {
            "contract": contract.id,
            "version": contract.version,
            "checks": len(results),
            "passed": True,
        }
    finally:
        backend.close()


def run_dbt(as_of_date: str, command: str = "build") -> dict:
    """Conformance and normalization: dbt owns raw → alm.

    Invoked as a subprocess against this environment's dbt, the way an
    Airflow worker or a cluster job would run it — and `build` rather than
    `run`, so the schema tests gate the batch the same way the contracts do.
    """
    dbt = Path(sys.executable).parent / "dbt"
    cmd = [
        str(dbt), command,
        "--project-dir", str(config.DBT_DIR),
        "--profiles-dir", str(config.DBT_DIR / "profiles"),
        "--target", config.target(),
        "--vars", json.dumps({"as_of_date": as_of_date}),
    ]
    env = {
        **os.environ,
        "LIQ_TARGET": config.target(),
        "LIQ_WAREHOUSE": str(config.warehouse_path()),
        "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
    }
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        tail = "\n".join((proc.stdout + proc.stderr).splitlines()[-40:])
        raise RuntimeError(f"dbt {command} failed for {as_of_date}:\n{tail}")
    return {"command": command, "target": config.target(), "ok": True}


def fetch_release(as_of_date: str) -> dict:
    """Pin what tonight's run computes with, before anything computes.

    The manifest is fetched once and logged into the run record; releases are
    immutable, so everything after this can re-fetch by name and still get
    the same bytes.
    """
    registry = get_registry()
    manifest = registry.manifest()
    return {
        "channel": manifest["channel"],
        "release": manifest["release"]["version"],
        "artifacts": {a["name"]: a["revision"] for a in manifest["artifacts"]},
    }


def apply_rules(as_of_date: str) -> dict:
    backend = for_target()
    try:
        return rules.apply_rules(backend, get_registry(), as_of_date)
    finally:
        backend.close()


def file_submission(as_of_date: str) -> dict:
    backend = for_target()
    try:
        return rules.run_submission(backend, get_registry(), as_of_date)
    finally:
        backend.close()


def compute_lcr(as_of_date: str) -> dict:
    backend = for_target()
    try:
        return lcr.compute_lcr(backend, as_of_date)
    finally:
        backend.close()


class ReconciliationFailure(Exception):
    pass


def reconcile_and_publish(as_of_date: str, release: dict) -> dict:
    """The controls that make the run publishable, then the run record.

    Ties three independently produced numbers together:

      * the registry-compiled plan's weighted outflows (reg.fr2052a_daily)
        against the pipeline's own row-stage aggregation (reg.fr2052a_enriched)
        — same governed logic, two executions, must agree to the cent;
      * the filed report's grain must be unique — a duplicate key files a
        balance twice;
      * conformed balance must equal enriched balance — the rules stage may
        reshape rows, never drop or invent balance.
    """
    backend = for_target()
    try:
        d = f"DATE '{as_of_date}'"
        checks: dict[str, dict] = {}

        plan_outflows, filed_groups = backend.sql(
            f"SELECT COALESCE(SUM(weighted_outflows_30d), 0), count(*) FROM {rules.REPORT_TABLE} "
            f"WHERE as_of_date = {d}"
        )[0]
        stage_outflows = backend.scalar(
            f"SELECT COALESCE(SUM(weighted_amount), 0) FROM {rules.ENRICHED_TABLE} "
            f"WHERE as_of_date = {d} AND direction = 'OUTFLOW' AND days_to_maturity <= 30"
        )
        # The plan files each group correctly rounded to the minor unit (the
        # registry compiler's own rule), so the tie-out tolerance is exactly
        # what that rounding can introduce: half a cent per filed row.
        tolerance = 0.005 * (int(filed_groups) + 1)
        checks["plan_vs_row_stage_outflows"] = {
            "report": float(plan_outflows),
            "row_stage": float(stage_outflows),
            "tolerance": tolerance,
            "passed": abs(float(plan_outflows) - float(stage_outflows)) <= tolerance,
        }

        dup_keys = backend.scalar(
            f"SELECT count(*) FROM ("
            f"  SELECT product_id, maturity_bucket, currency, entity_id "
            f"  FROM {rules.REPORT_TABLE} WHERE as_of_date = {d} "
            f"  GROUP BY 1, 2, 3, 4 HAVING count(*) > 1)"
        )
        checks["report_grain_unique"] = {"duplicates": int(dup_keys), "passed": dup_keys == 0}

        conformed = backend.scalar(
            f"SELECT COALESCE(SUM(balance_usd), 0) FROM alm.fct_2052a_positions WHERE as_of_date = {d}"
        )
        enriched = backend.scalar(
            f"SELECT COALESCE(SUM(balance_usd), 0) FROM {rules.ENRICHED_TABLE} WHERE as_of_date = {d}"
        )
        checks["balance_conservation"] = {
            "conformed": float(conformed),
            "enriched": float(enriched),
            "passed": abs(float(conformed) - float(enriched)) < 0.01,
        }

        lcr_rows = backend.sql(
            f"SELECT entity_id, lcr_pct FROM {lcr.LCR_TABLE} "
            f"WHERE as_of_date = {d} ORDER BY entity_id"
        )
    finally:
        backend.close()

    failed = [name for name, c in checks.items() if not c["passed"]]
    record = {
        "as_of_date": as_of_date,
        "release": release,
        "checks": checks,
        "lcr": {e: None if p is None else round(float(p), 1) for e, p in lcr_rows},
        "publishable": not failed,
    }

    run_dir = config.data_dir() / "runs" / as_of_date
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run_manifest.json").write_text(json.dumps(record, indent=2))

    if failed:
        raise ReconciliationFailure(
            f"run for {as_of_date} is not publishable — failed: {', '.join(failed)}\n"
            + json.dumps({k: checks[k] for k in failed}, indent=2)
        )
    return record
