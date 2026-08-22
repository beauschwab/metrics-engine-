"""The pipeline's data assets and their partitions.

Airflow 3.3 (AIP-76) made partitions first-class, which is what this module
leans on. Two things follow from that, and they are the whole design:

**A partition key, not a convention.** Before 3.3 a producer could only
*describe* which slice it had written, by stuffing a key into the asset
event's ``extra`` and hoping the consumer read it back the same way. Now the
scheduler owns the key: the conformance DAG runs under a
``CronPartitionTimetable`` whose key is the batch date, every asset event it
emits carries that key, and a consumer scheduled with a
``PartitionedAssetTimetable`` is only started for a key its upstreams have
actually produced. ``dag_run.partition_key`` replaces the hand-rolled
resolution that used to read event extras.

**Sub-partitions are their own assets.** The conformed tables are
partitioned by day and sub-partitioned by producing source system. Airflow
aligns *assets* on a shared partition key, so each (table, source_system)
slice gets its own asset — ``alm.fct_2052a_positions@murex_eu`` — carrying
the day as its key. The regulatory DAG then names all three slices in one
asset condition, and the scheduler starts it for a date exactly once, when
every slice for that date has landed. That is the "wait for all feeds"
requirement stated as data rather than implemented as a sensor.

The table-level assets stay, updated alongside each slice: they are what a
downstream consumer subscribes to when it wants "the positions table"
without caring which systems feed it. Slices schedule; tables describe.

(The alternative — one composite ``feed|date`` key rolled up with
``RollupMapper`` — needs a categorical window that keeps the temporal
segment, and the built-in ``SegmentWindow`` deliberately ignores the anchor,
so it fits a pure-categorical rollup rather than this one. Slice assets get
the same semantics out of built-ins, and read better in the UI's asset
graph.)
"""

from __future__ import annotations

from airflow.sdk import Asset

#: How a batch date is spelled as a partition key. ISO day, because the batch
#: *is* a day — and because the same string is the as-of date every SQL
#: statement downstream already interpolates.
PARTITION_KEY_FORMAT = "%Y-%m-%d"

#: Landed raw batches, one asset per contracted feed.
RAW = {
    "gl_core": Asset(
        name="raw.gl_core_positions_daily",
        group="raw-feed",
        extra={"contract": "urn:datacontract:liquidity:gl-core-positions-daily"},
    ),
    "murex_eu": Asset(
        name="raw.murex_eu_positions_daily",
        group="raw-feed",
        extra={"contract": "urn:datacontract:liquidity:murex-eu-positions-daily"},
    ),
    "treasury": Asset(
        name="raw.treasury_hqla_daily",
        group="raw-feed",
        extra={"contract": "urn:datacontract:liquidity:treasury-hqla-daily"},
    ),
}

# ---------------------------------------------------------------------------
# The conformed layer: tables, and the per-source slices of them
# ---------------------------------------------------------------------------

CONFORMED_POSITIONS = Asset(
    name="alm.fct_2052a_positions",
    group="conformed",
    extra={"partitioned_by": ["as_of_date", "source_system"]},
)
CONFORMED_HQLA = Asset(
    name="alm.fct_liquidity_position",
    group="conformed",
    extra={"partitioned_by": ["as_of_date", "source_system"]},
)

#: Which conformed table each feed writes into.
CONFORMED_FOR_FEED = {
    "gl_core": CONFORMED_POSITIONS,
    "murex_eu": CONFORMED_POSITIONS,
    "treasury": CONFORMED_HQLA,
}


def _slice(table: Asset, feed: str) -> Asset:
    """One (table, source_system) sub-partition stream, keyed by day."""
    return Asset(
        name=f"{table.name}@{feed}",
        group="conformed-slice",
        extra={"table": table.name, "source_system": feed, "partition_key": "as_of_date"},
    )


#: The scheduling surface: one asset per sub-partition stream.
CONFORMED_SLICE = {feed: _slice(table, feed) for feed, table in CONFORMED_FOR_FEED.items()}

#: The regulatory DAG waits on every slice for a date — stated as an asset
#: condition the scheduler evaluates, not as a sensor the pipeline polls.
ALL_CONFORMED_SLICES = (
    CONFORMED_SLICE["gl_core"] & CONFORMED_SLICE["murex_eu"] & CONFORMED_SLICE["treasury"]
)

# ---------------------------------------------------------------------------
# The regulatory layer: daily partitions, produced by the consumer DAG
# ---------------------------------------------------------------------------

REG_ENRICHED = Asset(
    name="reg.fr2052a_enriched",
    group="regulatory",
    extra={"partitioned_by": ["as_of_date"]},
)
REG_REPORT = Asset(
    name="reg.fr2052a_daily",
    group="regulatory",
    extra={"partitioned_by": ["as_of_date"]},
)
REG_LCR = Asset(
    name="reg.lcr_daily",
    group="regulatory",
    extra={"partitioned_by": ["as_of_date"]},
)
