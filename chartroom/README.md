# Chartroom

An agent-guided studio for governed analytics dashboards, where every number
traces to a registry function and every visual clears the design guide before
it renders. Phases 1 and 2 of the plan in `chartroom-prd.md` /
`chartroom-implementation-spec.md` (the design uploads): the spec DSL, the
linter, the widget catalog, the interpreter, two dogfood dashboards; the agent
loop (MCP server, the intake/brief protocol with a human approval gate, the
pattern catalog, the LLM design critic); and governance — metric proposals
validated through the real engine, the draft → team → certified promotion
matrix, exposure records at certification, and version-pin upgrade notices
that carry the diff. Phase 4 adds scale: the deterministic data critic,
spec-declared cross-filtering, and the PPTX committee pack. Phase 5 adds
pilot readiness: the shareable read-only view mode and the E2.5 usage
instrumentation. Phase 6 adds the embedded agent chat — the spec's §7
conversational surface, in the studio.

Phase 7 moves the agent runtime to Python: `chartroom/agent` is a LangGraph +
deepagents loop on FastAPI whose tools are `chartroom-mcp` — see
[`chartroom/agent/README.md`](agent/README.md) and `PLAN-PHASES-7-11.md`.

```
npm run chartroom:server   # :8788 — contracts, queries, dashboards, governance, chat proxy
npm run chartroom:studio   # :5174 — the studio (approvals + steward queue live here)
npm run chartroom:mcp      # stdio — the agent's 25 tools
# python agent (chat backend): see chartroom/agent/README.md  → :8789
npm run verify:chartroom   # typecheck ×7 + 168 TS unit tests + 18 pytest + 20 browser checks
```

Run `npm run server` (the registry, :8787) alongside for live contracts;
without it the server falls back to the shipped documents and the studio
header says so — `registry: shipped`, in amber, because demo documents should
never impersonate a governed workspace.

## What exists

| Package | The idea |
| --- | --- |
| `chartroom-spec` | The dashboard DSL as Zod schemas, canonical hashing, reviewer-vocabulary diffs, RFC-6902 fixes, a 16-rule linter — and the **brief schema**, where the grilling protocol's eight intake slots are required fields, not suggestions. Pure — runs identically in browser, server, and MCP. |
| `chartroom-widgets` | The catalog: versioned contracts as data, presentation-only SVG renderers. Widgets receive numbers; they cannot fetch. |
| `chartroom-patterns` | The reviewed archetypes (limit-utilization-board, liquidity-monitor, metric-deep-dive) with slots, wireframes and when-*not*-to-use — plus the design guide's rationale for all 16 rules, tested to cover exactly the linter's roster. |
| `chartroom-critics` | The LLM design critic: composition, hierarchy, decision-alignment against the brief. Zod-validated findings, one retry, then a WARN "critic unavailable" — the deterministic linter is the hard gate, so a model outage never blocks anyone. Evals run live with `ANTHROPIC_API_KEY`, skip loudly without. |
| `chartroom-server` | Contracts *derived* from the registry (unit from format, dims from derived rows, governance status from the production channel), grouped queries through the engine's own `Evaluator`, versioned dashboard persistence, briefs with a human-only approval gate, metric proposals with engine-run evidence, the promotion gate matrix, exposure records, upgrade notices — and an audit trail pairing every agent action with its principal. |
| `chartroom-mcp` | Chartroom's 25 tools over stdio, thin by contract: validate → HTTP as `agent:mcp-<session>` → shape. The server's entitlements do the governing; there is deliberately **no approve, decide, or promote tool** — the governance tools file proposals and read the gate. The MCP instructions carry the intake protocol. |
| `chartroom-studio` | The interpreter canvas, a contract-generated widget form, the spec source in CodeMirror, findings with one-click fixes, explicit versioned saves — the **Brief tab** (the intake slots as an approvable card), the **Govern tab** (the promotion checklist with sign-offs, the promote act, and version-pin notices), and `#/proposals`, the steward queue. `#/widgets` is the widget-states review harness. |

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

## Governance (Phase 3)

- **Metric proposals** — a registry gap surfaced at intake becomes a KEEL
  document filed via `propose_metric`, validated through the *real* engine
  (parse, full diagnostics, every measure evaluated on the fixtures, semantic
  view compiled) with the evidence stored on the proposal. A steward decides
  in the studio's `#/proposals` queue; approval **is** a registry write,
  authored by the steward, and refuses plainly when no registry is running
  (ADR-23).
- **Promotion matrix** — draft → team → certified, one server-side checklist
  shared by the studio's Govern tab and the promote route. The latest spec is
  linted *at the target status*, which is what arms GOV-01/02; team needs an
  approved brief plus a peer sign-off, certified adds design and data-owner
  sign-offs, a declared refresh SLO, and no weakening stale pins. Promotion
  writes a new version with the status change, and certification records an
  exposure row — the DataHub contract without the DataHub process (ADR-25).
- **Upgrade notices** — a promoted dashboard pins revisions; when the
  registry moves, `check_upgrades` reports each stale pin with the measures
  that move (and by how much), anything that disappears, and the engine's
  control-impact findings. Notify-with-a-diff; nothing re-pins silently
  (ADR-26).
- Every decision, sign-off, and promotion is human-only at the API — the
  agent's half is filing artifacts worth approving and reading the gate
  (ADR-24).

## Scale (Phase 4)

- **The data critic** — deterministic, LLM-free, at `/api/data-critique` and
  the `data_critique` tool: grouped sums reconcile with the headline for
  additive measures (MASS-01), every query leg answers at one as-of
  (COHERE-01), nothing non-finite would render (FIN-01) — each finding with
  its computed evidence. Its statically-checkable half graduated into the
  linter: AGG-01 (no grid totals over non-additive measures — summing ratios,
  made uncheatable) and IX-01 (cross-filter wiring answerable on both ends)
  (ADR-27).
- **Cross-filtering** — declared in `spec.interactions`, interpreted by the
  canvas: a widget is clickable only because the spec names it a source, a
  click narrows exactly the declared targets through the same aggregate query
  path, and the active filter is a visible chip. Mosaic/DuckDB-WASM stays a
  substrate swap behind the same contract (ADR-28).
- **The committee pack** — `GET /api/dashboards/:id/deck.pptx` (the `deck ↓`
  header link): a deterministic plan from the same QueryService and the same
  `formatValue` the widgets use, rendered as *native* PPTX charts and tables
  with the version and spec hash on the title slide — the deck cannot diverge
  from the live dashboard (ADR-29).
- Deephaven streaming, the Slack/Claude Tag entry, and catalog growth ship as
  seams awaiting their forcing functions (ADR-30).

## Pilot readiness (Phase 5)

- **View mode** — `#/view/<dashboard-id>`: the latest *saved* version, pure
  read, same interpreter — no editing chrome, cross-filtering intact,
  print-stylesheet PDF via the browser (ADR-31). The `view` header link opens
  it for the current dashboard.
- **Pilot metrics** — `GET /api/metrics` derives the spec's E2.5
  instrumentation on read: brief-acceptance rate and median time-to-approval,
  versions per dashboard, lint-fix acceptance by rule (the studio reports
  applied fixes into the audit stream via `POST /api/events`), dashboards and
  proposals by status (ADR-32).
- **The data critic in the studio** — a "Run data critic" button in the
  Findings tab (a button, not a keystroke — it runs every query leg), with
  findings and their computed evidence inline (ADR-33).

## The embedded agent chat (Phase 6)

The `agent ✳` button opens a chat pane wired to `POST /api/chat` (SSE),
which proxies to the Python agent service: a LangGraph + deepagents loop on
the same model as the design critic, whose tools are the `chartroom-mcp`
roster under an `agent:lg-<session>` identity — so the chat can interview,
search the registry, preview numbers, lint, data-critique, file briefs and
proposals, and compose after approval, but can never approve, decide, or
promote (ADR-36). Threads persist server-side in a LangGraph checkpointer
(ADR-38). The pane replicates Claude-chat functionality with
AI-Elements-vocabulary components — Conversation, Message, streamed-markdown
Response, collapsible Tool cards, PromptInput with stop, Suggestions — on the
studio's own design system, over a frozen SSE protocol (ADR-37). Run the
agent service with `ANTHROPIC_API_KEY` to enable it; without it the pane says
so plainly and everything else keeps working (ADR-35).

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
