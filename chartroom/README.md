# Chartroom

An agent-guided studio for governed analytics dashboards, where every number
traces to a registry function and every visual clears the design guide before
it renders. Phases 1 and 2 of the plan in `chartroom-prd.md` /
`chartroom-implementation-spec.md` (the design uploads): the spec DSL, the
linter, the widget catalog, the interpreter, two dogfood dashboards — and now
the agent loop: an MCP server, the intake/brief protocol with a human approval
gate, the pattern catalog, and the LLM design critic.

```
npm run chartroom:server   # :8788 — contracts, queries, dashboards, briefs
npm run chartroom:studio   # :5174 — the studio (brief approval lives here)
npm run chartroom:mcp      # stdio — the agent's 18 tools
npm run verify:chartroom   # typecheck ×7 + 133 unit tests + 11 browser checks
```

Run `npm run server` (the registry, :8787) alongside for live contracts;
without it the server falls back to the shipped documents and the studio
header says so — `registry: shipped`, in amber, because demo documents should
never impersonate a governed workspace.

## What exists

| Package | The idea |
| --- | --- |
| `chartroom-spec` | The dashboard DSL as Zod schemas, canonical hashing, reviewer-vocabulary diffs, RFC-6902 fixes, a 14-rule linter — and the **brief schema**, where the grilling protocol's eight intake slots are required fields, not suggestions. Pure — runs identically in browser, server, and MCP. |
| `chartroom-widgets` | The catalog: versioned contracts as data, presentation-only SVG renderers. Widgets receive numbers; they cannot fetch. |
| `chartroom-patterns` | The reviewed archetypes (limit-utilization-board, liquidity-monitor, metric-deep-dive) with slots, wireframes and when-*not*-to-use — plus the design guide's rationale for all 14 rules, tested to cover exactly the linter's roster. |
| `chartroom-critics` | The LLM design critic: composition, hierarchy, decision-alignment against the brief. Zod-validated findings, one retry, then a WARN "critic unavailable" — the deterministic linter is the hard gate, so a model outage never blocks anyone. Evals run live with `ANTHROPIC_API_KEY`, skip loudly without. |
| `chartroom-server` | Contracts *derived* from the registry (unit from format, dims from derived rows, governance status from the production channel), grouped queries through the engine's own `Evaluator`, versioned dashboard persistence, briefs with a human-only approval gate, and an audit trail pairing every agent action with its principal. |
| `chartroom-mcp` | Chartroom's 18 tools over stdio, thin by contract: validate → HTTP as `agent:mcp-<session>` → shape. The server's entitlements do the governing; there is deliberately **no approve tool**. The MCP instructions carry the intake protocol. |
| `chartroom-studio` | The interpreter canvas, a contract-generated widget form, the spec source in CodeMirror, findings with one-click fixes, explicit versioned saves — and the **Brief tab**: the intake slots as an approvable card, with the Approve button that unlocks agent composition. `#/widgets` is the widget-states review harness. |

Three enforcement layers, strongest first: the **schema** cannot express raw
SQL, freeform HTML, custom colors, or dual axes; the **linter** carries the
design guide as rules with IDs (TS-01 time on the x-axis, PIE-01 part-to-whole
routes to sorted bars, NUM-01 formatting belongs to the function, GOV-02 no
ungoverned metrics beyond draft, …), each with golden tests and, where the fix
is mechanical, a JSON Patch the studio applies in one click; the **critic**
judges what neither can — whether the composition answers the brief's decision
— and is advisory by design.

## The agent loop (Phase 2)

The flow is the PRD's, and the server enforces every arrow:

```
intake (8 slots, schema-enforced) → pattern match → create_brief
   → [a HUMAN approves the card in the studio's Brief tab]
   → save_dashboard (linted with fresh contracts) → critique_spec → iterate
```

An agent session (`agent:*` identity) cannot approve a brief and cannot
compose before one is approved — both return 403s that explain the flow
instead of just refusing. Editing a brief supersedes its approval and re-locks
composition: an approval points at the exact artifact reviewed, or it points
at nothing. Connect from Claude Code with:

```json
{ "mcpServers": { "chartroom": {
  "command": "npm", "args": ["run", "chartroom:mcp"],
  "env": { "CHARTROOM_MCP_USER": "your-name" } } } }
```

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
