"""The two DAGs are real Airflow DAGs wired the way the modules promise:
per-feed conformance chains producing asset sub-partition events, and a
regulatory DAG scheduled on the conformed assets rather than a cron.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from liquidity_pipeline.assets import CONFORMED_FOR_FEED, RAW
from liquidity_pipeline.tasks import RAW_TABLES, resolve_as_of

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


def test_conformance_tasks_declare_their_assets():
    dag = load("daily_liquidity_conformance")
    for feed in RAW_TABLES:
        assert [a.name for a in dag.get_task(f"land_{feed}").outlets] == [RAW[feed].name]
        assert [a.name for a in dag.get_task(f"conform_{feed}").outlets] == [
            CONFORMED_FOR_FEED[feed].name
        ]
    # Two position feeds sub-partition one asset; treasury owns the other.
    assert CONFORMED_FOR_FEED["gl_core"].name == CONFORMED_FOR_FEED["murex_eu"].name
    assert CONFORMED_FOR_FEED["treasury"].name != CONFORMED_FOR_FEED["gl_core"].name


def test_regulatory_dag_is_scheduled_on_both_conformed_assets():
    from airflow.timetables.simple import AssetTriggeredTimetable

    dag = load("daily_liquidity_regulatory")
    assert isinstance(dag.timetable, AssetTriggeredTimetable)
    condition = dag.timetable.asset_condition
    assert type(condition).__name__ == "AssetAll", "both tables, not either"
    assert {a.name for _, a in condition.iter_assets()} == {
        "alm.fct_2052a_positions",
        "alm.fct_liquidity_position",
    }


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
    # The regulatory outputs are declared as assets too, for downstream lineage.
    assert [a.name for a in dag.get_task("file_2052a").outlets] == ["reg.fr2052a_daily"]
    assert [a.name for a in dag.get_task("calculate_lcr").outlets] == ["reg.lcr_daily"]


def test_conformance_schedule_is_post_delivery():
    dag = load("daily_liquidity_conformance")
    # The contracts promise extracts by 05:30 America/New_York; conformance
    # must not run before they are due.
    assert "45 5" in str(dag.schedule)


# ---------------------------------------------------------------------------
# Partition resolution for asset-triggered runs
# ---------------------------------------------------------------------------

class _Event:
    def __init__(self, extra):
        self.extra = extra


def test_resolve_as_of_prefers_the_events_partition():
    events = {
        "alm.fct_2052a_positions": [
            _Event({"as_of_date": "2026-06-30", "source_system": "gl_core"}),
            _Event({"as_of_date": "2026-06-30", "source_system": "murex_eu"}),
        ],
        "alm.fct_liquidity_position": [
            _Event({"as_of_date": "2026-06-30", "source_system": "treasury"}),
        ],
    }
    assert resolve_as_of(events, fallback="2099-01-01") == "2026-06-30"


def test_resolve_as_of_refuses_mixed_partitions():
    events = {
        "alm.fct_2052a_positions": [
            _Event({"as_of_date": "2026-06-29", "source_system": "murex_eu"}),
            _Event({"as_of_date": "2026-06-30", "source_system": "gl_core"}),
        ],
    }
    with pytest.raises(ValueError, match="disagree"):
        resolve_as_of(events, fallback="2026-06-30")


def test_resolve_as_of_falls_back_to_logical_date():
    assert resolve_as_of({}, fallback="2026-06-30") == "2026-06-30"
    assert resolve_as_of(None, fallback="2026-06-30") == "2026-06-30"
    with pytest.raises(ValueError, match="nothing names the partition"):
        resolve_as_of({}, fallback=None)
