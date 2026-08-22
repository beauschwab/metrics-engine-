---
name: lcr-rule
description: LCR (Liquidity Coverage Ratio, 12 CFR part 249 / Regulation WW subparts A–J) domain knowledge for authoring and validating registry rules. Use this whenever a task touches the LCR, lcr_pct, HQLA levels and haircuts, outflow or inflow rates, the 75% inflow cap, the maturity mismatch add-on, outflow adjustment percentages (100/85/70), or any workspace measure in the liquidity_pit chain — including reviewing a rate table entry citing 12 CFR 249.32, tightening an LCR monitor, or explaining an LCR number on a dashboard.
---

# LCR — the 30-day coverage ratio

The LCR (12 CFR part 249, Regulation WW) requires
`HQLA amount ÷ total net cash outflows over 30 days ≥ 1.0` (§ 249.10). It is
the regime of **prescribed rates**: nearly every number in an LCR rule set is
a percentage the regulation states outright, which makes citation precision
the governing concern — a rate is either the one the subsection prescribes or
it is wrong, and `assess_change` will notice a rate that moved without its
citation moving.

## The citation map

| What the rule does | Where it lives |
|---|---|
| The ratio and 100% minimum | § 249.10 |
| HQLA eligibility criteria | § 249.20 (Level 1 / 2A / 2B) |
| HQLA operational requirements | § 249.22; caps via § 249.21 |
| Total net cash outflow, 75% inflow cap, maturity mismatch add-on | § 249.30 |
| Outflow rates | § 249.32, by subsection |
| Inflow rates | § 249.33 |
| Outflow adjustment percentages (tailoring) | § 249.30 as amended by the 2019 tailoring rule |
| Public disclosure | subpart J (§ 249.90 ff) — see pillar3-liquidity-disclosure |

Representative anchors (verify the exact figure against current eCFR text
before citing — these locate the provision, they do not replace it):

- **HQLA haircuts/caps**: Level 1 unhaircut; Level 2A 15% haircut; Level 2B
  50% haircut; Level 2 ≤ 40% of HQLA, Level 2B ≤ 15%.
- **Outflows (§ 249.32)**: stable retail deposits 3% (a)(1); other retail
  10% (a)(2); operational deposits 25% (h)(3); non-financial wholesale
  unsecured 20–40% by insurance; financial-entity unsecured 100%; secured
  funding by collateral class (Level 1-backed 0% … non-HQLA 100%) (j);
  committed facilities by counterparty and credit/liquidity type (e).
- **Inflows (§ 249.33)**: capped at 75% of outflows; retail 50%; financial
  counterparty 100%; non-financial wholesale 50%; secured lending by
  collateral.
- **Tailoring**: outflow adjustment 100% (Category I/II and Category III
  with ≥ $75B wSTWF), 85% (other Category III), 70% (Category IV with
  ≥ $50B wSTWF); Category IV below that has no LCR requirement. wSTWF comes
  from FR Y-15 Schedule G — see fr-y15-stwf.

## Validating a rule that claims this regime

Work the reg-rationale skill's loop, plus:

1. **Rate ↔ subsection agreement.** For every rate table entry, check that
   the figure is the one its cited subsection prescribes for that product
   and counterparty. A correct rate under the wrong cite still fails: it
   breaks the examiner's path from number to law.
2. **Population before rate.** An outflow rate applies to a *defined*
   population (stable vs. other retail turns on insurance and relationship
   facts). Confirm the classification that feeds the rate actually encodes
   the subsection's definition, not a colloquial version of it.
3. **The caps are arithmetic, not policy.** The 40%/15% HQLA caps and the
   75% inflow cap belong in the measure formulas, never as data someone can
   edit. If asked to make a cap a parameter, refuse and say why.
4. **Both sides of the ratio move.** A change to a classification feeding
   outflows can move `lcr_pct` through the denominator alone — always read
   `preview_report` and the measure deltas, not just the edited document.
5. **Monitors carry the minimum.** The 100% floor is a governed threshold,
   as are any internal buffers above it (e.g. management triggers at 105% /
   110%). Internal triggers cite the firm's own policy document, not the
   CFR — a citation must name the *actual* source of the number.

## Through to dashboards

An LCR tile that renders `lcr_pct` inherits its meaning from the registry:
the description says what it is, the citation says where the formula's rates
come from, and the exception strip's codes are monitor threshold ids. The
number the committee sees and the number § 249.10 defines must be the same
compiled definition — if a dashboard wants a "stressed LCR" or any variant,
that is a new governed measure with its own citation, never a multiplier in
the client.
