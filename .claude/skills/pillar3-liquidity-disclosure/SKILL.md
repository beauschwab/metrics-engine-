---
name: pillar3-liquidity-disclosure
description: Public liquidity disclosure requirements (LCR disclosure under 12 CFR 249 subpart J, NSFR disclosure under subpart N — the US Pillar 3 liquidity templates) for authoring and validating registry rules. Use this whenever a task touches public LCR/NSFR disclosure, quarterly-average liquidity figures, disclosure templates, reconciling a dashboard number to a published figure, or building measures whose outputs appear in earnings materials or the Pillar 3 report.
---

# Public liquidity disclosure — the number leaves the building

Subpart J (LCR) and subpart N (NSFR) of 12 CFR 249 require covered firms to
*publish* their ratios: prescribed templates, **averages of the reporting
period's values** (for the LCR, averages of daily values over the quarter),
both unweighted and weighted amounts by category, plus a qualitative
discussion. This is the regime where a registry error becomes a *public
restatement* — so its governing concern is **reproducibility**: the
published figure must be recomputable, months later, from the exact rule
revisions in force during the period.

## What the disclosure requires

- **Cadence**: quarterly figures, disclosed on the prescribed template.
- **Averaging**: the LCR disclosure is built from daily observations —
  which means every *day's* rule set matters, not just quarter-end; an
  effective-dated change mid-quarter changes the average.
- **Prescribed rows**: the template's category rows (HQLA by level, outflow
  and inflow categories, ASF/RSF categories) map onto the same
  classifications the filing regimes use — the disclosure is a projection
  of the LCR/NSFR machinery, not a new computation.
- **Qualitative discussion**: the drivers of period-over-period change —
  which is precisely what `assess_change` and the monitor history record as
  a side effect of governed authoring.

## Validating a rule that claims this regime

Work the reg-rationale skill's loop, plus:

1. **Pin what was published.** A disclosure figure must cite the release
   that produced it — this platform's release/channel system exists for
   exactly this: a release pins every artifact revision, so "what rules
   computed Q2's average" has one answer. When authoring for disclosure,
   confirm the period's releases exist and the rules in force are the
   pinned ones.
2. **Averages need the calendar.** Daily averaging means missing days and
   as-of alignment are correctness issues, not data hygiene; a measure
   built for disclosure states its day-count convention in the description.
3. **Template rows are classifications.** If a disclosure row can't be
   produced by the existing LCR/NSFR classifications, the fix is a governed
   classification change (with its own citation), never a mapping table in
   the reporting layer.
4. **Cite the subpart and the template row** (`12 CFR 249.90(b), template
   row 21` shape), and in the revision message name the disclosure period
   the change first affects.
5. **The restatement path is governed too.** If a published figure was
   wrong, the correction is a new revision with rationale plus the
   acknowledgement trail — never an edit that makes history disagree with
   what was published.

## Through to dashboards

This regime closes the loop the platform promises: the committee dashboard,
the internal monitor, and the published template must all be projections of
the same compiled definitions. A dashboard figure that will be disclosed
carries an extra obligation — reconciliation to the published average — so
prefer widgets bound to the same governed measures the disclosure report
reads, and treat any gap between dashboard and disclosure as a defect in the
chain, not a formatting difference to annotate away.
