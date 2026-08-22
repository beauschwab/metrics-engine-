"""Stand-ins for the source systems.

In production the landing task pulls what the contract's ``servers`` block
names — a bucket the GL export writes, a Murex extract drop. A reference
implementation needs the pipeline runnable on a laptop, so this module plays
the producers: three deterministic extract writers, one per contract, seeded
so the same as-of date always yields byte-identical files.

The generated book respects the invariants the downstream rules depend on —
secured positions carry a real collateral class, unsecured ones carry
``UNSECURED``, segments stay inside the contract's domain — because the
governed classification declares ``on_no_match: error`` and a fabricated row
no rule matches would (correctly) kill the run. Breaking those invariants is
exactly what ``corrupt`` is for: each flag injects one specific contract
violation so tests can watch enforcement refuse the batch.
"""

from __future__ import annotations

import csv
import random
from datetime import date, timedelta
from pathlib import Path

#: Scenario worlds. A scenario changes the *book* — balances, HQLA, how much
#: of what was promised actually arrives — and never the rules: run-off rates,
#: product classification and the LCR formula are governed artifacts the
#: registry serves, identical in every world. That separation is the point: a
#: stressed LCR and a reported LCR that disagree because someone
#: re-implemented the rule for the stress run is exactly the drift this
#: platform exists to prevent.
#:
#: The multipliers below are illustrative of a Reg YY-style internal liquidity
#: stress (12 CFR 252.35) — a deposit run, inflows that do not arrive, and a
#: monetisation haircut on the buffer. They are not a calibrated scenario; a
#: real deployment would source them from a governed scenario artifact rather
#: than a constant in a simulator.
SCENARIOS = {
    "base": {
        "label": "Base — the book as it stands",
        "outflow_balance": 1.00,
        "inflow_balance": 1.00,
        "hqla_haircut": 1.00,
    },
    "stress": {
        "label": "Stress — 30-day idiosyncratic liquidity stress",
        # Deposits and drawdowns run harder than contract.
        "outflow_balance": 1.25,
        # Counterparties stop paying on time; recognised inflows fall away.
        "inflow_balance": 0.70,
        # The buffer is monetised into a falling market.
        "hqla_haircut": 0.88,
    },
}


def scenario_factors(scenario: str) -> dict:
    if scenario not in SCENARIOS:
        raise ValueError(f"unknown scenario {scenario!r} — one of {sorted(SCENARIOS)}")
    return SCENARIOS[scenario]


def _flow_factor(factors: dict, direction: str) -> float:
    """How much of this position the scenario says is really there."""
    return factors["outflow_balance"] if direction == "OUTFLOW" else factors["inflow_balance"]


ENTITIES_GL = ["BANK_US", "BANK_SG"]
ENTITIES_MUREX = ["BANK_UK", "BANK_DE"]
ENTITIES_ALL = ["BANK_US", "BANK_UK", "BANK_SG", "BANK_DE"]

SEGMENTS = ["RETAIL", "SMALL_BUSINESS", "WHOLESALE"]
SEGMENT_CODES = {"RETAIL": "RTL", "SMALL_BUSINESS": "SBB", "WHOLESALE": "WSL"}
COUNTERPARTIES = ["RETAIL", "SMB", "NONFIN_CORP", "FINANCIAL", "SOVEREIGN"]
ACCOUNT_TYPES = ["TRANSACTIONAL", "SAVINGS", "TIME", "OPERATIONAL", "NON_OPERATIONAL"]
COLLATERAL = ["L1", "L2A", "L2B", "NON_HQLA"]
HQLA_LEVELS = ["L1", "L2A", "L2B"]


def _position(rng: random.Random, as_of: date) -> dict:
    """One canonical-vocabulary position; feed writers reshape it."""
    secured = rng.random() > 0.72
    inflow = rng.random() > 0.70
    # Half the maturing book lands inside the 30-day LCR window, and a slice
    # has no contractual maturity at all — both populations matter downstream.
    open_position = rng.random() > 0.85
    maturity = None if open_position else as_of + timedelta(days=rng.randint(1, 60))
    return {
        "currency": "EUR" if rng.random() > 0.75 else "USD",
        "segment": rng.choice(SEGMENTS),
        "counterparty_type": rng.choice(COUNTERPARTIES),
        "account_type": rng.choice(ACCOUNT_TYPES),
        "insured_flag": rng.random() > 0.4,
        "is_secured": secured,
        "collateral_class": rng.choice(COLLATERAL) if secured else "UNSECURED",
        "direction": "INFLOW" if inflow else "OUTFLOW",
        "maturity_date": maturity,
        "balance_usd": round((0.5 + rng.random()) * (0.4e6 if inflow else 1.0e6), 2),
    }


def write_gl_core_extract(out: Path, as_of_date: str, corrupt: set[str] = frozenset(),
                          scenario: str = "base") -> Path:
    as_of = date.fromisoformat(as_of_date)
    f = scenario_factors(scenario)
    rng = random.Random(f"gl_core:{as_of_date}")
    path = out / "gl_core_positions_daily.csv"
    rows = []
    for entity in ENTITIES_GL:
        for k in range(120):
            p = _position(rng, as_of)
            rows.append({
                "position_id": f"GL-{entity}-{k:05d}",
                "as_of_date": as_of_date,
                "entity_id": entity,
                "currency": p["currency"],
                "segment": p["segment"],
                "counterparty_type": p["counterparty_type"],
                "account_type": p["account_type"],
                "insured_flag": str(p["insured_flag"]).lower(),
                "is_secured": str(p["is_secured"]).lower(),
                "collateral_class": p["collateral_class"],
                "direction": p["direction"],
                "maturity_date": p["maturity_date"].isoformat() if p["maturity_date"] else "",
                "balance_usd": f"{p['balance_usd'] * _flow_factor(f, p['direction']):.2f}",
            })

    if "bad_segment" in corrupt:
        rows[3]["segment"] = "PUBLIC_SECTOR"
    if "null_balance" in corrupt:
        rows[5]["balance_usd"] = ""
    if "stale_date" in corrupt:
        rows[7]["as_of_date"] = (as_of - timedelta(days=1)).isoformat()
    if "dup_key" in corrupt:
        rows.append(dict(rows[0]))

    _write(path, rows)
    return path


def write_murex_extract(out: Path, as_of_date: str, corrupt: set[str] = frozenset(),
                        scenario: str = "base") -> Path:
    as_of = date.fromisoformat(as_of_date)
    f = scenario_factors(scenario)
    compact = as_of_date.replace("-", "")
    rng = random.Random(f"murex_eu:{as_of_date}")
    path = out / "murex_eu_positions_daily.csv"
    rows = []
    for entity in ENTITIES_MUREX:
        for k in range(110):
            p = _position(rng, as_of)
            rows.append({
                "TRADE_ID": f"MX-{entity[-2:]}-{k:06d}",
                "COB_DATE": compact,
                "LEGAL_ENT": entity,
                "CCY": p["currency"],
                "CUST_SEG": SEGMENT_CODES[p["segment"]],
                "CPTY_TYPE": p["counterparty_type"],
                "ACCT_TYPE": p["account_type"],
                "FDIC_INS": "Y" if p["insured_flag"] else "N",
                "SECURED_FLG": "Y" if p["is_secured"] else "N",
                "COLL_CLASS": p["collateral_class"],
                "FLOW_DIR": "I" if p["direction"] == "INFLOW" else "O",
                "MAT_DATE": p["maturity_date"].strftime("%Y%m%d") if p["maturity_date"] else "00000000",
                "BAL_AMT_USD": f"{p['balance_usd'] * _flow_factor(f, p['direction']):.2f}",
            })

    if "bad_segment" in corrupt:
        rows[3]["CUST_SEG"] = "XX"
    if "orphan_collateral" in corrupt:
        rows[9]["SECURED_FLG"] = "N"
        rows[9]["COLL_CLASS"] = "L1"

    _write(path, rows)
    return path


def write_treasury_extract(out: Path, as_of_date: str, corrupt: set[str] = frozenset(),
                           scenario: str = "base") -> Path:
    f = scenario_factors(scenario)
    rng = random.Random(f"treasury:{as_of_date}")
    path = out / "treasury_hqla_daily.csv"
    rows = []
    for entity in ENTITIES_ALL:
        for k in range(45):
            level = rng.choice(HQLA_LEVELS)
            rows.append({
                "security_id": f"SEC-{k:04d}",
                "entity_id": entity,
                "as_of_date": as_of_date,
                "hqla_level": level,
                # Post-haircut amounts: level 1 dominates a real buffer.
                "hqla_eligible_amount":
                    f"{(1.5 + rng.random()) * (2.2e6 if level == 'L1' else 0.8e6) * f['hqla_haircut']:.2f}",
                "is_encumbered": str(rng.random() < 0.12).lower(),
                "currency": "EUR" if rng.random() > 0.8 else "USD",
            })

    if "negative_amount" in corrupt:
        rows[2]["hqla_eligible_amount"] = "-1000.00"

    _write(path, rows)
    return path


WRITERS = {
    "gl_core": write_gl_core_extract,
    "murex_eu": write_murex_extract,
    "treasury": write_treasury_extract,
}


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
