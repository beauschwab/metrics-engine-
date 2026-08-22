"""daily_liquidity_position — the nightly liquidity run, end to end.

    land ─→ contracts ─→ dbt ─→ fetch_release ─→ apply_rules ─→ file_2052a ─→ reconcile
    (3 feeds, mapped)   (build)  (pin manifest)      │                            ↑
                                                     └────────→ calculate_lcr ────┘

Sourcing is governed by Open Data Contracts (contracts/*.odcs.yaml), enforced
before anything reads the batch. Conformance and normalization are dbt's
(dbt/), building the canonical tables under one engine switch: DuckDB in dev,
Spark over Iceberg in prod (LIQ_TARGET). Business rules — the FR 2052a
classification and the LCR rate table — are *not* in this repo's Python or
SQL: they are fetched at run time from the rules registry's deployed channel,
which also serves the compiled submission plan the report step executes. The
run record ties every output to the release that computed it.

The file stays thin deliberately: every task body lives in
liquidity_pipeline/tasks.py, importable and testable without a scheduler.
"""

from __future__ import annotations

import pendulum
from airflow.sdk import dag, task

from liquidity_pipeline import tasks


@dag(
    dag_id="daily_liquidity_position",
    description="ODCS-sourced positions → dbt conformance → registry rules → LCR + FR 2052a",
    # The extracts land by 05:30 America/New_York; run once they are due.
    schedule="45 5 * * 1-5",
    start_date=pendulum.datetime(2026, 6, 1, tz="America/New_York"),
    catchup=False,
    tags=["liquidity", "fr2052a", "lcr", "reference"],
    default_args={"retries": 0},
)
def daily_liquidity_position():
    @task
    def land(ds: str | None = None) -> dict:
        return tasks.land_extracts(ds)

    @task
    def enforce_contract(feed: str, ds: str | None = None) -> dict:
        return tasks.enforce_feed_contract(feed, ds)

    @task
    def dbt_conform(ds: str | None = None) -> dict:
        return tasks.run_dbt(ds)

    @task
    def fetch_release(ds: str | None = None) -> dict:
        return tasks.fetch_release(ds)

    @task
    def apply_rules(ds: str | None = None) -> dict:
        return tasks.apply_rules(ds)

    @task
    def file_2052a(ds: str | None = None) -> dict:
        return tasks.file_submission(ds)

    @task
    def calculate_lcr(ds: str | None = None) -> dict:
        return tasks.compute_lcr(ds)

    @task
    def reconcile(release: dict, ds: str | None = None) -> dict:
        return tasks.reconcile_and_publish(ds, release)

    landed = land()
    # One enforcement task per contracted feed — a broken feed names itself in
    # the task id, and the two position feeds fail independently.
    enforced = enforce_contract.expand(feed=list(tasks.RAW_TABLES))
    conformed = dbt_conform()
    release = fetch_release()
    ruled = apply_rules()
    filed = file_2052a()
    lcr_out = calculate_lcr()

    landed >> enforced >> conformed >> release >> ruled
    ruled >> [filed, lcr_out] >> reconcile(release)


daily_liquidity_position()
