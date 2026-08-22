---
name: fr-y15-stwf
description: FR Y-15 (Systemic Risk Report) domain knowledge, focused on Schedule G short-term wholesale funding, for authoring and validating registry rules. Use this whenever a task touches FR Y-15, wSTWF / weighted short-term wholesale funding, the $50B / $75B wSTWF thresholds that set LCR outflow adjustments and FR 2052a daily filing, GSIB surcharge method 2 inputs, or category tailoring — including any rule whose applicability or frequency depends on which prudential category the firm is in.
---

# FR Y-15 — where the tailoring thresholds come from

The FR Y-15 is the quarterly systemic risk report whose indicators drive two
things treasury cares about: the **GSIB surcharge** (method 2 uses
short-term wholesale funding in place of substitutability) and — through
**weighted short-term wholesale funding (wSTWF, Schedule G)** — the
**category tailoring** that decides how hard the other liquidity regimes
bite. It matters to a rules registry less as a report to file than as the
*input to applicability*: whether the LCR runs at 100/85/70%, and whether
FR 2052a files daily or monthly, are functions of numbers this report
measures.

## The threshold machinery

- Categories (2019 tailoring): **I** = US GSIBs; **II** = ≥ $700B assets or
  ≥ $75B cross-jurisdictional activity; **III** = ≥ $250B assets or ≥ $75B
  in wSTWF, nonbank assets, or off-balance-sheet exposure; **IV** = other
  firms ≥ $100B.
- **wSTWF ≥ $75B** → full (100%) LCR/NSFR for Category III, and daily
  FR 2052a.
- **wSTWF ≥ $50B** → LCR/NSFR at 70% for Category IV (below it, none).
- wSTWF weights funding by remaining maturity and counterparty type and is
  averaged over the measurement period — it moves, and category status
  moves with it.

## Validating a rule that claims this regime

Work the reg-rationale skill's loop, plus:

1. **Applicability is data, not configuration.** If a workspace encodes "we
   file daily" or "our outflow adjustment is 85%", that fact derives from
   wSTWF and category — record *why* (the category, the measurement, the
   date) in the rationale, so the day the firm crosses a threshold the
   stale assumption is findable, not folklore.
2. **STWF classification mirrors 2052a vocabulary.** Schedule G buckets
   short-term funding by maturity and counterparty much as the O.W/O.D
   tables do; where both are built here, share the stage
   (`prepared_source`) rather than maintaining two bucketings that agree
   today.
3. **Cite the schedule.** Anchors are `FR Y-15 Instructions, Schedule G`
   (and the specific line item); tailoring consequences cite the tailoring
   rule's amendments to 12 CFR 249 / 252, not the Y-15 itself.
4. **Cadence: quarterly, with averaging.** Rules feeding Y-15 quantities
   must be effective-dated to quarter boundaries and their revision
   messages should name the reporting quarter.

## Through to dashboards

The dashboard artifact this regime wants is a *threshold-distance* view:
current wSTWF against the $50B/$75B lines, as governed monitors — because
crossing one re-prices every other liquidity obligation the firm has. A
breach here is not a limit violation; it is a regime change, and the
rationale a committee needs is exactly the chain this platform stores.
