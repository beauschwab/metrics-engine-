---
name: reg-yy-liquidity
description: Regulation YY internal liquidity risk requirements (12 CFR 252.34–252.35 — liquidity risk management, internal liquidity stress testing, and the liquidity buffer) for authoring and validating registry rules. Use this whenever a task touches internal liquidity stress tests (ILST), stress horizons (overnight / 30-day / 90-day / one-year), the liquidity buffer, highly liquid assets, contingency funding, limits set by the firm's own risk appetite, or monitors whose thresholds cite internal policy rather than the CFR.
---

# Regulation YY — the internal liquidity regime

Where the LCR and NSFR prescribe rates, Regulation YY (12 CFR 252, subpart D
for large US holding companies; parallel subparts for FBOs) prescribes a
*process*: the firm must run its own liquidity stress tests, size its own
buffer, and set its own limits — and be able to show a supervisor the
assumptions, the governance, and the data machinery behind each. On this
platform that maps directly: assumptions are governed rate tables,
stress runs are reports, limits are monitor thresholds, and the audit trail
the regulation demands is the registry's revision history.

## What the regulation requires

| Requirement | Where it lives |
|---|---|
| Liquidity risk management, limits, collateral & intraday monitoring, CFP | § 252.34 |
| Internal liquidity stress testing | § 252.35(a) |
| Liquidity buffer | § 252.35(b) |

The structural points an authoring agent must know:

- **Horizons**: stress tests must cover at least overnight, 30-day, 90-day,
  and one-year planning horizons, at least monthly.
- **The buffer**: unencumbered highly liquid assets sufficient to meet
  projected **30-day stressed net cash outflows**, with fair value
  discounted for credit and market-price volatility. The board (or risk
  committee) approves the buffer's size and composition at least quarterly.
- **Assumptions are governed objects**: outflow assumptions, haircuts, and
  scenario parameters must be documented, reviewed, and conservative — i.e.
  exactly what a cited, effective-dated `parameter_set` provides.
- **MIS**: the firm must be able to collect and aggregate the underlying
  data reliably — the registry's lineage from source binding to report *is*
  this evidence.

## Validating a rule that claims this regime

Work the reg-rationale skill's loop, plus:

1. **Internal numbers cite internal law.** A stress haircut or a limit set
   by risk appetite cites the firm's policy document and approval (e.g.
   `ALCO Liquidity Policy §4.2, approved 2026-05`), not the CFR — § 252.35
   requires the number to exist and be governed; it does not supply the
   number. A CFR cite on a management assumption is a false citation.
2. **Conservatism is reviewable, not asserted.** When an assumption is
   loosened (haircut down, outflow rate down, horizon shortened),
   `assess_change` will flag what it silences; the rationale recorded must
   say why the looser assumption is still conservative. Never acknowledge
   that review yourself.
3. **The buffer test is a monitor.** "Highly liquid assets ≥ 30-day
   stressed net outflow" is a `variance_monitor`-shaped statement: a
   governed threshold with a cited limit, breaching onto the dashboard's
   exception strip — not a spreadsheet check.
4. **Effective-dating follows governance cadence.** Board-approved
   quarterly buffer decisions mean thresholds change on approval dates;
   the effective-dated rule set is how last quarter's filing stays
   reproducible after this quarter's approval.
5. **Do not blur regimes.** ILST outflow assumptions are the firm's;
   LCR rates are the regulation's. Reusing an LCR rate in a stress test is
   a *choice* to justify in the rationale, not a default.

## Through to dashboards

The committee artifact this regime produces — buffer adequacy by horizon,
against board-approved limits — is a dashboard whose every threshold id
resolves to a governed, policy-cited monitor and whose approval trail is the
registry history. When a board pack needs "why is the limit 1.1×", the
answer must be one click deep: threshold → citation → policy → approver.
