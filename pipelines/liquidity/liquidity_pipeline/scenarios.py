"""Running the same governed rules over a different world.

A scenario is an **input**, not a model. The run-off rates, the FR 2052a
product classification, the LCR formula and the compiled submission plan are
governed artifacts the registry serves; a stress run reads exactly the same
release as the nightly filing and differs only in the book it reads. That is
the property worth having: a stressed LCR and a reported LCR that disagree
because someone re-implemented the rule for the stress run is precisely the
drift this platform exists to prevent.

Each scenario therefore runs in its **own warehouse** — a separate DuckDB file
in dev, a separate catalog or namespace in prod — so the two runs share
nothing at all except the registry release. Nothing is filtered, nothing is
rewritten, and no plan is munged: the pipeline is simply pointed at a
different world.

    from liquidity_pipeline import scenarios
    scenarios.run("2026-06-30", "base")
    scenarios.run("2026-06-30", "stress")
    scenarios.compare("2026-06-30")

What this deliberately is *not*: a forecast. Nothing here projects a balance
sheet forward — a scenario re-prices today's book under different assumptions.
A multi-period forecast is a genuine modelling capability this pipeline does
not have; the seam is the same shape (the registry computes a period's number
given that period's positions, so a forecast is a question of who supplies
the positions), but the capability is not built and should not be claimed.
"""

from __future__ import annotations

import os
from pathlib import Path

from . import config, lcr, rules, simulate, tasks
from .backend import for_target
from .registry_client import get_registry


def data_dir_for(scenario: str) -> Path:
    """Where a scenario's world lives. Base keeps the default location, so the
    nightly filing is untouched by the existence of scenario runs."""
    simulate.scenario_factors(scenario)
    root = Path(os.environ.get("LIQ_DATA_DIR", config.PIPELINE_ROOT / ".local"))
    return root if scenario == "base" else root / "scenarios" / scenario


def run(as_of_date: str, scenario: str = "base") -> dict:
    """Land, conform, apply the deployed rules, file, and compute the LCR —
    for one scenario, in that scenario's own warehouse."""
    factors = simulate.scenario_factors(scenario)
    previous = os.environ.get("LIQ_DATA_DIR")
    os.environ["LIQ_DATA_DIR"] = str(data_dir_for(scenario))
    try:
        tasks.land_extracts(as_of_date, scenario=scenario)
        for feed in config.FEEDS:
            tasks.enforce_feed_contract(feed, as_of_date)
            tasks.conform_feed(feed, as_of_date)

        release = tasks.fetch_release(as_of_date)
        applied = tasks.apply_rules(as_of_date)
        filed = tasks.file_submission(as_of_date)
        coverage = tasks.compute_lcr(as_of_date)

        backend = for_target()
        try:
            outflows = backend.scalar(
                f"SELECT COALESCE(round(sum(weighted_outflows_30d), 2), 0) "
                f"FROM {rules.REPORT_TABLE} WHERE as_of_date = DATE '{as_of_date}'")
        finally:
            backend.close()

        consolidated = coverage["lcr"]["CONSOLIDATED"]
        return {
            "scenario": scenario,
            "label": factors["label"],
            "as_of_date": as_of_date,
            # The point of the whole exercise: identical in every scenario.
            "channel": release["channel"],
            "release": release["release"],
            "rate_table_revision": release["artifacts"].get("lcr_outflow_rates"),
            "rows": applied["rows"],
            "filed_rows": filed["rows"],
            "filed_weighted_outflows_30d": float(outflows),
            "hqla_total": round(consolidated["hqla_total"], 2),
            "net_outflows_30d": round(consolidated["net_outflows_30d"], 2),
            "lcr_pct": consolidated["lcr_pct"],
        }
    finally:
        if previous is None:
            os.environ.pop("LIQ_DATA_DIR", None)
        else:
            os.environ["LIQ_DATA_DIR"] = previous


def compare(as_of_date: str, names: list[str] | None = None) -> dict:
    """Run every scenario and return them side by side.

    Asserts the thing being demonstrated: every scenario was computed by the
    same registry release. If that ever stops holding, the comparison is
    meaningless and this raises rather than reporting it.
    """
    names = names or list(simulate.SCENARIOS)
    runs = [run(as_of_date, name) for name in names]

    releases = {(r["channel"], r["release"], r["rate_table_revision"]) for r in runs}
    if len(releases) != 1:
        raise RuntimeError(
            "scenarios were computed against different registry releases — "
            f"the comparison would be meaningless: {sorted(releases)}"
        )

    base = next((r for r in runs if r["scenario"] == "base"), runs[0])
    for r in runs:
        r["lcr_delta_pp"] = (
            None if r["lcr_pct"] is None or base["lcr_pct"] is None
            else round(r["lcr_pct"] - base["lcr_pct"], 1)
        )
    return {"as_of_date": as_of_date, "governed_by": releases.pop(), "runs": runs}
