"""Applying the governed rules: classification, rates, and the row stage.

The registry is the compiler and this module is deliberately not one. What it
does is *assemble*: take the classification resolved to evaluation order and
the rate table pinned by the manifest, and emit the row-stage SQL that the
governed `fr2052a_prepared` document declares — product ID first, then the
rate the product ID keys, then the weighted amount. The result lands as
``reg.fr2052a_enriched``, the position-level audit trail behind both the LCR
and the submission: every row shows which rule fired and what rate it drew.

Two things are treated as law rather than convention:

  * Rule order. The registry serves rules in evaluation order and the CASE
    chain preserves it — `O.D.1` before `O.D.3` is the difference between a
    3% and a 10% run-off on every insured retail balance.
  * ``on_no_match: error``. A position no rule matches is not a small gap; it
    is a balance missing from a regulatory submission. The classification
    declares error semantics, so an unmapped row fails the task.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import yaml

from .backend import Backend
from .registry_client import Registry


@dataclass(frozen=True)
class ReleaseInfo:
    """What computed tonight's numbers — logged into every output row set."""

    channel: str
    release: int
    rules_name: str
    rules_effective_from: str
    rate_set_revision: int


# ---------------------------------------------------------------------------
# SQL assembly from registry responses
# ---------------------------------------------------------------------------

def classification_case(rules_response: dict) -> str:
    """The ordered rule set as one CASE chain; NULL marks an unmapped row.

    The `when` predicates arrive as the registry's canonical expression
    syntax, which is the SQL subset both engines share (=, in, and, boolean
    literals) — they are embedded verbatim, citations kept as comments so the
    emitted SQL reads like the rule set it implements.
    """
    arms = [
        f"    WHEN {r['when']} THEN '{r['emit']}'  -- {r['id']}: {r.get('citation', '')}"
        for r in rules_response["rules"]
    ]
    return "CASE\n" + "\n".join(arms) + "\n    ELSE NULL\n  END"


def parameter_entries(artifact_response: dict) -> tuple[int, list[dict]]:
    """Rate entries out of a parameter_set artifact body, revision attached."""
    body = yaml.safe_load(artifact_response["body"])
    if body.get("kind") != "parameter_set":
        raise ValueError(f"{artifact_response.get('name')} is not a parameter_set")
    return artifact_response["revision"], body["entries"]


def rates_case(entries: list[dict], key: str = "product_id", value: str = "outflow_rate") -> str:
    """The bounded rate table as a literal mapping — no join, no fan-out,
    exactly as the registry's own compiler inlines it."""
    arms = [f"    WHEN '{e[key]}' THEN {e[value]}" for e in entries]
    return f"CASE {key}\n" + "\n".join(arms) + "\n    ELSE NULL\n  END"


def _days_to_maturity(dialect: str) -> str:
    # An open position is demandable now: null maturity coalesces to zero
    # days, not to a null that would drop out of the <= 30 filter. Mirrors
    # the registry compiler's own days_between emission.
    if dialect == "spark":
        return "COALESCE(datediff(maturity_date, as_of_date), 0)"
    return "COALESCE(DATE_DIFF('day', as_of_date, maturity_date), 0)"


def enrichment_sql(
    dialect: str,
    as_of_date: str,
    classification_sql: str,
    rates_sql: str,
    source: str = "alm.fct_2052a_positions",
) -> str:
    """The row stage over the conformed table, one CTE per derived column —
    a column must exist before the next stage can read it."""
    return f"""
WITH base AS (
  SELECT * FROM {source}
  WHERE as_of_date = DATE '{as_of_date}'
),
classified AS (
  SELECT *,
  {classification_sql} AS product_id
  FROM base
),
rated AS (
  SELECT *,
  {rates_sql} AS outflow_rate
  FROM classified
),
staged AS (
  SELECT *,
    {_days_to_maturity(dialect)} AS days_to_maturity
  FROM rated
)
SELECT *,
  balance_usd * outflow_rate AS weighted_amount
FROM staged
""".strip()


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

ENRICHED_TABLE = "reg.fr2052a_enriched"


class UnmappedPositions(Exception):
    """on_no_match: error — rows exist that no classification rule matches."""


def apply_rules(backend: Backend, registry: Registry, as_of_date: str) -> dict:
    """Fetch the deployed rules, run the row stage, refuse unmapped rows.

    Returns a summary the DAG passes downstream: the release that computed
    the rows, the row count, and the rule-coverage histogram (which rule
    fired, on how many rows, moving how much balance).
    """
    manifest = registry.manifest()
    release = manifest["release"]["version"]

    rules = registry.rules("fr2052a_product_id", as_of=as_of_date)
    pinned = {a["name"]: a["revision"] for a in manifest["artifacts"]}
    rates_artifact = registry.artifact("lcr_outflow_rates", revision=pinned.get("lcr_outflow_rates"))
    rate_revision, entries = parameter_entries(rates_artifact)

    select = enrichment_sql(
        backend.dialect,
        as_of_date,
        classification_case(rules),
        rates_case(entries),
    )
    backend.overwrite_partition(ENRICHED_TABLE, "as_of_date", as_of_date, select)

    unmapped = backend.scalar(
        f"SELECT count(*) FROM {ENRICHED_TABLE} "
        f"WHERE as_of_date = DATE '{as_of_date}' AND product_id IS NULL"
    )
    if unmapped:
        sample = backend.sql(
            f"SELECT source_system, position_id, segment, direction, counterparty_type "
            f"FROM {ENRICHED_TABLE} "
            f"WHERE as_of_date = DATE '{as_of_date}' AND product_id IS NULL LIMIT 5"
        )
        raise UnmappedPositions(
            f"{unmapped} positions matched no rule in {rules['name']} "
            f"(release r{release}, on_no_match: error). First few: {sample}"
        )

    coverage = backend.sql(
        f"SELECT product_id, count(*), sum(balance_usd) FROM {ENRICHED_TABLE} "
        f"WHERE as_of_date = DATE '{as_of_date}' GROUP BY 1 ORDER BY 1"
    )
    total = backend.scalar(
        f"SELECT count(*) FROM {ENRICHED_TABLE} WHERE as_of_date = DATE '{as_of_date}'"
    )
    return {
        "release": release,
        "channel": rules["channel"],
        "rules": rules["name"],
        "rate_set_revision": rate_revision,
        "rows": int(total),
        "coverage": [
            {"product_id": p, "rows": int(n), "balance_usd": float(b)} for p, n, b in coverage
        ],
    }


# ---------------------------------------------------------------------------
# The submission plan, as the registry compiled it
# ---------------------------------------------------------------------------

_AS_OF_LITERAL = re.compile(r"(as_of_date\s*=\s*DATE\s*')\d{4}-\d{2}-\d{2}(')")


def rebind_as_of(plan_sql: str, as_of_date: str) -> str:
    """Point the compiled plan at the batch date.

    The registry compiles plans against its pinned as-of (the workspace
    fixture date); a runtime consumer rebinds the one date literal to the
    batch it is filing. This is a stopgap worth removing — the plan endpoint
    growing an ``asOf`` parameter would let the compiler bind it — and it is
    kept to exactly one well-shaped substitution so a future change in plan
    shape fails loudly here rather than filing the wrong day.
    """
    rebound, n = _AS_OF_LITERAL.subn(rf"\g<1>{as_of_date}\g<2>", plan_sql)
    if n != 1:
        raise ValueError(
            f"expected exactly one as_of_date literal in the compiled plan, found {n} — "
            "the plan shape changed; review rebind_as_of"
        )
    return rebound


def split_plan(text: str) -> tuple[str, str | None]:
    """Query half and materialize half; the pipeline owns the write."""
    if "-- materialize" in text:
        query, write = text.split("-- materialize", 1)
        return query.strip().rstrip(";"), write.strip()
    return text.strip().rstrip(";"), None


REPORT_TABLE = "reg.fr2052a_daily"


def run_submission(backend: Backend, registry: Registry, as_of_date: str) -> dict:
    """Execute the compiled fr2052a_submission plan and file the partition.

    The query half is the registry's, byte-for-byte apart from the as-of
    rebind; the write is the backend's ``overwrite_partition``, which is the
    same overwrite_partitions contract the report document declares for its
    Iceberg target.
    """
    plan = registry.plan("fr2052a_submission", target="sql")
    query, _materialize = split_plan(plan["text"])
    query = rebind_as_of(query, as_of_date)

    filed = backend.overwrite_partition(REPORT_TABLE, "as_of_date", as_of_date, query)
    return {
        "release": plan.get("release"),
        "table": REPORT_TABLE,
        "rows": int(filed),
    }
