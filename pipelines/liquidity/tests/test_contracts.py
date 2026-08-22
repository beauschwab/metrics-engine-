"""The contracts refuse what they promise to refuse.

Each corruption the simulator can inject maps to a specific named check, and
the assertion is on the check's name — a contract that fails the batch for
the wrong reason is a contract nobody can debug at 5am.
"""

from __future__ import annotations

import pytest

from liquidity_pipeline import config, tasks
from liquidity_pipeline.contracts import ContractViolation, load_contract

AS_OF = "2026-06-30"


def test_contracts_parse():
    for feed, filename in config.FEEDS.items():
        contract = load_contract(config.CONTRACTS_DIR / filename)
        assert contract.primary_key, f"{feed} contract must declare a primary key"
        assert contract.properties


def test_clean_batch_passes():
    tasks.land_extracts(AS_OF)
    for feed in config.FEEDS:
        report = tasks.enforce_feed_contract(feed, AS_OF)
        assert report["passed"] and report["checks"] > 5


@pytest.mark.parametrize(
    ("corrupt", "feed", "check"),
    [
        ("bad_segment", "gl_core", "segment.valid_values"),
        ("null_balance", "gl_core", "balance_usd.not_null"),
        ("stale_date", "gl_core", "dataset.freshness"),
        ("dup_key", "gl_core", "primary_key.unique"),
        ("bad_segment", "murex_eu", "CUST_SEG.valid_values"),
        ("orphan_collateral", "murex_eu", "dataset.securedHasCollateral"),
        ("negative_amount", "treasury", "dataset.nonNegative"),
    ],
)
def test_corrupt_batch_is_refused_by_name(corrupt, feed, check):
    tasks.land_extracts(AS_OF, corrupt={corrupt})
    with pytest.raises(ContractViolation) as err:
        tasks.enforce_feed_contract(feed, AS_OF)
    assert check in {f.name for f in err.value.failures}
    # Leave the warehouse clean for whoever runs next.
    tasks.land_extracts(AS_OF)
