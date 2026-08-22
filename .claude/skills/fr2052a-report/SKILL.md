---
name: fr2052a-report
description: FR 2052a (Complex Institution Liquidity Monitoring Report) domain knowledge for authoring and validating registry rules. Use this whenever a task touches FR 2052a, "2052a", the liquidity monitoring report, product classification (PID), the O.D/O.W/I.A/I.U/I.S/S.B table vocabulary, maturity bucketing for the Fed liquidity feed, or any workspace document named fr2052a_* — including reviewing a classification's coverage, tightening a variance monitor on submission data, or explaining a breach code like "O.D.6" on a dashboard.
---

# FR 2052a — the liquidity data feed

The FR 2052a (OMB 7100-0361) is the Federal Reserve's granular liquidity
report: not a ratio but a *feed* — every asset, funding source, and flow,
classified by product, counterparty, maturity, and collateral, from which
supervisors compute their own view of a firm's liquidity (including an
independent LCR). Because it is a classification exercise over raw positions,
it is the regime where **coverage** is the governing concern: a record that
matches no rule is a record the Fed sees mis-bucketed or not at all.

## Who files, and how often

- Filing population: US firms under Category I–IV prudential standards
  (≥ $100B total assets) and FBOs with ≥ $100B combined US assets.
- **Daily, T+2**: GSIBs (Category I), Category II, and Category III firms
  with ≥ $75B weighted short-term wholesale funding (wSTWF — measured on
  FR Y-15 Schedule G; see the fr-y15-stwf skill).
- **Monthly**: other Category III and Category IV filers.
- Frequency follows category, so a firm crossing a wSTWF threshold changes
  cadence — an effective-dating concern for every rule feeding the report.

## The vocabulary

Data is organized into tables whose keys appear verbatim on this platform's
dashboards (a breach key like `O.D.6 · BANK_SG` is a 2052a table row id):

| Table | Contents |
|---|---|
| `I.A` | Inflows — Assets (the securities/HQLA inventory) |
| `I.U` / `I.S` | Inflows — Unsecured / Secured lending |
| `O.W` | Outflows — Wholesale funding |
| `O.D` | Outflows — Deposits |
| `O.S` / `O.O` | Outflows — Secured funding / Other |
| `S.B` / `S.DC` | Supplemental — Balance sheet / Derivatives & collateral |

Each row carries: a **product** (the PID — the classification this
workspace's `fr2052a_product_id` document produces), a **counterparty
class** (retail, small business, non-financial corporate, sovereign, central
bank, financial, other), a **maturity bucket** (open, overnight, and dated
buckets out past a year), **collateral class** where secured, and reported
**currency/converted** amounts by entity.

## Validating a rule that claims this regime

Work the reg-rationale skill's loop, with these regime-specific checks:

1. **Coverage is the headline.** `test_rules` reports how many records match
   *no* rule — for a 2052a classification that number's meaning is
   "positions the filing mis-states". Treat any increase as a blocking
   finding to raise, never a rounding error.
2. **First-match order is part of the rule.** 2052a products are carved out
   of overlapping populations (e.g. operational vs. non-operational
   deposits); a rule moved above another changes the filing without any
   condition changing. `get_rules` returns evaluation order — read it.
3. **Maturity bucketing must be date-arithmetic, not labels.** A bucket
   boundary (`days_between` off the as-of date) shifted by one day moves
   balances between rows the Fed compares day over day.
4. **Cite the instructions by table.** The citation anchor is
   `FR 2052a Instructions` plus the table/field (e.g. `FR 2052a
   Instructions, O.D — Outflows-Deposits`). The instructions are versioned;
   when a rule implements a specific instructions update, name the vintage
   in the revision message.
5. **Day-over-day movement is supervised.** The Fed diffs daily
   submissions; so should the workspace. Material reclassification belongs
   behind a `variance_monitor` threshold with a cited limit — this is what
   `fr2052a_variance`'s `SIGMA-30`/`SIGMA-60`/`HARD-USD` thresholds do, and
   why their ids surface on the analyst dashboard's exception strip.

## Through to dashboards

A 2052a dashboard row is a *filing* row: its code is the table key, its
breach code is a governed threshold id, and its rationale is the citation on
the classification that produced it. When asked to explain a number like
"O.D.6 moved 125,314 day-over-day", the chain to walk is: threshold →
monitor → report → view → classification rule → citation. Never explain from
memory what the chain can show.

Verify current instructions and thresholds against the Federal Reserve's
reporting-forms page for FR 2052a before citing a vintage — the instructions
are amended, and a stale cite is a false one.
