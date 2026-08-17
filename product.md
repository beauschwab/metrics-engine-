# Product definition

Two surfaces over one governed metrics registry.

**The Metrics Definition Layer** is where a definition is authored: a liquidity
analyst writes an FR 2052a rule, watches the number it produces, and reads the
plan the nightly pipeline will run. **Chartroom** is where a definition is
consumed: an agent-guided studio for dashboards whose every number traces back
to a registry function.

They are one product because they answer the same question at two ends of the
same pipe — *is this number right, and can I prove it?* — and because the
second is only credible if the first is real. A dashboard that cites a
governed definition is worth something only when that definition is itself
authored, versioned, and reviewed somewhere you can point at.

---

## 1. The problem

A regulated number has a long way to travel between the rule that defines it
and the slide a committee approves. Today it is retyped at every hop.

`lcr_pct` is defined once, under an SR 11-7 tier, with a citation and a
revision history. Then somebody writes `100.0 * [HQLA] / [Net Outflows]` into a
Tableau calculated field, and *that* is the number the committee sees. The two
drift — a rounding rule here, a filter there — and the drift is undetectable
because nothing compares them.

**Drift you cannot detect is worse than a wrong number you can.** A wrong
number gets caught and fixed. Undetected drift gets defended, because both
sides are certain they are reading the governed figure.

The dashboard half has its own version of this. Users vibe-code one-off HTML
dashboards: creative, fast, and ungoverned. The output cannot be reviewed or
diffed, reaches data through ad-hoc paths with unknown performance, embeds
calculation logic that duplicates and then drifts from the governed
definition, and has no path from "my thing" to "the team's thing" to "the
certified thing."

## 2. What we build instead

**The agent never writes dashboard code.** It writes a *dashboard spec* — a
declarative document where every number is a registry reference and every
visual comes from a reviewed widget catalog. The spec is the unit of review,
versioning, linting, and promotion. Rendering is a deterministic interpreter,
so performance is a property of the platform rather than of whatever HTML the
agent happened to emit that day.

**The engine is the single source of every number.** The definition compiles
once, to SQL, Polars, and PySpark, and to the semantic views a BI tool points
at. When a warehouse serves a query, it runs the engine's own compiled SQL —
not a reimplementation that agrees today.

## 3. Three promises

1. **Control.** Every calculation is a governed semantic function; every visual
   passes the design guide; every dashboard is a reviewable artifact with
   lineage and an audit trail naming the human behind each act.
2. **Performance against real data.** One query compilation path, an
   aggregates-only boundary that is structural rather than policed, and
   pushdown to the warehouse. No client-side full-table hauls.
3. **A promotion pipeline.** draft → team → certified, with human approval
   gates, pinned registry revisions, and outward registration for
   discoverability and lineage.

## 4. Principles

**P1 — Spec-first, never code-first.** Freeform HTML/JS is structurally
impossible, not merely discouraged. Custom visuals enter through the widget
catalog's own review process.

**P2 — The registry is the only data API.** A widget binds
`metric_ref + dims + filters + params`. There is no raw SQL surface in a
dashboard spec. A calculation that doesn't exist becomes a *proposal*, not
inlined math.

**P3 — Plan before pixels.** A Design Brief is approved before anything is
composed. The brief is a first-class artifact, so intent is auditable when a
dashboard is challenged later.

**P4 — The design guide is executable.** Not a PDF the agent "adheres to" — a
linter with rule IDs, golden tests, and one-click fixes. Style is enforced the
way schema is enforced.

**P5 — Compose from patterns, justify departures.** Instantiate a reviewed
archetype or write down why none fits. The single biggest lever against
dashboard sprawl.

**P6 — Humans approve at every boundary.** The agent proposes; named humans
approve. This is the SR 11-7 posture: the agent is a development tool, never an
approver. Approval, stewardship decisions, and promotion are refused to
`agent:*` identities at the API — permanently, not by configuration.

**P7 — Refuse rather than guess.** Every layer would rather say what it cannot
do than produce something plausible. The compiler refuses to emit SQL for
`ema()` instead of approximating it. A gauge with no declared limit direction
draws the gap and declines to call it a breach. A stacked area whose bands go
negative renders a refusal instead of clamping them and overstating the total.
A model outage degrades to a banner, never a block.

## 5. Who it is for

| Role | What they do here |
|---|---|
| **Definition author** (ALM/liquidity analyst) | Writes rules, watches the number and its derivation trace, reads what a change would move |
| **Dashboard author** | Talks to the agent, approves the brief, iterates against live numbers |
| **Metric steward** | Decides proposals; approval *is* a registry write |
| **Design steward** | Owns the guide and the widget/pattern catalogs |
| **Reviewer / committee** | Reads a versioned artifact with its brief, lint report, and commentary attached |

## 6. What ships today

Nine phases are built, verified, and merged. The engine and both surfaces run.

**Authoring** — six document kinds (`metrics_view`, `classification`,
`parameter_set`, `report`, `variance_monitor`, `source_binding`), each with
its own answer to "is this right?"; a real CodeMirror editor; compilation to
SQL/Polars/PySpark plus semantic views and dbt models; a conformance suite that
runs the compiled plans in real interpreters and requires them to agree.

**Chartroom** — the spec DSL and a 20-rule linter with golden tests and
mechanical fixes; a catalog of 12 widgets and 6 patterns; the agent loop
(intake → brief → compose → critique) over 25 governed MCP tools; briefs with a
human approval gate; metric proposals validated through the real engine; the
draft/team/certified promotion matrix with sign-offs and exposure records;
version-pin upgrade notices carrying the diff; a deterministic data critic;
cross-filtering; PPTX committee packs; a shareable read-only view mode; usage
instrumentation; and an embedded agent chat.

**The agent runtime** is a Python LangGraph + deepagents service on FastAPI
whose tools are the same governed MCP roster every other surface sees, with
durable threads and a frozen SSE protocol.

**Query backends** are a routing decision: `fixtures | duckdb | dremio`.
Fixtures remain the default *and the test oracle* — a parity harness runs every
query shape against both engines over identical rows and requires agreement to
1e-6. Warehouse execution compiles the engine's own measure SQL and row-stage
derivations, so there is one definition of every number.

**Not yet built:** widget and pattern *proposals* through the same machinery as
metrics (Phase 10), and outward integrations — DataHub emission, git
materialization at Team+, decommissioning, Rogo import (Phase 11). Streaming
(Deephaven) remains a deliberate deferral behind an executor seam written to
accept it.

## 7. Boundaries

Things that are deliberately not on the roadmap, because allowing them would
dissolve the product:

- **No raw SQL in a dashboard spec.** The moment one exists, the registry stops
  being the only data API and every guarantee above becomes advisory.
- **No row-level export from a dashboard.** The aggregates-only boundary is
  structural: row data has no representation in the query response types, so it
  cannot leak by accident. A sampled extract is a separate, server-flagged,
  allowlisted path — never a widget.
- **No agent approvals.** Not a permission to be granted later.
- **No unit overrides in presentation.** A bp metric renders as bps on every
  dashboard, or the same number reads differently in two meetings.

## 8. How we know it works

The dogfood boards are the acceptance test: hand-authored against the real
registry, seeded on first boot, and covered by a test that fails when a measure
is renamed. `outflow-walk` is built on a shipped pattern rather than a "no
pattern" justification.

Verification is one command (`npm run verify`) and currently runs 603 engine
unit tests, 89 browser checks, 177 chartroom unit tests, 27 Python tests
including the cross-backend parity harness, and 21 studio browser checks.

Every architectural deviation from the pinned spec decisions is recorded in
`chartroom/ADRS.md` — 45 entries, including the ones that record a mistake and
its correction.
