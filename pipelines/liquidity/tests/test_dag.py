"""The DAG file is a real Airflow DAG with the wiring the module promises."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

DAG_FILE = Path(__file__).parent.parent / "dags" / "daily_liquidity_position.py"


def load_dag():
    spec = importlib.util.spec_from_file_location("daily_liquidity_position_dag", DAG_FILE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.daily_liquidity_position()


def test_dag_parses_and_wires():
    dag = load_dag()
    ids = set(dag.task_ids)
    assert {
        "land", "enforce_contract", "dbt_conform", "fetch_release",
        "apply_rules", "file_2052a", "calculate_lcr", "reconcile",
    } <= ids

    # Contracts gate dbt; dbt gates the rules; both outputs gate reconcile.
    assert "enforce_contract" in {t.task_id for t in dag.get_task("dbt_conform").upstream_list}
    assert "land" in {t.task_id for t in dag.get_task("enforce_contract").upstream_list}
    downstream_of_rules = {t.task_id for t in dag.get_task("apply_rules").downstream_list}
    assert {"file_2052a", "calculate_lcr"} <= downstream_of_rules
    recon_up = {t.task_id for t in dag.get_task("reconcile").upstream_list}
    assert {"file_2052a", "calculate_lcr", "fetch_release"} <= recon_up


def test_dag_schedule_is_post_delivery():
    dag = load_dag()
    # The contracts promise extracts by 05:30 America/New_York; the DAG must
    # not run before they are due.
    assert "45 5" in str(dag.schedule)
