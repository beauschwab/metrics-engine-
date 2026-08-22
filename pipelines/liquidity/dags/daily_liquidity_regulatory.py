"""daily_liquidity_regulatory — rules, LCR and the FR 2052a filing.

Scheduled on data, not on a clock:

    schedule = alm.fct_2052a_positions & alm.fct_liquidity_position

The asset condition means this DAG runs when *both* conformed tables have new
events since its last run — however many sub-partitions produced them and
however late a feed was. There is no cron here to guess when conformance
finishes and no sensor poking a table; the conformance DAG's asset events are
the trigger.

An asset-triggered run's logical date is the trigger time, so the first task
resolves the batch date from the triggering events' partition extras (the
`as_of_date` every producer stamped) and refuses a mixed set — a late
sub-partition meeting a newer run must be a loud re-trigger, not a silently
misfiled day. Manual runs and `dags test` fall back to the logical date,
which is how the e2e proof drives a specific partition.
"""

from __future__ import annotations

import pendulum
from airflow.sdk import dag, get_current_context, task

from liquidity_pipeline import tasks
from liquidity_pipeline.assets import (
    CONFORMED_HQLA, CONFORMED_POSITIONS, REG_ENRICHED, REG_LCR, REG_REPORT,
)


@dag(
    dag_id="daily_liquidity_regulatory",
    description="Registry rules, LCR and FR 2052a over the conformed daily partition — asset-triggered",
    schedule=(CONFORMED_POSITIONS & CONFORMED_HQLA),
    start_date=pendulum.datetime(2026, 6, 1, tz="America/New_York"),
    catchup=False,
    tags=["liquidity", "fr2052a", "lcr", "reference"],
    default_args={"retries": 0},
)
def daily_liquidity_regulatory():
    @task
    def resolve_partition(ds: str | None = None) -> str:
        context = get_current_context()
        return tasks.resolve_as_of(context.get("triggering_asset_events"), ds)

    @task
    def fetch_release(as_of: str) -> dict:
        return tasks.fetch_release(as_of)

    @task(outlets=[REG_ENRICHED])
    def apply_rules(as_of: str) -> dict:
        result = tasks.apply_rules(as_of)
        context = get_current_context()
        context["outlet_events"][REG_ENRICHED].extra = {
            "as_of_date": as_of, "release": result["release"], "rows": result["rows"],
        }
        return result

    @task(outlets=[REG_REPORT])
    def file_2052a(as_of: str) -> dict:
        result = tasks.file_submission(as_of)
        context = get_current_context()
        context["outlet_events"][REG_REPORT].extra = {
            "as_of_date": as_of, "release": result["release"], "rows": result["rows"],
        }
        return result

    @task(outlets=[REG_LCR])
    def calculate_lcr(as_of: str) -> dict:
        result = tasks.compute_lcr(as_of)
        context = get_current_context()
        context["outlet_events"][REG_LCR].extra = {"as_of_date": as_of}
        return result

    @task
    def reconcile(as_of: str, release: dict) -> dict:
        return tasks.reconcile_and_publish(as_of, release)

    as_of = resolve_partition()
    release = fetch_release(as_of)
    ruled = apply_rules(as_of)
    filed = file_2052a(as_of)
    lcr_out = calculate_lcr(as_of)

    release >> ruled
    ruled >> [filed, lcr_out] >> reconcile(as_of, release)


daily_liquidity_regulatory()
