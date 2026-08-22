"""The pipeline's data assets, declared once.

Airflow 3 assets are the seam between the two DAGs: the conformance DAG
*produces* the conformed tables and the regulatory DAG is *scheduled on*
them — `CONFORMED_POSITIONS & CONFORMED_HQLA`, an asset condition rather
than a cron guess about when upstream is done.

Partitioning. The conformed tables are partitioned by day and sub-partitioned
by producing source system — `(as_of_date, source_system)` — so each feed's
conformance task replaces only its own slice and the feeds succeed or fail
independently. Airflow 3.1 has no first-class asset partitions yet (AIP-76),
so the convention is the documented interim one: every asset event carries
its partition key in the event's ``extra`` —

    {"as_of_date": "2026-06-30", "source_system": "murex_eu", "rows": 220}

Producers set it through ``outlet_events`` and consumers read it from
``triggering_asset_events``; when AIP-76 lands, these extras become the
partition declaration with the topology unchanged.

Names are the physical table names — the same strings the SQL reads — so an
asset in the UI's lineage graph and a table in the warehouse never need a
translation table between them.
"""

from __future__ import annotations

from airflow.sdk import Asset

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

#: The conformed layer. Two position feeds produce sub-partitions of the same
#: asset; the HQLA feed produces its own table.
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

#: Which conformed asset each feed's conformance task updates.
CONFORMED_FOR_FEED = {
    "gl_core": CONFORMED_POSITIONS,
    "murex_eu": CONFORMED_POSITIONS,
    "treasury": CONFORMED_HQLA,
}

#: The regulatory layer: daily partitions, produced by the consumer DAG.
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
