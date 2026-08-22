"""daily_liquidity_conformance — sourcing and conformance, per feed.

    land_gl_core   ─→ enforce_gl_core   ─→ conform_gl_core   ─→ ⬢ alm.fct_2052a_positions
    land_murex_eu  ─→ enforce_murex_eu  ─→ conform_murex_eu  ─→ ⬢     (sub-partition each)
    land_treasury  ─→ enforce_treasury  ─→ conform_treasury  ─→ ⬢ alm.fct_liquidity_position

Three independent chains, one per contracted feed, because the feeds *are*
independent: each producing system owns a sub-partition of the day —
`(as_of_date, source_system)` — in the conformed tables, and its chain
replaces exactly that slice. Murex arriving late or broken delays or fails
Murex's sub-partition; the GL feed still conforms on time.

The chains end at Airflow assets, not at other tasks. Each conformance task
updates the conformed table's asset with an event carrying its partition key
in the extras — that event stream is the contract with the regulatory DAG,
which is scheduled on these assets rather than on a cron guess about when
conformance is done. See liquidity_pipeline/assets.py for the partition
convention.
"""

from __future__ import annotations

import pendulum
from airflow.sdk import dag, get_current_context, task

from liquidity_pipeline import tasks
from liquidity_pipeline.assets import CONFORMED_FOR_FEED, RAW


@dag(
    dag_id="daily_liquidity_conformance",
    description="ODCS-contracted feeds landed, enforced and conformed as (as_of_date, source_system) sub-partitions",
    # The extracts land by 05:30 America/New_York; run once they are due.
    schedule="45 5 * * 1-5",
    start_date=pendulum.datetime(2026, 6, 1, tz="America/New_York"),
    catchup=False,
    tags=["liquidity", "conformance", "odcs", "reference"],
    default_args={"retries": 0},
)
def daily_liquidity_conformance():
    @task
    def land(feed: str, ds: str | None = None) -> dict:
        landed = tasks.land_extract(feed, ds)
        context = get_current_context()
        context["outlet_events"][RAW[feed]].extra = {"as_of_date": ds, **landed}
        return landed

    @task
    def enforce_contract(feed: str, ds: str | None = None) -> dict:
        return tasks.enforce_feed_contract(feed, ds)

    # DuckDB is a single-writer file in dev, so simultaneous conformance runs
    # can contend for the warehouse; a retry rides it out. Spark in prod has
    # no such constraint — the three chains genuinely run in parallel there.
    @task(retries=2, retry_delay=pendulum.duration(seconds=20))
    def conform(feed: str, ds: str | None = None) -> dict:
        result = tasks.conform_feed(feed, ds)
        context = get_current_context()
        # The sub-partition this run replaced, stamped onto the asset event —
        # the partition convention the consumer resolves its batch date from.
        context["outlet_events"][CONFORMED_FOR_FEED[feed]].extra = {
            "as_of_date": ds,
            "source_system": feed,
            "rows": result["rows"],
        }
        return result

    for feed in tasks.RAW_TABLES:
        (
            land.override(task_id=f"land_{feed}", outlets=[RAW[feed]])(feed=feed)
            >> enforce_contract.override(task_id=f"enforce_{feed}")(feed=feed)
            >> conform.override(task_id=f"conform_{feed}", outlets=[CONFORMED_FOR_FEED[feed]])(feed=feed)
        )


daily_liquidity_conformance()
