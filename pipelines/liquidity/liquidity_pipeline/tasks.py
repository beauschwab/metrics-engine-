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
from .warehouse_lock import warehouse_write_lock

RAW_TABLES = {
    "gl_core": "raw.gl_core_positions_daily",
    "murex_eu": "raw.murex_eu_positions_daily",
    "treasury": "raw.treasury_hqla_daily",
}

#: What one feed's conformance run builds: its staging model plus the
#: conformed table it sub-partitions (`+model` = the model and its parents).
FEED_SELECTORS = {
    "gl_core": "+fct_2052a_positions",
    "murex_eu": "+fct_2052a_positions",
    "treasury": "+fct_liquidity_position",
}


def land_extract(feed: str, as_of_date: str, corrupt: set[str] = frozenset(),
                 scenario: str = "base") -> dict:
    """Pull one feed's daily extract and load it, stringly, into raw.

    In production this task fetches from the location the contract's server
    block names; here the simulators play the producers. ``corrupt`` exists
    for the tests that need to watch a bad batch get refused.
    """
    out = config.landing_dir(as_of_date)
    backend = for_target()
    try:
        path = simulate.WRITERS[feed](out, as_of_date, corrupt=corrupt, scenario=scenario)
        rows = backend.land_csv(RAW_TABLES[feed], path)
        return {"feed": feed, "path": str(path), "rows": int(rows)}
    finally:
        backend.close()


def land_extracts(as_of_date: str, corrupt: set[str] = frozenset(),
                  scenario: str = "base") -> dict:
    """Every feed at once — the tests' convenience over land_extract."""
    return {
        feed: land_extract(feed, as_of_date, corrupt=corrupt, scenario=scenario)
        for feed in simulate.WRITERS
    }


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


def run_dbt(as_of_date: str, command: str = "build", feed: str | None = None) -> dict:
    """Conformance and normalization: dbt owns raw → alm.

    Invoked as a subprocess against this environment's dbt, the way an
    Airflow worker or a cluster job would run it — and `build` rather than
    `run`, so the schema tests gate the batch the same way the contracts do.

    With ``feed``, the run is one feed's sub-partition: dbt selects that
    feed's slice of the graph and the ``source_system`` var restricts the
    batch, so the incremental composite key (as_of_date, source_system)
    replaces exactly one system's rows for the day. Without it, every source
    conforms in one pass.
    """
    dbt = Path(sys.executable).parent / "dbt"
    dbt_vars: dict = {"as_of_date": as_of_date}
    if feed:
        dbt_vars["source_system"] = feed
    # Build output goes to the data dir, not into the project. On Kubernetes
    # the DAG bundle usually arrives on a read-only volume (git-sync), and a
    # dbt that writes target/ next to its models crashes there.
    scratch = config.data_dir() / "dbt"
    cmd = [
        str(dbt), command,
        "--project-dir", str(config.DBT_DIR),
        "--profiles-dir", str(config.DBT_DIR / "profiles"),
        "--target", config.target(),
        "--target-path", str(scratch / "target"),
        "--log-path", str(scratch / "logs"),
        "--vars", json.dumps(dbt_vars),
        *(["--select", FEED_SELECTORS[feed]] if feed else []),
    ]
    env = {
        **os.environ,
        "LIQ_TARGET": config.target(),
        "LIQ_WAREHOUSE": str(config.warehouse_path()),
        "DBT_SEND_ANONYMOUS_USAGE_STATS": "false",
    }
    with warehouse_write_lock():
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        tail = "\n".join((proc.stdout + proc.stderr).splitlines()[-40:])
        raise RuntimeError(f"dbt {command} failed for {as_of_date}:\n{tail}")
    return {"command": command, "target": config.target(), "feed": feed, "ok": True}


def conform_feed(feed: str, as_of_date: str) -> dict:
    """One feed's conformance run, plus a count of the sub-partition it now
    holds — the run record's evidence that this slice of the day was written."""
    result = run_dbt(as_of_date, feed=feed)
    table = ("alm.fct_2052a_positions" if FEED_SELECTORS[feed] == "+fct_2052a_positions"
             else "alm.fct_liquidity_position")
    backend = for_target()
    try:
        rows = backend.scalar(
            f"SELECT count(*) FROM {table} "
            f"WHERE as_of_date = DATE '{as_of_date}' AND source_system = '{feed}'"
        )
    finally:
        backend.close()
    return {**result, "table": table, "as_of_date": as_of_date,
            "source_system": feed, "rows": int(rows)}


def batch_date(dag_run=None, fallback: str | None = None) -> str:
    """Which daily partition this run is for.

    Under Airflow 3.3 a run *has* a partition key (AIP-76): the conformance
    DAG's ``CronPartitionTimetable`` sets it to the batch date, and the
    regulatory DAG's ``PartitionedAssetTimetable`` is started against the key
    its upstream slices agree on. So this reads the key and stops — the
    version of this function that reconciled ``as_of_date`` out of every
    triggering event's extras, and refused a mixed set, existed only because
    partitions were a convention rather than scheduler state.

    ``fallback`` is the logical date, for a run with no partition key at all
    (a plain manual trigger against an unpartitioned schedule).
    """
    key = getattr(dag_run, "partition_key", None)
    if key:
        # Keys are formatted %Y-%m-%d by the timetable; a deployment that
        # widens key_format to a timestamp still yields a usable date here.
        return str(key)[:10]
    if fallback:
        return fallback
    raise ValueError(
        "this run has no partition key and no logical date — nothing names the batch"
    )


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
