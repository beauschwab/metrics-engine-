"""The two DAGs are real Airflow DAGs wired the way the modules promise:
per-feed conformance chains under a partitioned cron timetable, and a
regulatory DAG the scheduler starts only when every conformed slice for a
batch date exists.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from liquidity_pipeline.assets import CONFORMED_FOR_FEED, CONFORMED_SLICE, RAW
from liquidity_pipeline.tasks import RAW_TABLES, batch_date

DAGS = Path(__file__).parent.parent / "dags"


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"{name}_module", DAGS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, name)()


def test_conformance_dag_has_independent_per_feed_chains():
    dag = load("daily_liquidity_conformance")
    for feed in RAW_TABLES:
        land = dag.get_task(f"land_{feed}")
        enforce = dag.get_task(f"enforce_{feed}")
        conform = dag.get_task(f"conform_{feed}")
        assert [t.task_id for t in enforce.upstream_list] == [land.task_id]
        assert [t.task_id for t in conform.upstream_list] == [enforce.task_id]
        # Independence is the point: no cross-feed edges.
        assert not conform.downstream_list
        assert not land.upstream_list


def test_conformance_runs_are_partitioned_by_batch_date():
    """AIP-76: each run *is* a partition, keyed by the day it conforms."""
    from airflow.sdk import CronPartitionTimetable

    dag = load("daily_liquidity_conformance")
    assert isinstance(dag.timetable, CronPartitionTimetable)
    # The contracts promise extracts by 05:30 America/New_York; conformance
    # must not run before they are due.
    assert dag.timetable.expression == "45 5 * * 1-5"
    # Keys are batch dates, not timestamps — the as-of date SQL interpolates.
    assert dag.timetable.key_format == "%Y-%m-%d"


def test_conformance_tasks_declare_slice_and_table_assets():
    dag = load("daily_liquidity_conformance")
    for feed in RAW_TABLES:
        assert [a.name for a in dag.get_task(f"land_{feed}").outlets] == [RAW[feed].name]
        outlets = {a.name for a in dag.get_task(f"conform_{feed}").outlets}
        # The slice is what the regulatory DAG aligns on; the table is what a
        # downstream consumer subscribes to.
        assert outlets == {CONFORMED_SLICE[feed].name, CONFORMED_FOR_FEED[feed].name}
    # Two position feeds are slices of one table; treasury owns the other.
    assert CONFORMED_FOR_FEED["gl_core"].name == CONFORMED_FOR_FEED["murex_eu"].name
    assert CONFORMED_SLICE["gl_core"].name != CONFORMED_SLICE["murex_eu"].name
    assert CONFORMED_FOR_FEED["treasury"].name != CONFORMED_FOR_FEED["gl_core"].name


def test_regulatory_dag_waits_for_every_conformed_slice():
    from airflow.sdk import PartitionedAssetTimetable

    dag = load("daily_liquidity_regulatory")
    assert isinstance(dag.timetable, PartitionedAssetTimetable)
    condition = dag.timetable.asset_condition
    assert type(condition).__name__ == "AssetAll", "every slice, not any"
    assert {a.name for a in condition.objects} == {
        "alm.fct_2052a_positions@gl_core",
        "alm.fct_2052a_positions@murex_eu",
        "alm.fct_liquidity_position@treasury",
    }


def test_slices_and_consumer_share_one_granularity():
    """The default mapper is identity, so a slice's key *is* the run's key.

    Alignment is the whole mechanism: three slices carrying 2026-06-30 start
    one regulatory run for 2026-06-30. A mapper that rewrote the key (rolling
    days into months, say) would silently change which run fires.
    """
    dag = load("daily_liquidity_regulatory")
    mapper = dag.timetable.default_partition_mapper
    assert type(mapper).__name__ == "IdentityMapper"
    assert mapper.to_downstream("2026-06-30") == "2026-06-30"


def test_regulatory_dag_wiring():
    dag = load("daily_liquidity_regulatory")
    ids = set(dag.task_ids)
    assert {
        "resolve_partition", "fetch_release", "apply_rules",
        "file_2052a", "calculate_lcr", "reconcile",
    } <= ids
    downstream_of_rules = {t.task_id for t in dag.get_task("apply_rules").downstream_list}
    assert {"file_2052a", "calculate_lcr"} <= downstream_of_rules
    recon_up = {t.task_id for t in dag.get_task("reconcile").upstream_list}
    assert {"file_2052a", "calculate_lcr", "fetch_release"} <= recon_up
    # The regulatory outputs are assets too, for downstream lineage.
    assert [a.name for a in dag.get_task("file_2052a").outlets] == ["reg.fr2052a_daily"]
    assert [a.name for a in dag.get_task("calculate_lcr").outlets] == ["reg.lcr_daily"]


# ---------------------------------------------------------------------------
# Reading the batch date off the run
# ---------------------------------------------------------------------------

class _Run:
    def __init__(self, partition_key=None):
        self.partition_key = partition_key


def test_batch_date_is_the_runs_partition_key():
    assert batch_date(_Run("2026-06-30"), fallback="2099-01-01") == "2026-06-30"


def test_batch_date_narrows_a_timestamp_key_to_its_day():
    assert batch_date(_Run("2026-06-30T05:45:00")) == "2026-06-30"


def test_batch_date_falls_back_to_the_logical_date():
    assert batch_date(_Run(None), fallback="2026-06-30") == "2026-06-30"
    assert batch_date(None, fallback="2026-06-30") == "2026-06-30"
    with pytest.raises(ValueError, match="nothing names the batch"):
        batch_date(None, fallback=None)
