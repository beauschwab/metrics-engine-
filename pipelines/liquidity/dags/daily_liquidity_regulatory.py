"""daily_liquidity_regulatory — rules, LCR and the FR 2052a filing.

Scheduled on data, and on the *right slice* of it:

    schedule = PartitionedAssetTimetable(
        assets = …positions@gl_core & …positions@murex_eu & …hqla@treasury
    )

Airflow 3.3 aligns the three upstream slices on a shared partition key, so
this DAG is started for a batch date exactly once — when every source
system's sub-partition for that date has been conformed. A late Murex
extract delays this run rather than letting it file a partial book, and no
sensor polls anything: the wait is a property of the asset graph.

The batch date arrives as `dag_run.partition_key`. That replaces the
resolution this DAG used to do by hand (reading `as_of_date` out of every
triggering event's extras and refusing a mixed set) — under first-class
partitions a run *has* one key, and the scheduler is the thing that
guarantees the upstreams agree on it.
"""

from __future__ import annotations

import pendulum
from airflow.sdk import PartitionedAssetTimetable, dag, task

from liquidity_pipeline import tasks
from liquidity_pipeline.assets import (
    ALL_CONFORMED_SLICES, REG_ENRICHED, REG_LCR, REG_REPORT,
)


@dag(
    dag_id="daily_liquidity_regulatory",
    description="Registry rules, LCR and FR 2052a over one conformed daily partition — asset-triggered",
    # No cron: the run exists because every conformed slice for a date does.
    # The default partition mapper is identity, which is what we want — the
    # slices and this DAG share one granularity, the batch day.
    schedule=PartitionedAssetTimetable(assets=ALL_CONFORMED_SLICES),
    start_date=pendulum.datetime(2026, 6, 1, tz="America/New_York"),
    catchup=False,
    tags=["liquidity", "fr2052a", "lcr", "reference"],
    default_args={"retries": 0},
)
def daily_liquidity_regulatory():
    @task
    def resolve_partition(dag_run=None, ds: str | None = None) -> str:
        """The batch date this run is for — its partition key."""
        return tasks.batch_date(dag_run, ds)

    @task
    def fetch_release(as_of: str) -> dict:
        return tasks.fetch_release(as_of)

    @task(outlets=[REG_ENRICHED])
    def apply_rules(as_of: str) -> dict:
        return tasks.apply_rules(as_of)

    @task(outlets=[REG_REPORT])
    def file_2052a(as_of: str) -> dict:
        return tasks.file_submission(as_of)

    @task(outlets=[REG_LCR])
    def calculate_lcr(as_of: str) -> dict:
        return tasks.compute_lcr(as_of)

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
