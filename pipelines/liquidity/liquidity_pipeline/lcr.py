"""The Liquidity Coverage Ratio, per entity and consolidated.

Numerator: the conformed HQLA inventory (post-haircut eligible amounts,
unencumbered rows only — the governed `hqla_total` measure, 12 CFR 249.20-22).

Denominator: the rules-enriched position rows this same run produced —
weighted outflows and inflows inside the 30-day window, inflows recognised
only up to 75% of outflows (12 CFR 249.30(a)(2)), net floored at zero. The
arithmetic restates the governed `fr2052a_outflows` view measure for measure,
and the reconciliation step proves the restatement against the registry's own
compiled plan on every run — two computations of the same number, one of
which is the deployed artifact.

The entity cut treats each legal entity as if it were self-contained (no
cross-entity inflow recognition); CONSOLIDATED applies the cap and floor at
the group level, which is why it is computed from the position rows rather
than by summing the entity rows — a cap applied per entity does not sum to
the cap applied to the group.
"""

from __future__ import annotations

from .backend import Backend

LCR_TABLE = "reg.lcr_daily"
MINIMUM_PCT = 100.0


def _lcr_select(as_of_date: str, entity_expr: str, entity_filter: str = "") -> str:
    return f"""
SELECT
  DATE '{as_of_date}' AS as_of_date,
  COALESCE(h.entity_key, f.entity_key) AS entity_id,
  COALESCE(h.hqla_total, 0) AS hqla_total,
  COALESCE(f.weighted_outflows_30d, 0) AS weighted_outflows_30d,
  COALESCE(f.weighted_inflows_30d, 0) AS weighted_inflows_30d,
  LEAST(COALESCE(f.weighted_inflows_30d, 0), 0.75 * COALESCE(f.weighted_outflows_30d, 0)) AS capped_inflows_30d,
  GREATEST(
    COALESCE(f.weighted_outflows_30d, 0)
      - LEAST(COALESCE(f.weighted_inflows_30d, 0), 0.75 * COALESCE(f.weighted_outflows_30d, 0)),
    0
  ) AS net_outflows_30d,
  100.0 * COALESCE(h.hqla_total, 0) / NULLIF(
    GREATEST(
      COALESCE(f.weighted_outflows_30d, 0)
        - LEAST(COALESCE(f.weighted_inflows_30d, 0), 0.75 * COALESCE(f.weighted_outflows_30d, 0)),
      0
    ), 0
  ) AS lcr_pct
FROM (
  SELECT {entity_expr} AS entity_key, SUM(hqla_eligible_amount) AS hqla_total
  FROM alm.fct_liquidity_position
  WHERE as_of_date = DATE '{as_of_date}' AND is_encumbered = false {entity_filter}
  GROUP BY 1
) h
FULL OUTER JOIN (
  SELECT
    {entity_expr} AS entity_key,
    SUM(CASE WHEN direction = 'OUTFLOW' THEN weighted_amount ELSE 0 END) AS weighted_outflows_30d,
    SUM(CASE WHEN direction = 'INFLOW' THEN weighted_amount ELSE 0 END) AS weighted_inflows_30d
  FROM reg.fr2052a_enriched
  WHERE as_of_date = DATE '{as_of_date}' AND days_to_maturity <= 30 {entity_filter}
  GROUP BY 1
) f ON h.entity_key = f.entity_key
""".strip()


def compute_lcr(backend: Backend, as_of_date: str) -> dict:
    """File reg.lcr_daily for the batch date; return the headline numbers."""
    per_entity = _lcr_select(as_of_date, "entity_id")
    consolidated = _lcr_select(as_of_date, "'CONSOLIDATED'")
    select = f"{per_entity}\nUNION ALL\n{consolidated}"

    backend.overwrite_partition(LCR_TABLE, "as_of_date", as_of_date, select)

    rows = backend.sql(
        f"SELECT entity_id, hqla_total, net_outflows_30d, lcr_pct FROM {LCR_TABLE} "
        f"WHERE as_of_date = DATE '{as_of_date}' ORDER BY entity_id"
    )
    headline = {
        e: {"hqla_total": float(h), "net_outflows_30d": float(n),
            "lcr_pct": None if p is None else round(float(p), 1)}
        for e, h, n, p in rows
    }
    breaches = [
        e for e, v in headline.items()
        if v["lcr_pct"] is not None and v["lcr_pct"] < MINIMUM_PCT
    ]
    return {"table": LCR_TABLE, "lcr": headline, "below_minimum": breaches}
