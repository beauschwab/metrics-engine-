"""A scenario is an input, not a model.

The property under test is not the stressed number itself — it is that the
stressed number was produced by *the same governed release* as the filed one.
A stress run that quietly used different rules would still produce a
plausible LCR, and that is exactly the failure this pipeline exists to make
impossible.
"""

from __future__ import annotations

import pytest

from liquidity_pipeline import scenarios, simulate

AS_OF = "2026-06-30"


@pytest.fixture(scope="module")
def compared():
    return scenarios.compare(AS_OF)


def test_every_scenario_is_computed_by_one_governed_release(compared):
    channel, release, rate_revision = compared["governed_by"]
    assert channel == "production"
    assert release and rate_revision
    # compare() raises if the releases diverge; assert the runs agree too.
    assert {(r["channel"], r["release"], r["rate_table_revision"]) for r in compared["runs"]} == {
        (channel, release, rate_revision)
    }


def test_stress_moves_the_world_not_the_rules(compared):
    runs = {r["scenario"]: r for r in compared["runs"]}
    base, stress = runs["base"], runs["stress"]
    factors = simulate.SCENARIOS["stress"]

    # The book is the same book — same positions, same filed grain.
    assert stress["rows"] == base["rows"]
    assert stress["filed_rows"] == base["filed_rows"]

    # What moved is the amounts, by exactly the scenario's own factors.
    assert stress["hqla_total"] == pytest.approx(
        base["hqla_total"] * factors["hqla_haircut"], rel=1e-6)
    assert stress["filed_weighted_outflows_30d"] == pytest.approx(
        base["filed_weighted_outflows_30d"] * factors["outflow_balance"], rel=1e-6)


def test_stress_is_materially_tighter(compared):
    runs = {r["scenario"]: r for r in compared["runs"]}
    assert runs["stress"]["lcr_pct"] < runs["base"]["lcr_pct"]
    assert runs["stress"]["lcr_delta_pp"] < 0
    assert runs["base"]["lcr_delta_pp"] == 0


def test_scenarios_do_not_share_a_warehouse(compared):
    """Separate worlds, so nothing but the registry release is common."""
    assert scenarios.data_dir_for("base") != scenarios.data_dir_for("stress")


def test_unknown_scenario_is_refused():
    with pytest.raises(ValueError, match="unknown scenario"):
        simulate.scenario_factors("apocalypse")
