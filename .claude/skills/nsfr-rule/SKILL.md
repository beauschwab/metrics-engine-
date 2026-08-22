---
name: nsfr-rule
description: NSFR (Net Stable Funding Ratio, 12 CFR part 249 / Regulation WW subparts K–N) domain knowledge for authoring and validating registry rules. Use this whenever a task touches the NSFR, available stable funding (ASF), required stable funding (RSF), one-year funding horizon rules, ASF/RSF factor tables, or NSFR disclosure — including reviewing a rate table of ASF or RSF factors, building an NSFR measure or monitor, or explaining an NSFR figure on a dashboard.
---

# NSFR — the one-year funding ratio

The NSFR (12 CFR part 249, subparts K–M) requires
`available stable funding ÷ required stable funding ≥ 1.0` (§ 249.100) over a
one-year horizon. Where the LCR prices a 30-day run, the NSFR prices the
balance sheet's *funding structure*: every liability gets an **ASF factor**
(how reliably it stays) and every asset an **RSF factor** (how hard it is to
fund), each prescribed by regulation. Like the LCR it is a prescribed-rate
regime — the same citation-precision discipline applies — but the population
is the whole balance sheet, so completeness of classification matters the
way coverage matters for FR 2052a.

## The citation map

| What the rule does | Where it lives |
|---|---|
| The ratio and 100% minimum | § 249.100 |
| ASF factors by liability category | §§ 249.103–104 |
| RSF factors by asset category | §§ 249.105–106 |
| Derivatives treatment | § 249.107 |
| Tailoring (100/85/70% RSF adjustment by category) | subpart K as amended by the 2019 tailoring rule |
| Public disclosure | subpart N — see pillar3-liquidity-disclosure |

Representative anchors (verify against current eCFR before citing):

- **ASF**: regulatory capital and ≥ 1-year liabilities 100%; stable retail
  deposits 95%; other retail 90%; non-financial wholesale and operational
  deposits 50%; financial-entity funding < 6 months 0%.
- **RSF**: currency and central-bank reserves 0%; unencumbered Level 1
  securities 5%; Level 2A 15%; Level 2B 50%; loans to financial entities
  < 6 months secured by Level 1 10–15%; performing loans < 1 year 50%;
  residential mortgages ≥ 1 year at ≤ 50% risk weight 65%; other performing
  loans ≥ 1 year 85%; nonperforming and other assets 100%; undrawn
  committed facilities 5%. Encumbrance raises RSF — an asset pledged ≥ 1
  year funds nothing.

## Validating a rule that claims this regime

Work the reg-rationale skill's loop, plus:

1. **Factor ↔ subsection agreement**, same discipline as the LCR: the
   figure must be the one the cited subsection prescribes for that exact
   category, and maturity/counterparty carve-outs must live in the
   classification, not in prose.
2. **The two sides are different documents.** ASF classifies liabilities,
   RSF classifies assets; a change to one side cannot "fix" the ratio
   without the other side's context. Read `preview_report` for the ratio,
   not just the edited table.
3. **Maturity is the pivot.** Most factor cliffs sit at 6 months and 1
   year; bucketing must be date arithmetic from as-of, shared with (not
   copied from) the 2052a maturity logic — a shared `prepared_source` stage
   beats two implementations that agree today.
4. **Encumbrance state is data, not assumption.** An RSF rule that ignores
   encumbrance understates required funding; confirm the source binding
   carries the encumbrance column before writing rules that read it.
5. **Tailoring follows the same category machinery as the LCR** (85% for
   most Category III, 70% for Category IV with ≥ $50B wSTWF); the wSTWF
   input is FR Y-15 Schedule G — see fr-y15-stwf.

## Through to dashboards

NSFR is a quarterly-cadence committee number; its dashboard treatment is the
trend and the distance to the floor plus internal buffer, both as governed
monitor thresholds with cited limits. The disclosure obligation (subpart N)
means the dashboard figure must reconcile to the published quarterly
averages — one more reason the dashboard may only *reference* the governed
measure, never restate it.
