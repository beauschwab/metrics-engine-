# Chartroom

An agent-guidable studio for governed analytics dashboards, where every number
traces to a registry function and every visual clears the design guide before
it renders. Phase 1 of the plan in `chartroom-prd.md` /
`chartroom-implementation-spec.md` (the design uploads): the spec DSL, the
linter, the widget catalog, the interpreter, and two dogfood dashboards —
no agent yet, deliberately. *Everything else depends on the spec being right.*

```
npm run chartroom:server   # :8788 — contracts, queries, dashboards (SQLite)
npm run chartroom:studio   # :5174 — the studio
npm run verify:chartroom   # typecheck + 96 unit tests + 9 browser checks
```

Run `npm run server` (the registry, :8787) alongside for live contracts;
without it the server falls back to the shipped documents and the studio
header says so — `registry: shipped`, in amber, because demo documents should
never impersonate a governed workspace.

## What exists

| Package | The idea |
| --- | --- |
| `chartroom-spec` | The dashboard DSL as Zod schemas, canonical hashing, reviewer-vocabulary diffs, RFC-6902 fixes, and a 14-rule linter. Pure — runs identically in browser, server, and (later) MCP. |
| `chartroom-widgets` | The catalog: versioned contracts as data, presentation-only SVG renderers. Widgets receive numbers; they cannot fetch. |
| `chartroom-server` | Contracts *derived* from the registry (unit from format, dims from derived rows, governance status from the production channel), grouped queries through the engine's own `Evaluator`, versioned dashboard persistence with an audit trail. |
| `chartroom-studio` | The interpreter canvas, a contract-generated widget form, the spec source in CodeMirror, findings with one-click fixes, explicit versioned saves. `#/widgets` is the widget-states review harness. |

Three enforcement layers, strongest first: the **schema** cannot express raw
SQL, freeform HTML, custom colors, or dual axes; the **linter** carries the
design guide as rules with IDs (TS-01 time on the x-axis, PIE-01 part-to-whole
routes to sorted bars, NUM-01 formatting belongs to the function, GOV-02 no
ungoverned metrics beyond draft, …), each with golden tests and, where the fix
is mechanical, a JSON Patch the studio applies in one click; the **critics**
are Phase 2.

Governance is inherited, not invented: a metric is `approved` when the
release the registry's `production` channel serves carries exactly that
revision of its document (ADR-12), so GOV-02 means something real on day one.
Every server mutation writes `chartroom_audit` with its actor.

## The two dogfood dashboards

Seeded on first boot, bound to real registry functions, linting clean — the
Phase-1 hard gate (`server/test/seed.test.ts` keeps it true):

- **lcr-monitor** — LCR tile with day-over-day judgment, the 60-day trend
  banded by the governed stress measure, weighted outflows by maturity ladder,
  and an entity × product pivot with totals.
- **limit-board** — shortfall / volatility / day-over-day / stress tiles and
  the per-entity HQLA delta table.

Every deviation from the implementation spec's pinned decisions — and every
DSL gap the dogfooding surfaced — is a numbered entry in [`ADRS.md`](ADRS.md).
