# Chartroom — architecture decision records

The implementation spec (`chartroom-implementation-spec.md`) pins its technology
decisions and says: *deviate only with a recorded ADR*. These are those records.

A theme runs through most of them: the spec's §0 rationale column says
**"Existing KEEL TS conventions"** — and on inspection, the existing conventions
of *this* repository are not the ones the spec assumed. Where the two disagree,
the repo's actual conventions win, because that was the stated reason for the
pin in the first place.

---

## ADR-1 — npm workspaces, not pnpm + Turborepo

**Pinned:** pnpm workspaces + Turborepo, path-filtered CI.
**Decision:** npm workspaces (`"workspaces": ["chartroom/*"]` in the root
`package.json`); plain `npm -w` scripts.

The repo is an npm project with a committed `package-lock.json` and CI that runs
`npm ci`. Introducing a second package manager makes every contributor and every
CI job resolve dependencies two ways, and the failure mode — a version that
resolves differently under the two lockfiles — is exactly the class of silent
drift this whole platform exists to prevent. Turborepo's incremental caching is
worth having at twenty packages; at four it is a config file that can go stale.

## ADR-2 — React 19, not React 18

**Pinned:** React 18.
**Decision:** React 19, the version the repo already ships.

Two React majors in one `node_modules` is a hazard (two copies of the reconciler,
hooks dispatching against the wrong instance), and downgrading the existing
surface was never on the table.

## ADR-3 — plain JSON-over-HTTP `handle()`, not tRPC v11

**Pinned:** tRPC v11 router, TanStack Query client.
**Decision:** the repo's existing server convention — a pure
`handle(repo, request) → response` function with a thin `node:http` listener,
tested without a port.

The registry server (`server/api.ts`) established this pattern and its tests
demonstrate why: the whole API surface is testable at the level it is written.
tRPC buys end-to-end types across a package boundary we don't have (studio and
server share `@chartroom/spec` types directly), at the cost of a framework the
rest of the repo doesn't use.

## ADR-4 — the existing SQLite/MSSQL dialect layer, not Postgres + Drizzle

**Pinned:** Postgres 15 + Drizzle ORM.
**Decision:** a `chartroom` dialect implementing the repo's existing `Dialect`
interface, reusing `server/db.ts` (`openSqlite`/`openMssql`/`migrate`) verbatim.

The repo already solved portable persistence once — SQLite in dev, SQL Server in
production, append-only tables with invariant tests, ISO-8601 text timestamps,
no dialect-specific SQL. A third database engine for one feature means a third
operational story and a second ORM. Spec versions are stored as JSON text with a
content hash, exactly as the spec wanted from JSONB — the queryability JSONB adds
is not used by any Phase-1 access path.

## ADR-5 — IDs follow the repo convention, not ULIDs

**Pinned:** ULIDs everywhere.
**Decision:** human-readable slugs for dashboards (like document names),
monotonic integers for versions, sha256 content hashes for spec identity.

The registry's whole UX names things (`liquidity_pit`, `production r2`); a ULID
in a URL or an audit row is a lookup where a name would have been an answer.
Content-addressing (the part of the pin that carries reproducibility) is kept.

## ADR-6 — Zod is the single schema source; JSON Schema generation deferred

**Pinned:** JSON Schema generated from Zod for editor/CI/MCP.
**Decision:** all three Phase-1 consumers (studio editor, server, tests) are
TypeScript in this monorepo and import the Zod schema directly. The
`specToJsonSchema()` export exists but is deferred until a non-TypeScript
consumer actually appears (the Phase-2 MCP tool definitions are the likely
trigger).

Generating an artifact nobody reads is how generated artifacts go stale.

## ADR-7 — no Storybook; a states harness route plus Playwright

**Pinned:** Storybook story per widget state as the design-review surface.
**Decision:** the studio ships a `#/widgets` harness route rendering every
widget in every state (loading/fresh/stale/error/empty) from fixture data, and
the e2e suite asserts them.

Same review surface, no second build system. The harness runs in the real
bundle, so what design reviews is what ships — a Storybook webpack build is one
more place a token or a font can diverge.

## ADR-8 — charts are hand-rendered SVG behind the widget contracts, not ECharts

**Pinned:** ECharts 5 behind widget contracts.
**Decision:** native SVG, in the repo's existing idiom (the registry surface
already hand-renders its sparklines, distributions and coverage bars).

The spec itself says the renderer is "an implementation detail hidden by the
catalog" — this exercises that seam on day one. Phase-1 widgets need axes,
lines, bands, bars and cells; none needs ECharts' interaction machinery. The
contract is the boundary: if a Phase-4 widget needs more, it swaps its renderer
without touching a spec.

## ADR-9 — `perspective-grid@1` is a native aggregate pivot in Phase 1

**Pinned:** wraps `@finos/perspective-viewer`.
**Decision:** the widget type, contract, and `max_cells` guard ship now; the
Phase-1 implementation is a native pivot grid over the aggregate result. The
FINOS Perspective wrap lands with the Phase-4 cross-filter/Mosaic work it
actually serves.

Dashboards written today bind `perspective-grid@1` and never change when the
renderer is upgraded — that is what the catalog's version seam is for. Pulling
a multi-megabyte WASM dependency into the bundle to render a pivot of a few
hundred aggregate cells inverts the performance promise it is meant to serve.

## ADR-10 — no dockview, no react-grid-layout in Phase 1

**Pinned:** dockview for studio chrome, react-grid-layout for the canvas.
**Decision:** fixed three-pane CSS layout (the registry surface's own pattern)
and a CSS-grid interpreter for the canvas.

Phase 1's acceptance criteria edit layout through the inspector, not by drag —
the spec's `pos` is data, and rendering data as a CSS grid needs no library.
Drag-editing and dockable panes arrive with the Phase-2 agent chrome, which is
when their weight buys something.

## ADR-11 — plain React state + a module-level query cache, not Zustand + TanStack Query

**Pinned:** Zustand (UI state), TanStack Query (server state).
**Decision:** React state in the studio (the repo's existing pattern), and a
small keyed in-flight/LRU cache in the data layer that preserves the pinned
behaviour that matters: two widgets binding the same slice cost one query —
asserted by test on the server cache as well.

## ADR-12 — metric certification derives from the release/channel system

**Pinned (implicit):** `MetricContract.status` from a registry status field.
**Decision:** a metric is `approved` when the document it lives in is carried
by the release the `production` channel currently serves, `draft` otherwise.

The repo already has a governed promotion pipeline with an acknowledgement seam
(`server/runtime.ts`); inventing a parallel status flag would create two
sources of truth for "is this governed", and they would drift. GOV-02 therefore
means something real on day one: a dashboard cannot leave draft while binding a
measure production has never served.

## ADR-13 — `keel://` refs pin document revisions

**Pinned:** `keel://liquidity.lcr@4` — function-level versions.
**Decision:** `keel://<document>.<measure>@<revision>` — the version segment is
the registry's document revision number, the unit of versioning this registry
actually has.

Measures do not version independently of their document here (a measure's
meaning can change through a classification the document references), so a
per-measure version would be a fiction. The revision pin gives bit-exact
reproducibility through the existing append-only history.

---

## DSL gaps recorded during E1.5 dogfooding

Per the Phase-1 hard gate: gaps found hand-authoring `lcr-monitor` and
`limit-board` against real registry functions.

## ADR-14 — thresholds: `compare.vs` accepts a metric ref, and nothing else yet

The PRD wants limit thresholds to reference *registry-defined limit functions*.
The registry has no limit-function kind yet — the nearest governed artifacts are
`variance_monitor` thresholds, which judge day-over-day moves rather than
levels. Rather than let dashboards hardcode numbers (which the PRD forbids),
`compare.vs` accepts a `keel://` ref or `prior_period`. The `limit-board`
dogfood dashboard consequently expresses "distance to floor" by binding the
measures the registry does govern (`lcr_buffer`, `lcr_headroom`, `lcr_shortfall`
— the floor arithmetic lives in governed expressions, where it belongs). A
first-class limit registry entry is Phase-3 work; when it lands, `compare.vs`
already has the right shape.

## ADR-15 — time is a dimension named `as_of_date`, fixed

The engine's evaluation model is a 60-point daily series per measure; there is
exactly one time dimension and the contracts declare it. `window.trailing`
accepts `Nd` only — no calendar months, because the underlying series is daily
and pretending otherwise would misdescribe what a point means.

## ADR-16 — grouped queries return the as-of slice, series queries return time

A binding either groups by categorical dims (bar, grids, delta-table — evaluated
at the as-of date, with `delta` computed against the prior date server-side) or
requests the time series (timeseries widget). Mixing both (`dims:
[as_of_date, entity_id]` → multi-series) is supported for timeseries only, capped
by TS-02. A general OLAP cube was not needed by either dogfood dashboard.

---

## Phase 2 ADRs

## ADR-17 — Claude Code is the agent surface; the embedded chat is deferred

**Pinned:** studio left pane streams an embedded Claude session wired to
`chartroom-mcp` (E2.2/E2.5).
**Decision:** `chartroom-mcp` ships first-class and the agent connects from
Claude Code (or any MCP client); the studio keeps the human half — the brief
card and the Approve button. The embedded chat pane is deferred until there is
a pilot to put in front of it.

The PRD itself makes this portable-by-design: "the same tools work from the
studio UI's embedded agent, from Claude Code, or from Claude Tag." Every gate
the chat would exercise is server-side and tested over the wire — an embedded
pane adds streaming UI, key management, and session plumbing, not governance.
The one UX piece the chat carried that matters now — the brief rendered as an
approvable card — ships in the studio's Brief tab.

## ADR-18 — there is no approve tool, anywhere

**Pinned:** "the MCP server enforces authZ — the agent can never approve
anything."
**Decision:** enforced twice, deliberately. The server refuses approval to any
`agent:*` identity (identity is asserted by what fronts the process, never
chosen by the caller), *and* `chartroom-mcp` simply has no approval tool — the
instructions tell the agent approval is the human half of the seam. A tool
that always 403s teaches an agent to retry; a missing tool plus an explanation
teaches it to ask the human.

## ADR-19 — an edited brief supersedes its approval

**Decision:** saving a new brief version supersedes every earlier version,
approved included; composition re-locks until a human approves again.

The alternative — the approval surviving edits — makes "approved" mean
"approved something, once". A brief edited after approval is a different
brief; SR 11-7's evidence value depends on the approval pointing at the exact
artifact reviewed. `briefs.test.ts` pins this.

## ADR-20 — critic degradation is a finding, not an exception

**Pinned:** "never block the pipeline on model failure — degrade to WARN."
**Decision:** taken literally: no key, network failure, or twice-unparseable
output all return a WARN-severity finding that says the critic did not run and
that the deterministic linter still did. The unavailability is *visible in the
findings list* rather than a silent skip, because "not reviewed for
composition" is information a reviewer needs. The eval suite runs with a real
model when `ANTHROPIC_API_KEY` is present and skips itself (loudly) when not —
the same posture as the repo's Python conformance tests.

## ADR-21 — the grilling protocol is a Zod schema

**Pinned:** `create_brief` "rejects if required slots missing — the grilling
protocol is enforced here, not merely prompted."
**Decision:** the eight intake slots are required fields with minimum lengths
in `chartroom-spec`'s `BriefSchema` (`decision` needs 20 characters because
"monitoring" is not a decision), shared by server validation, MCP input
shaping, and the studio card. An agent cannot charm its way past a schema, and
a human filing a brief by hand meets exactly the same bar.

## ADR-22 — patterns and rule rationale are served by the server, not bundled per client

**Decision:** `chartroom-patterns` is data; the server exposes it at
`/api/patterns` and `/api/design-rules`, and the MCP proxies those routes.
One source for "what patterns exist" beats three bundled copies that drift —
the same argument as deriving metric contracts instead of storing them. The
patterns test asserts the rule-rationale roster covers exactly the linter's
emittable rule ids, so a new lint rule without guide text fails CI.

## Phase 3 ADRs

## ADR-23 — proposal approval *is* the registry write

**Pinned:** the metric-proposal loop files "a metric_proposal to the KEEL
registry" with steward review (spec §9, E3.1).
**Decision:** the proposal table holds the workflow (draft → submitted →
decided, with the engine's validation evidence stored on the row); the
*registry* holds the outcome. A steward's approval performs a `PUT` to
`/api/artifacts/:name` authored by the steward, and the resulting revision is
recorded on the proposal. If no registry process is reachable, the approval
refuses with that stated plainly — an "approved" proposal whose document went
nowhere would be the workflow lying about its one meaningful side effect.
Validation is the real engine (parse → full diagnostic catalogue → every
measure evaluated on the fixtures → semantic view compiled), so the steward
reads what the validation found, not what the proposer claims.

## ADR-24 — every governance act is human-only; MCP governance tools are read-and-propose

**Pinned:** "promotion requires approvals" and the Phase-2 rule that the agent
can never approve anything.
**Decision:** deciding proposals, recording sign-offs (peer / design /
data-owner), and promoting are all refused to `agent:*` identities at the API,
and `chartroom-mcp` ships no tool for any of them (ADR-18's pattern,
extended). The agent's governance tools are `propose_metric`,
`submit_proposal`, `get_proposal`, `list_proposals`,
`get_promotion_checklist`, and `check_upgrades` — file, validate, read the
gate, and tell the human what remains. The checklist endpoint and the promote
route share one server-side function, so the studio card, the MCP view, and
the gate itself cannot disagree about what "promotable" means.

## ADR-25 — exposure records stand in for DataHub

**Pinned:** the spec names DataHub for lineage/exposure registration at
certification (E3.3).
**Decision:** certification writes a `chartroom_exposure` row — dashboard id,
spec hash, declared refresh SLO, registrant — and contracts already carry
`lineage_urn` from the document's declared source. That is the DataHub
*contract* (what would be pushed) without the DataHub *process*; a real
integration is an adapter that replays exposure rows outward, which can be
added without touching the promotion path. Same posture as ADR-4's dialect
seam: keep the boundary, defer the infrastructure. Git materialization of
certified specs is deferred the same way — the registry's append-only
versions already give diffable history with authors.

## ADR-26 — upgrade notices carry measure-level findings computed in the adapter

**Pinned:** "notify with a diff, never silently change numbers" (E3.4).
**Decision:** notices reuse the engine's `assessChange` for control/
classification/report/parameter-set consequences, but `assessChange` has no
metrics-view branch — and a dashboard pin almost always points at a metrics
view. So the server's upgrade module additionally evaluates every measure of
the pinned and latest bodies on the nominal fixture and reports, in the same
`Finding` shape: values that move (with the delta), measures that disappear
(direction `weakens` — a dangling binding is the one upgrade outcome that
breaks a widget), and measures that appear. Computed in `chartroom-server`
rather than the engine so the registry's own promotion-gate semantics stay
untouched; if the engine later grows a metrics-view branch, the adapter's
supplement collapses into it.

## Phase 4 ADRs

## ADR-27 — the data critic is deterministic, and its static half became lint rules

**Pinned:** the PRD's data critic — grain compatibility, aggregation validity,
denominator consistency, as-of coherence, staleness.
**Decision:** no model anywhere in the data path. What is checkable from the
spec and contracts alone graduated into the linter per the working agreement:
AGG-01 (a grid's structural totals over a measure whose
`allowed_aggregations` excludes sum — the summing-ratios mistake) and IX-01
(cross-filter wiring answerable on both ends). What genuinely needs numbers
lives in `/api/data-critique`, which runs the spec's own query legs through
the QueryService: MASS-01 (grouped sums reconcile with the headline for
additive measures), COHERE-01 (every leg answers at one as-of), FIN-01
(nothing non-finite would render). Every finding carries its computed
evidence, and — unlike the design critic — there is no degrade path because
there is nothing to be unavailable.

## ADR-28 — cross-filtering is declared in the spec and interpreted; Mosaic/DuckDB-WASM deferred

**Pinned:** "cross-filter/Mosaic loop over DuckDB-WASM" (Phase 4).
**Decision:** the *contract* ships without the substrate. `spec.interactions`
already carried `cross_filter` declarations; Phase 4 makes the interpreter
obey them: a widget is clickable only because the spec names it a source, a
click narrows exactly the declared targets through the same aggregate query
path (main leg only — thresholds and bands stay global), and the active
filter is a visible chip, never ambient state. Widgets stay presentation-only
via an `onPick` callback that reports the click and decides nothing. A
client-side DuckDB-WASM loop is a performance substrate swap behind the same
declared-interaction contract, when scale demands it; the aggregates-only
server boundary is unchanged either way.

## ADR-29 — the committee pack is a deterministic plan rendered to native PPTX

**Pinned:** "exportable to PDF/PPTX for committee packs (spec → deterministic
render → export, so the committee deck and the live dashboard can't diverge)".
**Decision:** `buildDeckPlan` produces plain data — one title slide carrying
version and spec hash, one slide per widget — from the same QueryService the
widgets query and the same `formatValue` the widgets format with (exported
React-free as `chartroom-widgets/format`). `renderDeck` feeds the plan to
pptxgenjs as native charts, tables, and text — data all the way down, no
screenshots. The plan is the tested artifact; the binary gets a structural
smoke test. PDF export can be a second renderer over the same plan.

## ADR-30 — streaming, Slack entry, and catalog growth wait for their forcing functions

**Decision:** three Phase-4 items ship as seams, not features. Deephaven
streaming: the `QueryResult` union and widget `status` vocabulary already
carry `streaming`/`stale`; a `subscribe` path is additive behind the same
request shapes when an intraday backend exists to subscribe to. Slack/Claude
Tag entry: the MCP server is the portability layer by design (ADR-17) — a
Slack surface is a client of the same tools, not new governance. Pattern
catalog growth: the PRD says growth comes *from real usage*; inventing
patterns ahead of pilot evidence would dilute the catalog's authority. Each
returns when its forcing function (an intraday backend, a Slack pilot,
recurring real briefs) arrives.

## Phase 5 ADRs

## ADR-31 — view mode is a pure read, and browser print is the PDF export

**Pinned:** "View mode is a pure read of the spec — shareable via URL …
exportable to PDF/PPTX" (PRD).
**Decision:** `#/view/<id>` renders the latest *saved* version through the
same interpreter Canvas the studio uses — no sidebar, no inspector, no save.
A reader always sees what review saw, never a draft in progress (a dashboard
with no versions says so rather than rendering one). Cross-filtering still
works because it is a declared view interaction, not an edit. PDF is the
browser's print over a print stylesheet, not a third renderer: the deck
(ADR-29) covers the committee-pack case, and a second server-side PDF
pipeline would be a second thing to keep from diverging.

## ADR-32 — the audit log is the event stream; pilot metrics are derived

**Pinned:** E2.5 — "instrument brief-acceptance rate, edits-per-dashboard,
lint-fix acceptance."
**Decision:** no separate analytics table and no stored aggregates. Facts the
server already witnesses (briefs, approvals, versions) are read straight from
their tables; the one fact only the client sees — a lint fix actually applied
— is reported to `POST /api/events` and recorded as an ordinary audit row
(action `fix.apply`, artifact the rule id), because the audit log already is
the append-only, actor-stamped event stream. `GET /api/metrics` derives
everything on read: acceptance rate and median time-to-approval, versions per
dashboard, fix applications by rule, dashboards and proposals by status.
Derived beats stored for the same reason contracts are derived (ADR-12):
there is no second copy to fall out of date. Events require an identity —
anonymous rows would make acceptance unattributable — and event reporting
never blocks an edit.

## ADR-33 — the data critic is a button, not a keystroke

**Decision:** in the studio the data critic runs on demand from the Findings
tab, unlike the linter's 250ms debounce. The linter is pure computation over
the spec; the data critic runs every query leg of the dashboard, and wiring
that to keystrokes would make editing cost a full query sweep per pause. The
findings render with their computed evidence inline, and the clean state is
worded as the critic's actual verdict ("grouped sums reconcile, one as-of
everywhere, everything finite") — a reader should know what was checked, not
just that nothing was found.

## Phase 6 ADRs

## ADR-34 — the embedded chat is a second client of the governed API, not a second API

**Pinned:** the spec's §7 agent chat ("streams a Claude session pre-wired to
chartroom-mcp"), deferred by ADR-17, delivered here.
**Decision:** the chat loop runs server-side (`/api/chat`, SSE) on
claude-opus-5 — the same model as the design critic — with a manual agentic
loop over the Anthropic SDK's streaming API, chosen over the beta tool runner
because every stream event is forwarded to the browser while tools run
between turns. Its tools execute against the same pure `handle()` every
caller uses, under an `agent:chat-<session>` identity, so every entitlement
holds structurally: no approve, decide, or promote tool exists (ADR-18's
absence, third surface), and even a direct call would 403 on identity. The
tool roster is a curated subset of the MCP server's — the MCP server remains
the external agent surface; in-process `handle()` calls beat spawning an MCP
subprocess per chat session. Conversation state is client-held and text-only:
each POST replays the visible transcript, and every agentic turn is
self-contained — the model re-fetches what it needs through tools rather
than replaying stale tool traffic. The studio pane is built from
AI-Elements-vocabulary components (Conversation, Message, Response, Tool,
PromptInput, Suggestions) on the studio's own design system rather than
importing the library — the studio has no Tailwind/shadcn substrate, and the
component contract, not the CSS, is what's worth replicating.

## ADR-35 — chat unavailability is a banner, not a block

**Decision:** ADR-20's posture, extended to the chat: with no
`ANTHROPIC_API_KEY`, `/api/chat` answers with an `unavailable` event that
says so plainly and points at what still works — the linter and the data
critic are deterministic, approvals and promotion are human acts, and the
whole studio functions without a model. The pane renders the message as a
banner and disables input; nothing else dims. The e2e suite runs with the
key explicitly blanked so the degrade path is what CI exercises; the live
loop is covered by a key-gated server test, the same arrangement as the
critic evals.

## Phase 7 ADRs

## ADR-36 — the agent runtime is a Python service; its tools are the MCP roster

**Pinned:** the plan's directive — LangGraph + deepagents on FastAPI.
**Decision:** `chartroom/agent` (:8789) replaces the Phase-6 TS chat loop.
`create_deep_agent` supplies the loop — planning, subagents, tool execution —
on claude-opus-5; the tool surface is `chartroom-mcp` consumed over stdio via
`langchain-mcp-adapters`, one supervised subprocess per service. Zero tool
duplication: studio, Claude Code, and LangGraph share one governed roster,
under an `agent:lg-<session>` identity (the MCP client grew a cosmetic
`CHARTROOM_MCP_LABEL` so the audit trail names the surface; entitlements key
on `agent:*` regardless). A bespoke LangGraph state machine re-enforcing the
§3 journey gates was considered and rejected: the server's 403s are the
enforcement, the system prompt encodes the flow, and duplicate enforcement
could only ever disagree with the source of truth. A startup guard fails the
service loudly if the roster ever grows an approval-shaped tool — defense in
depth, not the defense. Dependency versions are pinned exactly; the step-zero
spike that validated their APIs is re-run on any bump.

## ADR-37 — the chat SSE protocol is a frozen contract

**Decision:** the event vocabulary the studio pane consumes (`text`,
`tool_start`, `tool_result`, `turn_end`, `done`, `error`, `unavailable`),
framed byte-exactly as `data: <json>\n\n`, is frozen. The Python service
writes frames by hand rather than through sse-starlette, whose `\r\n`
framing the pane's parser would never split. New event types may be added
(clients ignore unknown types); existing ones never change shape. This is
what let the runtime be replaced under the pane without touching it —
chartroom-server's `/api/chat` became a pass-through proxy whose only own
behavior is the `unavailable` frame when the service is unreachable.

## ADR-38 — threads live server-side in a LangGraph checkpointer

**Decision:** conversations persist in an (async) SQLite checkpointer keyed
by `thread_id`; the service emits an additive `thread` event naming the
thread so a client can resume it. The Phase-6 posture — client-held,
text-only history, every turn self-contained (ADR-34) — remains the accepted
*request* shape for compatibility, seeding a fresh thread with the transcript
as context. Real threads mean tool traffic and prior reasoning survive
across turns and service restarts, which the text replay never could.

## Phase 8 ADRs

## ADR-39 — an executor seam, with the fixture path as the permanent oracle

**Decision:** `QueryService` splits behind a `QueryExecutor` interface. The
cache, single-flight, refusal vocabulary, and response shapes stay above the
seam; what computes a result is pluggable. The in-process Evaluator path is
not deprecated by real backends — it is kept forever, because it is the test
oracle every other backend must agree with: the parity harness (pytest, in
the agent service) runs every query shape against fixtures AND DuckDB over
identical rows and requires agreement within 1e-6 relative. This is MASS-01's
discipline turned cross-backend — drift you cannot detect is worse than a
wrong number you can, so the detector ships with the seam. The interface is
also written for what it doesn't yet host: a `subscribe()`-capable streaming
executor (ADR-30) slots in without touching widgets. `CHARTROOM_BACKEND=
fixtures|duckdb|dremio` selects; fixtures remain the default, so a fresh
clone still works offline.

## ADR-40 — Python owns warehouse execution; the manifest is the wire

**Decision:** warehouse queries execute in the agent service (`/query/run`,
DuckDB in dev, Dremio over Flight SQL with a PAT in prod), not in
chartroom-server. The server publishes `/api/warehouse/manifest` — the
engine's own SQL for every measure (`stage()`/`aggregate()`, ROUND stripped
because the Evaluator never rounds and the oracle must be matchable), the
row stage as SQL steps (`rowStageSql()`: date arithmetic, maturity buckets,
classifications and rate lookups as the same CASE chains the pipeline
compilers emit), and the typed fixture tables that make the parity harness
possible. The Python side arranges those snippets into the semantic views'
CTE shape parameterized by dims and filters; it never invents an expression,
so there is one definition of every number. Context params resolve to
literal filters on the TS side before the wire — one resolution path. The
aggregates-only boundary holds structurally: the only SELECT the executor
can emit is a GROUP BY. Documented limit: the warehouse serves the latest
revision only — a stale pin is refused with re-pin guidance rather than
silently served fresh numbers.

## ADR-41 — asOf comes from the data; cost comes from the backend

**Decision:** the warehouse path reports `asOf` as the actual
`max(as_of_date)` in the queried data, not the workspace's declared date —
so the staleness the widget vocabulary has carried since Phase 1 becomes an
observed fact once a real warehouse lags. `cost.rowsScanned` is a real
count over the filtered row stage on the executing backend. DuckDB
`EXPLAIN`-based estimates and Flight metadata were considered and deferred:
for an in-memory dev backend the count IS the honest cost, and Dremio
estimation belongs with the first real Dremio deployment rather than
speculation ahead of it.

## Phase 9 ADRs

## ADR-42 — a widget family is a claim about which judgments apply

**Decision:** three new families ship with Phase 9's catalog — `waterfall`,
`heatmap`, `annotation` — rather than overloading the existing six. Families
are not labels; several rules key off them, so putting a widget in a family
subscribes it to that family's judgments. A waterfall filed under `bar` would
inherit BAR-02's value-sort, which scrambles the bridge order that *is* the
chart. A heatmap filed under `grid` would inherit AGG-01, which blocks
non-additive measures because a grid's margins sum structurally — a heatmap
draws no margins, so the block would be a false positive on a legitimate
chart. An annotation filed under `kpi` would inherit KPI-02 and be told to
add a comparison to a prose panel. GRID-01's cell ceiling *was* extended to
`heatmap`, because crossing two dims into cells is the same judgment however
the cells are painted. `stacked-area` deliberately takes the existing
`part_to_whole` family, which PIE-01 was written for and has been waiting
for since Phase 1 — the rule goes live this phase without being touched.

## ADR-43 — commentary binds to a metric

**Decision:** `annotation@1` carries prose in a new optional `note` field on
the widget instance (≤600 chars, rendered as text — never markup, since a
governed artifact that accepted HTML would be a stored-XSS hole and the value
here is provenance, not typography). The panel binds a metric like any other
widget. That binding is the point: a committee pack's standing failure is
that the explanation lives in an email and the number lives in a deck, so
the two drift until nobody can say which quarter the sentence described.
Binding commentary to a pinned revision means the note travels with the
number, the deck exports both on one slide, and when the metric's revision
moves the upgrade notice can name the commentary as something to re-read.

## ADR-44 — the linter checks what it can see; the critic checks the rest

**Decision:** WF-01 and SM-01 deliberately stop short of the arithmetic
their charts assert. A waterfall claims opening + contributions = closing,
and small multiples claim a shared scale is informative — but the linter is
a pure function of (spec, contracts) and never sees a value, so neither
claim is checkable there. The split: the **linter** blocks the bindings that
make the claim impossible (a non-additive measure whose moves cannot compose
a total; a filtered bridge whose excluded rows vanish into the gap between
its own totals; a single-panel "comparison"), the **renderer** refuses to
hide a failure it can see (the waterfall draws its closing bar where the data
puts it, not where the steps end, so an unreconciled bridge shows its own
discrepancy), and the **data critic** owns the numeric reconciliation over
live values. This is the working agreement's graduation path read in reverse:
a check belongs in the linter only when the contract alone decides it.
