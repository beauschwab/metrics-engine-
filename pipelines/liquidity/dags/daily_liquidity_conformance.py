"""daily_liquidity_conformance — sourcing and conformance, per feed.

    land_gl_core   ─→ enforce_gl_core   ─→ conform_gl_core   ─→ ⬢ …positions@gl_core
    land_murex_eu  ─→ enforce_murex_eu  ─→ conform_murex_eu  ─→ ⬢ …positions@murex_eu
    land_treasury  ─→ enforce_treasury  ─→ conform_treasury  ─→ ⬢ …hqla@treasury

Three independent chains, one per contracted feed, because the feeds *are*
independent: each producing system owns a sub-partition of the day —
`(as_of_date, source_system)` — in the conformed tables, and its chain
replaces exactly that slice. Murex arriving late or broken delays or fails
Murex's sub-partition; the GL feed still conforms on time.

The DAG runs under a **`CronPartitionTimetable`** (Airflow 3.3, AIP-76), so
each run *is* a partition: `dag_run.partition_key` is the batch date, and
every asset event the run emits carries it. Nothing here parses a logical
date or invents a convention for saying which slice was written — the
scheduler owns the key, and the regulatory DAG is started against it.

`run_offset` is the knob for feeds whose morning file holds the previous
close: leave it at 0 while the extract's as-of date is the day it lands,
set it to -1 when the 05:30 file is yesterday's book.
"""

from __future__ import annotations

import pendulum
from airflow.sdk import CronPartitionTimetable, dag, task

from liquidity_pipeline import tasks
from liquidity_pipeline.assets import (
    CONFORMED_FOR_FEED, CONFORMED_SLICE, PARTITION_KEY_FORMAT, RAW,
)


@dag(
    dag_id="daily_liquidity_conformance",
    description="ODCS-contracted feeds landed, enforced and conformed as (as_of_date, source_system) sub-partitions",
    # The extracts land by 05:30 America/New_York; run once they are due. The
    # partition key is the batch date, which is what every task downstream
    # interpolates as its as-of date.
    schedule=CronPartitionTimetable(
        "45 5 * * 1-5",
        timezone="America/New_York",
        key_format=PARTITION_KEY_FORMAT,
    ),
    start_date=pendulum.datetime(2026, 6, 1, tz="America/New_York"),
    catchup=False,
    tags=["liquidity", "conformance", "odcs", "reference"],
    default_args={"retries": 0},
)
def daily_liquidity_conformance():
    @task
    def land(feed: str, dag_run=None, ds: str | None = None) -> dict:
        return tasks.land_extract(feed, tasks.batch_date(dag_run, ds))

    @task
    def enforce_contract(feed: str, dag_run=None, ds: str | None = None) -> dict:
        return tasks.enforce_feed_contract(feed, tasks.batch_date(dag_run, ds))

    # DuckDB is a single-writer file in dev, so simultaneous conformance runs
    # can contend for the warehouse; a retry rides it out. Spark behind Kyuubi
    # has no such constraint — the three chains genuinely run in parallel.
    @task(retries=2, retry_delay=pendulum.duration(seconds=20))
    def conform(feed: str, dag_run=None, ds: str | None = None) -> dict:
        return tasks.conform_feed(feed, tasks.batch_date(dag_run, ds))

    for feed in tasks.RAW_TABLES:
        (
            land.override(task_id=f"land_{feed}", outlets=[RAW[feed]])(feed=feed)
            >> enforce_contract.override(task_id=f"enforce_{feed}")(feed=feed)
            # Two outlets, two jobs: the slice is what the regulatory DAG's
            # asset condition aligns on, the table is what a downstream
            # consumer subscribes to when it wants the table as a whole.
            >> conform.override(
                task_id=f"conform_{feed}",
                outlets=[CONFORMED_SLICE[feed], CONFORMED_FOR_FEED[feed]],
            )(feed=feed)
        )


daily_liquidity_conformance()
