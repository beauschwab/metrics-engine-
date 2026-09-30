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

**Amended by ADR-63:** the marks stay hand-rendered, but the *scale* behind
them is d3-scale. Hand-rolled tick and time arithmetic put gridlines where
their labels did not say, which is not a rendering choice — it is a wrong
number.

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

*Amended by ADR-65:* the studio now carries that substrate, for the grid.
The chat pane stands as built; the reasoning above still holds for six
components and stopped holding at a grid's twenty.

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

## ADR-45 — a threshold declares which side is safe

**Decision:** `compare.limit` (`floor` | `ceiling`) is optional on the
comparison and required by GAUGE-01 on a gauge. A coverage ratio must stay
above its floor and a concentration below its ceiling, and nothing in the
numbers distinguishes them — so a widget that colours a breach without being
told is guessing, and guesses wrong exactly half the time. The first cut of
`bullet@1` judged every threshold as a floor, which rendered a breached
ceiling as compliant and a compliant one as breached: the failure mode this
whole codebase exists to prevent, shipped inside the widget whose entire job
is to show a limit. Where no side is declared the gauge still draws the value
against the limit and simply declines to judge. GAUGE-01 also now requires
`style: 'threshold'`, since a `delta` comparison renders a reference marker
that can never breach.

## ADR-44 — the linter checks what it can see; the critic checks the rest

**Decision:** WF-01 and SM-01 deliberately stop short of the arithmetic
their charts assert. A waterfall claims opening + contributions = closing,
and small multiples claim a shared scale is informative — but the linter is
a pure function of (spec, contracts) and never sees a value, so neither
claim is checkable there. The split: the **linter** blocks the bindings that
make the claim impossible (a non-additive measure whose moves cannot compose
a total; a filtered bridge whose excluded rows vanish into the gap between
its own totals; a single-panel "comparison"), the **renderer** refuses to
draw something it cannot honestly draw (a stacked area whose bands go
negative renders a refusal rather than clamping them to zero and overstating
the total), and the **data critic** owns the numeric reconciliation over
live values.

A correction worth recording, since the first draft of this ADR got it
wrong: the waterfall does **not** surface its own residual. Both totals are
summed from the same rows as the steps, so the bridge reconciles by
construction and no discrepancy can appear. The real exposure is a filtered
binding, whose subset sums are labelled `prior`/`current` as though they were
the population's — which is WF-01's warning, not the renderer's job. A
renderer can refuse to draw a lie; it cannot detect one that is arithmetically
consistent. This is the working agreement's graduation path read in reverse:
a check belongs in the linter only when the contract alone decides it.

## Phase 10 ADRs

## ADR-46 — the catalogs are versioned data, seeded from code

**Decision:** widget contracts and patterns move out of code constants into
`chartroom_catalog`, append-only on `(kind, name, version)`, seeded from the
shipped constants on every boot. The seed is *additive only*: an entry already
in the table is never rewritten. That asymmetry is the whole point — once a
contract is in the catalog it has been reviewed, and a deploy silently
changing it would make the table's history a lie. A widget that ships in a
later phase appears on the next boot; a *changed* one needs a proposal, same
as anybody else's.

The routes did not change, which was the epic's real test: `/api/widgets` and
`/api/patterns` serve the same shapes from a different source. What did change
is that the linter now reads its widget contracts from the table (through a
short-TTL cache, like the contract cache), so an approved widget resolves and
REF-01 stops blocking a dashboard that binds it — without a restart.

Adding the column this needed exposed a gap: `CREATE TABLE IF NOT EXISTS`
silently skips an existing table, so a column added later never reaches a
deployed database. The dialect grew an `alters()` list — additive column adds,
replayed every boot and *expected* to fail once present, since SQLite has no
`ADD COLUMN IF NOT EXISTS` — which `migrate` runs tolerantly. Only additive:
nothing there may drop or rewrite.

## ADR-47 — a widget proposal is contract-first, and says so

**Decision:** `chartroom_proposal` grows `artifact_type` (`metric | widget |
pattern`), and the machinery generalizes rather than being duplicated. What
differs is what "evidence" means. A metric is validated by *running* it —
parse, diagnose, evaluate, compile. A catalog entry has nothing to run, so its
evidence is structural: does it satisfy the contract schema, and does every
reference it makes point at something real? A widget citing
`guide_rules: [FOO-99]` claims the linter enforces a rule that does not exist,
and a reviewer reading the contract has no way to notice — so that is a
blocker, not a warning.

Approval's real act follows the artifact: a metric enters the KEEL registry, a
widget or pattern becomes a new catalog version. Both are re-validated at
decision time, because the world may have moved since submission — publishing
over a name that is now taken would silently lose whichever write lost the
race.

**A contract may be approved with no implementation.** That is the honest
half: the design steward is approving a *contract*, and whether a renderer
exists is a separate engineering fact. Such an entry is a real catalog member
flagged `renderable: false`, the studio's canvas says "an approved contract
with no renderer yet" rather than showing a broken binding, and `/api/widgets`
reports the set so no surface has to guess. The alternative — refusing to
approve until code lands — would put the design review behind the
implementation it is supposed to govern.

The design steward decides widgets and patterns; the metric steward decides
metrics; both are refused to `agent:*` identities at the API, unchanged since
ADR-24.

## ADR-48 — Chartroom renders on Aperture Risk, by reference not by copy

**Decision:** the studio imports the vendored Aperture Risk token files
directly (`src/styles/aperture/tokens/*`), and every `--cr-*` name is an
*alias* onto an Aperture semantic token rather than a value of its own.

The stylesheet already claimed this. Its header read "the Aperture Risk
system's tokens, `--cr-*` scoped" while carrying hand-copied hexes that had
wandered off the system: `--cr-panel` at `#171a20` against Aperture's
`#22252A` surface, borders three steps too dark, gains at `#4cc38a` against a
system that specifies `#2ED389`. Nothing was wrong on screen — it simply was
not the design system it said it was. That is the same failure this product
exists to prevent, one layer over: a copy that keeps a provenance claim it no
longer earns. Aliasing makes the claim structural, the way binding a widget
to a registry ref makes a number's provenance structural.

Alignment beyond colour, since a design system is not a palette:

- **Inter, self-hosted.** The studio pulled Inter from the Google Fonts CDN
  while the root app self-hosts it with a written rationale — a webfont that
  arrives over the network is one that sometimes does not, and behind a proxy
  or offline every numeric column reflows out of tabular alignment. The studio
  now serves the same woff2 files.
- **Inter exclusively.** `--cr-mono` was an `SF Mono` stack; Aperture aligns
  columns with Inter's tabular figures rather than by swapping typeface, so it
  now resolves to `--font-mono` (Inter) and the tabular feature settings are
  global.
- **Crisp radii.** 4/6/8px corners became the system's 1–2px scale. Aperture
  is explicit that this is an instrument, not a toy.
- **A visible focus ring.** The sheet removed the UA outline and replaced it
  with a border tint on inputs only, leaving every button silent to keyboard
  focus. Aperture's 3px yellow ring now applies to anything focusable.
- **Viz order.** Series run Aperture's `viz-1 → viz-2 → viz-3`
  (yellow → sky → violet); semantic red and amber stay out of the series
  palette, which is COL-03's chromatic half and the reason a breach still
  reads as a breach.
- **The deck too.** The PPTX export carried a third palette of scattered
  literals (`666666`, `AA3333`) that belonged to neither the studio nor the
  system. It now names its greys from Aperture's ramp. A deck inverts onto
  white because it prints — the surfaces flip, the semantics do not.

**Two deliberate departures, both for contrast.** Aperture's `--text-tertiary`
(#757A82) reaches 3.2:1 on `--surface-2`, and this surface uses tertiary text
for 10–11px axis ticks and hints where WCAG allows no large-text exemption; the
text ramp therefore steps up one, to `--gray-200` for muted and `--gray-300`
for faint, both of which clear 4.5:1 everywhere they land. Breach *text* takes
`--danger-500` mixed 75% toward `--gray-0`, because the raw danger red reaches
only 4.28:1 on a panel; fills, borders and marks keep the token unchanged.
Both stay inside Aperture's own scale — a different step on the ramp, not a
colour invented beside it — and the root app made the same call for the same
reason.

---

## ADR-49 — the registry engine and db layer are packages, not paths

**Pinned:** nothing — this records a boundary that was never decided, only
accumulated.
**Decision:** `src/engine` is the `keel-engine` package and `server` is
`keel-registry`, both npm workspaces with an `exports` map. Chartroom depends on
them by name.

Chartroom-server evaluates registry documents with the same engine the authoring
surface uses, and stores its tables through the same portable db layer (ADR-4).
Both are right. What was wrong was how the edge was written: twenty-odd imports
of the form `../../../src/engine/evaluate`, plus a `tsconfig.json` that reached
two directories up to typecheck source it did not own.

That has three costs, none of them theoretical:

- **npm could not install it.** The workspace graph said chartroom-server
  depended on spec, patterns and critics. It also depended on the engine, the db
  layer and — undeclared — chartroom-widgets. Anything that resolved packages
  strictly, a path-filtered CI or an extracted workspace, would have broken.
- **The same source was typechecked twice, under conflicting configs.**
  `src/engine` was checked by the app project (DOM lib, no Node types) and again
  by chartroom-server's (Node types, no DOM). A change satisfying one could
  break the other, and the one it broke was not run by CI.
- **`boundaries.test.ts` could not see it.** That file enforces the internal
  direction well, and bans `../../` escapes — from `spec/` only. The one edge
  leaving chartroom entirely was the one nothing checked.

The `exports` maps are the boundary now. `keel-registry` publishes `./db` and
`./dialect` and nothing else, so ADR-4's "reuse the dialect layer" is enforced
rather than described — the API surface, the read-only guard and the Dremio
gateway are not reachable by name. `keel-engine` maps `./*` to `./*.ts`, because
every module in it is a legitimate entry point and a hand-kept list would go
stale. `boundaries.test.ts` gained the outward rule to match.

**Not done: moving the directories.** `keel-engine` still lives at `src/engine`,
inside the app that is its main consumer. Moving it to a top-level `packages/`
would touch 91 files to change no dependency — the app's own imports of it are
relative and correct, being intra-tree. The rule is: **inside `src/`, reach for
the engine relatively; outside it, depend on `keel-engine` by name.**

ADR-4 was previously cited in `chartroom/server/tsconfig.json` as authorising
all of this. It does not — it is a database decision about reusing `server/db.ts`
and says nothing about consuming the engine as source or about tsconfig includes
escaping a workspace. This ADR is what that comment should have pointed at.

---

## ADR-50 — Turborepo over hand-written script fan-out; npm stays

**Supersedes:** the second half of ADR-1.
**Decision:** Turborepo drives the task graph, on npm workspaces, in an
`apps/` + `packages/` layout. No pnpm.

ADR-1 rejected "pnpm workspaces + Turborepo" as one item. Its load-bearing
objection was the second package manager — *"every contributor and every CI job
resolve dependencies two ways, and the failure mode is exactly the class of
silent drift this whole platform exists to prevent."* That argument is still
right, and nothing here disturbs it: one `package-lock.json`, `npm ci`, no pnpm.

Its second objection has not aged as well. *"Turborepo's incremental caching is
worth having at twenty packages; at four it is a config file that can go
stale."* There are fourteen now. And the config that went stale was the
hand-written one: `.github/workflows/verify.yml` ran three of the four legs
`npm run verify` defines, for months, while its own header comment claimed it
ran all of them (ADR-49). A `turbo run test` job cannot drift that way — it
fans out over the package graph, so a workspace added tomorrow is covered by a
file nobody edits.

What the move buys, concretely:

- **The fan-out is derived, not listed.** `test:chartroom` named six workspaces
  by hand and would have silently skipped a seventh.
- **Caching.** A second `turbo run typecheck` over fourteen packages is 25ms
  against 14s, and CI restores the same cache between runs.
- **Shared config.** Seven near-identical tsconfigs, drifting independently,
  now extend `@repo/typescript-config`.

**The layout.** `packages/` is what other workspaces import; `apps/` is what
deploys or ships. This also ends an anomaly ADR-49 knowingly left behind:
`keel-engine` and `keel-design-system` were packages nested *inside* the app
that consumed them, at `src/engine` and `src/styles/aperture`. That was the
cheap way to declare the dependency without moving 91 files. The files are
moved now, and the rule "inside `src/`, reach for the engine relatively" is
gone with them — every cross-package import is a package import, everywhere.

**Two deviations, both recorded rather than hidden.** `keel-registry` keeps its
process entry point (`index.ts`, a `start` script) inside a package rather than
splitting a three-line `apps/registry-api` off to satisfy the convention; three
workspaces import it as a library, and the convention is not worth a package
that does nothing. And the two Playwright apps extend the shared tsconfig by
relative path instead of by package specifier, because Playwright resolves
`extends` itself and cannot follow a package specifier even with an exports map.

**What the move broke, which is the argument for having done it under a green
suite.** Two entry points guarded themselves with a regex on their own file
path — `/server[/\\]index\.ts$/`. Moving the file made the guard stop matching,
so `main()` never ran, the process exited 0, and the only symptom was a
downstream suite waiting sixty seconds for a server that was never going to
listen. Both are `import.meta.url === pathToFileURL(process.argv[1]).href` now.
Four test fixtures and one Python module located their siblings by relative
depth and had to be repointed. None of that was visible to a typechecker.

---

## ADR-51 — uv for both Python environments, with lockfiles

**Decision:** uv manages the Python side. Two projects, each with a committed
`uv.lock`: the root `pyproject.toml` (the compute backends and the warehouse
transport, replacing `requirements.txt`) and `apps/chartroom-agent`.

This is less a new decision than the one E7.1 already made. The plan specified
"`pyproject.toml` (uv)"; what shipped was `python3 -m venv .venv &&
.venv/bin/pip install -e '.[dev]'`, and the root stayed a `requirements.txt`
installed with `pip install -r`. Two tools, no lockfile, and a venv that was a
manual prerequisite — which is exactly why that gate had never run anywhere but
on a machine somebody had configured by hand (ADR-49).

**What a lockfile is for here.** `requirements.txt` pinned seven names exactly.
It did not pin what those seven resolve to, and the transitive set is what has
actually broken this repo: `flightsql-dbapi` dragging `sqlalchemy` back to 1.4
and taking PyIceberg's catalogue with it. `uv.lock` pins the whole graph — 37
packages at the root, 88 for the agent — and `--frozen` in CI turns a
regenerated-but-uncommitted lock into an error rather than a drift nobody sees.

**It found something on the first run.** `polars==1.43.1` resolves to
`polars-runtime-32==1.43.1`, which is **yanked**. pip installs a yanked release
with a warning on stderr and continues, so the pin read as healthy for as long
as pip was the only thing looking at it; uv refuses outright, which is the only
reason anyone noticed. Bumped to 1.43.2, the replacement patch, and the
conformance harness agrees with the DuckDB oracle at the same 1e-6 it always
did — which is the check that makes a Polars version bump safe to assert
rather than hope about.

**The constraint that shapes the setup.** The conformance and Flight SQL suites
shell out to a bare `python3` (`execFileSync('python3', …)`), so it is not
enough for the environment to exist — it has to be the `python3` on PATH, or
the suites skip themselves into a green tick that means nothing. `uv run`
handles that locally; CI puts `.venv/bin` on `$GITHUB_PATH` once per job.

**The interpreter is pinned too, in `.python-version`.** A lockfile pins
packages, not the Python they are resolved for. Dropping the old workflow's
`setup-python: '3.11'` in favour of uv quietly handed that choice to whatever
the runner had: the first CI run built the environment on 3.12 while every
local run used 3.11, with the agent's ruff and mypy still configured for
py311. Both projects carry a `.python-version` now, which uv reads.

**Dev tooling is a dependency group (PEP 735), not an extra.** `uv sync` and
`uv run` include groups by default, so the agent's gate is `uv run pytest` with
no flag to forget. Extras are for something a consumer might install; nothing
consumes this service as a library.

The venv guard is gone with it. `verify` used to begin by testing for
`.venv/bin/python` and telling you which command to run; `uv run` builds the
environment from the lock on demand, so there is no prerequisite left to
forget and no error message needed for forgetting it.

## ADR-52 — The studio opens read-first; author is a route, not a flag

The v2 design inverts what this surface is by default. The board, the scope it
is read under, and the exceptions standing against it are what you land on; the
dashboard list and the inspector are authoring tools you switch into. Most
people who open a chartroom board are reading it, and the previous default made
every one of them dismiss two panes of authoring furniture first.

**The mode is `#/author`, not component state.** The app already had a hash
router — `#/view/:id`, `#/proposals`, `#/widgets` — and a second, invisible
notion of "where am I" is how two navigation systems start disagreeing. As a
route it survives a reload, it can be linked, and the e2e specs that exercise
authoring say so in their `goto` rather than clicking a toggle first.

**The cross-filter chip moved into the context bar.** A filter is scope, the
same category as as-of or a context param, and reading all of it in one strip
beats finding one piece floating over the tiles. `Canvas` no longer owns that
state; it takes `cross` and `onCross` from above.

**`spec.context` finally has a control.** `paramsOf` has resolved declared
context params to their defaults since Phase 1, with the comment "no context
bar yet". This is that bar. The chips' options are asked of the engine as a
grouped query on the param's dimension, so a value the picker offers is a value
a widget can actually be narrowed to — a hardcoded list would eventually offer
a filter that returns an empty board.

**As-of and basis resolve in the engine, not in the browser.** The prototype
scales fixture numbers by a per-entity multiplier to simulate the controls. Here
`QueryRequest` grew `asOf` and `basis`, the evaluator reads the index for that
date instead of always `LAST`, and a series stops at the as-of date rather than
drawing into its future. Both fields are part of the cache key: the key is an
explicit allow-list, and omitting them would serve the first date's answer for
every date the analyst picked — a control that looks live and is not. `prior`
follows the basis, and so does the label the tile prints beside the delta.

**Exceptions are derived, never authored.** The strip joins the server's lint
report with the pin-upgrade notices. It invents no severity of its own: BLOCK
becomes a breach, WARN a warning, a `GOV-*` rule says governance in governance's
words, and a stale pin is a pin. SUGGEST findings are excluded — the strip is
what you must answer for before trusting the board, and mixing suggestions in is
how a breach ends up eighth in a list nobody reads. Acknowledging hides a row
for the session; it writes no audit record and clears no gate.

**Two deliberate departures from the prototype.**

*The drill-down ends in the aggregate breakdown, not the underlying rows.* Row
level data has no representation in the query response types at all — that is
the structural half of the aggregates-only boundary, stated in `query.ts`: "Row
level data has no representation in the response types, so it cannot leak by
accident." Adding a rows endpoint to feed a drawer would dismantle the guarantee
in order to decorate it. The breakdown answers the question a reader is actually
asking — which slices make up this number — and the CSV exports that. Everything
else in the drawer is the real thing: the lineage is the contract's registry
metadata and the compiled query is the SQL the warehouse manifest publishes.

*The DRAFT watermark stays visible in read mode.* The prototype shows it only to
authors. Hiding "uncertified metrics present" from the audience that is reading
the numbers, and showing it only to the person who already knows, inverts who
the warning is for.

**Still open.** The prototype's dated, bylined annotation notes are not built.
`annotation@1` carries a single `note` string, so dated entries with an author
are a change to a governed widget contract — which this repo has a proposals
flow for, and which is not a UI change. The `▲` markers on the trend line hang
off the same data and wait with it.

## ADR-53 — no SQL model layer; the row stage stays a closed vocabulary

**Considered:** the transformation layer every warehouse-native BI tool has —
Rill's `models`, dbt's, SQLMesh's. A SQL file per transformation, DAG'd by
reference, materialized as a view or a table, sitting between the raw source
and the metrics view.
**Decision:** no. The row stage keeps its five declarative operators, and the
transformation layer stays upstream, where it already is.

**Arbitrary SQL is opaque to everything this engine sells.** `DERIVATION_OPS`
(`vocab.ts`) is five operators — `classify`, `date_bucket`, `days_between`,
`param_lookup`, `expr` — and the closure is the point. Because `product_id` is
`op: classify, using: fr2052a_product_id` rather than a `CASE` expression,
`impact.ts` can find every view whose numbers move when that rule set changes,
and the coverage panel can say which rule fired on how many records moving how
much notional. Written as SQL in a model file the same derivation is a string:
lineage stops at the file boundary, impact analysis returns nothing, and
coverage has nothing to count. `conformance.ts` requires DuckDB, Polars and the
fixtures to agree to 1e-6, which is only checkable because every operator has a
known emission per backend — and where an emission does not exist, `semantic.ts`
refuses by name: *"ema() is a preview approximation, not a definition — there is
no portable SQL for it."* Hand-written SQL has no such refusal available. Every
construct is emittable because the author already emitted it, which is P7 losing
its grip on the one layer that touches rows.

**The boundary is already written down.** `product.md` §7: *"No raw SQL in a
dashboard spec. The moment one exists, the registry stops being the only data
API and every guarantee above becomes advisory."* A model layer is that
sentence one hop upstream. The hop does not change the consequence.

**And the layer exists, pointing outward.** `semantic.ts` emits `CREATE OR
REPLACE VIEW` and dbt semantic models, on the argument that the last hop of a
governed number should not be a human retyping it. Adding our own SQL
transformation layer would rebuild dbt inside the product whose stated job is to
be the definition dbt consumes. The source names say the same thing:
`alm.fct_liquidity_position` and `alm.fct_2052a_positions` are fact tables that
arrive joined, and `planLines` compiles to `SELECT * FROM <source>` accordingly.
The joins happen in the pipeline. The README calls it "the plan that the nightly
pipeline will run" — the pipeline runs it.

**What we do not have, stated plainly.** `derivations` are scoped to one
document, and exactly one document has them (`fr2052a_outflows`). A second view
over `alm.fct_2052a_positions` — NSFR, or a submission at another grain — would
re-declare the `classify` → `param_lookup` → `expr` chain that turns a balance
into a weighted amount. Two copies of an applied regulatory classification is
precisely the failure `semantic.ts` opens by naming: **drift you cannot detect
is worse than a wrong number you can.** Copy-paste drift is detectable in
principle and nothing here detects it.

**The shape it takes when it arrives is not a model.** It is a
`prepared_source` document: the same five operators, given a name and a
governance header, referenced by a `metrics_view` the way `murex_eu_binding`
already names `binds: alm.fct_2052a_positions`. Almost none of that is new
machinery. `rowStageSql` (`compile.ts`) already emits the stage as flat SQL
steps in dependency order, and `ManifestDoc.row_stage` already ships them for
the warehouse to chain "one CTE per step under the source before aggregating".
What is missing is an identity and a reference, not an execution model.

**It is not built, because one instance is not an abstraction.** ADR-1 rejected
Turborepo with "at four packages it is a config file that can go stale" and
ADR-50 revisited it at fourteen, so the honest form of a deferral here is to
name the count that changes the answer: build `prepared_source` when a second
document declares a derivation chain overlapping an existing one. The shape of
that second consumer decides whether it wants sharing or just repetition, and
guessing now would fix the wrong one in a document kind.

**One adjacent idea is worth taking, later.** Materialization. The row stage is
recomputed inline for every measure on every query; a `materialize` hint on the
stage is the standard answer and would be a compile-target concern — a decision
`rowStageSql`'s consumers make about persistence — not a new thing for an author
to write. Deferred, not rejected.

**Two are explicitly not taken.** Incremental and partitioned models, because
refresh state and scheduling belong to the pipeline and owning them pulls this
product into orchestration it deliberately sits beside. And models as inputs to
a dashboard spec, which is the §7 boundary above, restated.

## ADR-54 — `prepared_source`: the row stage becomes a document

ADR-53 named this shape and declined to build it, on the reasoning that one
instance is not an abstraction and the trigger should be a second consumer. That
is not what happened. It was built on request, ahead of the trigger, and the
honest record is that the deferral was overtaken rather than satisfied — so what
follows is the argument for the thing as built, not a claim that ADR-53's
condition was met.

**The shape is the one ADR-53 specified.** `kind: prepared_source` carries a
`source:`, a governance header and an `effective` range, and holds nothing but
`derivations:` — the same five operators, unchanged. A `metrics_view` names one
with `prepared:`, and `derivationsFor` composes the two: the shared stage first,
the view's own after. Order is the contract, and it runs one way. A view
derivation may build on a prepared column — `weighted_amount` reads
`outflow_rate` — and a prepared source may not name another, which keeps the
shared stage independent of whoever consumes it and the stage exactly one level
deep.

**It resolves like a rule set, because it is one kind of thing with them.**
`resolvePreparedSource` reads the version in force at the as-of date, so
re-running a prior submission uses the stage that applied then. Valid time was
never optional for the documents a filed number depends on, and a row stage is
now one of those.

**The shipped workspace uses it, and the proof is that nothing moved.**
`fr2052a_outflows` had five derivations; four are now `fr2052a_prepared` and the
view keeps only the weighting step that is its own. That extraction is asserted
to be invisible: the composed stage matches the inline one operator for
operator, `rowStageSql` emits identical steps, `compileReport` emits an
identical plan on all three backends, and the Polars conformance harness runs
the compiled plan in a real interpreter and still agrees with the evaluator on
the filed table. The assertions were checked against a deliberately broken
composition — six of them fail without it.

**Four ways a shared stage is silently wrong, and all four block.** A stage that
does not exist (`KEEL090`), one not in force at the as-of date (`KEEL091`), one
that prepares a *different* table from the one the view reads (`KEEL092`), and a
column the view defines that the stage already defines (`KEEL093`). None of
these throws on its own — each produces columns computed from the wrong rows, or
a column whose winning definition is decided by concatenation order — which is
why they are errors rather than warnings.

**A view still owns what it prepares from.** The derivation checks run over the
*composed* stage, not just the lines the document wrote: if the rate table the
shared stage looks up against is out of force, the view says so, because the
view's numbers are the ones that are wrong. It cannot point at a line it does
not have, so a borrowed finding points at the `prepared:` reference — the line
the author would actually edit.

**What it cost elsewhere, found by tests rather than by reading.** Making the
row stage shareable broke five things that had reasonably assumed a view
declares its own derivations, and each was a real defect rather than a stale
assertion: the source-binding analysis stopped seeing derived columns and
demanded the adapter map them; `assessChange` could no longer find the document
that classifies with a rule set, so a rule edit reported no impact at all;
`liveCoverage` and `liveSample` 404'd for the same reason; the MCP coverage tool
went quiet; and the lineage panel gave a rate table no chain, because its
consumer was now the stage rather than the view. `usedBy` is expanded through
prepared sources for the same reason — "what breaks if I change this" must not
stop at the one document whose output nobody reads. Nothing else is expanded:
the rest of the graph keeps the one-hop answer it always gave.

**Materialization is still not built.** The stage is inlined per query, exactly
as before; ADR-53's note about a `materialize` hint stands unchanged, and having
an identity to hang one on is the part that had been missing.

## ADR-55 — the design agent is a left rail; the strip reads the variance monitors

The v3 handoff's Track B, over the ADR-52 surface. Two enhancements landed
and four prototype behaviours were deliberately not reproduced.

**The chat became the rail.** Left side, first thing in the body row, open by
default in both modes — the intake conversation is part of the surface, not a
pane you discover. The transport did not move an inch: the same frozen SSE
contract (ADR-37), the same parser, the same honest degrade when no model or
no service is there (ADR-35). `thread_id` now round-trips, so the session
label in the rail's header is the server's actual LangGraph thread (ADR-38),
and `new` genuinely starts one.

**The composer completes from real things.** `/` offers the seven commands as
text the agent receives; `@` completes from the open spec's widget ids, the
registry's contracts, and the board list — a mention offered is a thing that
exists; `#` completes from the pattern catalog. Dropped files travel only
when they can actually travel: text up to 32KB is inlined into the message,
anything else is refused with the reason, because a chip on a message the
content never reached would be a lie shaped like a feature.

**Pointers are the load-bearing interaction.** `✳ ask` on a frame attaches
the widget; the message the agent receives carries the widget id, its
binding, and the environment the reader was looking at — as-of, basis, scope
— serialized in a context block. "Explain this tile" becomes a resolved
reference. Asking again detaches; the same die-where-born rule the
cross-filter follows.

**The `thinking` event is additive.** The protocol grew one event type, which
ADR-37 explicitly allows — clients ignore unknown types. The Python service
emits it only when the model actually streams reasoning blocks; the rail
renders it collapsed, dimmer and italic, because it is pre-verbal.

**The exception strip's value rows come from the variance monitors.** The
prototype invents LIM-101/LIM-204 with thresholds in client code and asks for
an "internal amber" read from governance config. This workspace already has a
governed place where limits live: `kind: variance_monitor`, whose thresholds
are effective-dated, cited and severity-carrying. `GET /api/exceptions` runs
every monitor through the engine's own `runMonitor` at the requested as-of;
the strip shows the breaches with the threshold id as the code — a code a
steward can open, not a label invented for the strip. The strip's title
changed to "Exceptions this morning" because its scope genuinely widened: a
board that lints clean can still open on the morning's breaches, which is the
entire point of the strip.

**Not reproduced, and why.**

*The phase spine gates nothing.* It is client-derived orientation from the
message's intent. The gates the prototype's artifact cards advance — brief
approval, promotion — stay in the Brief and Govern tabs, where a named human
clicks them (P6). An in-thread "Approve brief" button was considered and
declined: an approval control inside the agent's own output stream is the
wrong place to put the one act the agent must never perform.

*Checklist and artifact segment kinds are not rendered.* The real stream
carries `text`, `tool` and now `thinking`. The prototype scripts its
checklists and artifact cards; rendering those shapes from anything other
than real structured events would be a conversation pretending to a
structure it does not have. When the agent service emits them as typed
events — an additive protocol change with agent-side work behind it — the
rail gains the renderers.

*The stress-haircut basis is refused.* A comparison basis needs a governed
transform per measure; the workspace defines a stress variant only where a
`*_stress` measure exists. The prototype's `basisMult` multiplier is exactly
the painted-on control ADR-52 exists to refuse.

*Fixed ENTITY/CCY/PRODUCT selectors, dated annotation entries, and the
drawer's underlying-rows table* stay as ADR-52 decided: context chips derive
from `spec.context`; dated bylined annotations are a change to
`annotation@1`'s governed contract, which has a proposals flow; and
row-level data has no representation in the query response types
(`product.md` §7) — a boundary, not a backlog item.

## ADR-56 — the agent extends to the metrics-engine surface; an agent identity never writes

The design-studio agent concept, applied to the registry's authoring
surface. One agent service, one frozen protocol, one loop — and per surface,
the things that actually differ: which MCP server supplies the tools, what
identity that subprocess asserts, which tool names may never appear in the
roster, and the system prompt that encodes the surface's journey.

**The prerequisite came first: the write gate became an identity, not a
flag.** registry-mcp gated `save_artifact`, `promote` and `create_release`
behind `KEEL_MCP_WRITE=1` — an env flag, which is exactly "a permission that
could be granted later", the thing the maker-checker seam (P6, ADR-24)
forbids for a model session. Now an `agent:`-prefixed identity — chartroom's
convention: `agent:*` is an agent to the server whatever it calls itself
after the colon — is refused permanently: the server does not register the
three write tools for that identity at all, the policy forces `canWrite`
off whatever the flag says, and the tool layer refuses with a message that
names the loop to use instead. Absent beats present-but-refused: a tool
that exists is a permission waiting for a flag. The tool-layer refusal
stays as defense in depth for a server assembled by hand.

**The service is a surface parameter, not a fork.** `AGENT_SURFACE` picks
chartroom (the default — byte-for-byte the ADR-36 service) or registry:
registry-mcp over stdio under `KEEL_MCP_IDENTITY=agent:lg-registry`, a
banned-name guard covering the write tools so a drifting roster fails
loudly at startup, a registry system prompt, and the same `/agent/chat`
endpoint speaking the same frozen events. The studio's warehouse query
executor does not ride along on the registry surface. The registry server
grew the one route the pure `handle()` contract cannot model — `POST
/api/chat` streams the agent service's SSE frames through untouched, with
the same honest `unavailable` degrade the studio's proxy has (ADR-35) —
default agent port :8790, so both surfaces can run at once.

**The registry surface's journey is propose → prove → hand over.** The
system prompt encodes it: read `get_lineage` before touching anything
(`usedBy` is the list of things a change breaks), draft the full document
body, prove it with `validate`, `test_rules`, `preview_report` and always
`assess_change` — a `needsReview: true` is something the human hears from
the agent, not discovers — and hand over the body in a fenced block. The
rail renders that fence as a code block with a copy button, and that button
is the entire hand-over mechanism: the author carries the body into the
editor and saves under their own name, where the same diagnostics hold
them. A "save" or "apply" button on the rail was considered and declined —
it would collapse the seam the identity refusal exists to hold open.

**The rail is the ADR-55 rail with the registry's vocabulary in every
slot.** Phases intake → draft → prove → hand over (orientation only; the
spine gates nothing). `/` completes the six propose-and-prove commands; `@`
completes from the lineage's documents and the open view's measures — a
mention offered is a thing that exists. The pointer is the signature
interaction re-grounded: on the analyst surface a pointer is a widget; here
it is a *diagnostic* — `✳ ask` on a problems-strip row attaches the code,
the line and the message as a resolved reference, asking again detaches
(die where born), and asking with the rail closed opens it. The `[viewing]`
block carries document, kind, test-data fixture and active measure.

**Deliberately different from ADR-55: closed by default.** The analyst
surface opens on the conversation because intake is the landing experience
for a reader deciding what a board should decide. An author opens this
surface with a document and intent; the rail is an instrument reached for
— the toggle in the editor's toolbar, the choice persisted like the
editing-mode choice — not chrome that arrives uninvited. If use teaches
otherwise, flipping the default is a one-line change and a new sentence
here, not a redesign.

---

## ADR-57 — human identity and segregation of duties

Shipped. The maker-checker seam between agent and human was structural; this
makes the seam between human and human match it, enforced in the same layers
the agent refusals live in — never the client.

**Identity: required by mode, asserted by the front door.**
`KEEL_REQUIRE_IDENTITY=1` makes the registry refuse any write whose request
carries no asserted identity, with a message naming the control. Identity
still comes only from `KEEL_IDENTITY_HEADER` — the seam built for the SSO
reverse proxy — never from the body; registry-web's dev/preview proxy stands
in for that proxy via `KEEL_DEV_IDENTITY`. And an `agent:` identity is
refused on every write route regardless of mode: the tool surface never
offers agents the write tools (ADR-56), and the HTTP door is not the way
around it.

**The second name is the control.** A save carrying an acknowledged
weakening is *flagged* (`needs_review` on the revision — written by the MCP
save that ran the assessment, or declared by an API caller that did). The
author's acknowledgement is intent; a release refuses to pin a flagged
revision until a **different** identity records a review of it —
`POST /api/artifacts/:name/review` or the MCP `record_review` tool, each
refusing the author's own signature. Reviews are append-only rows naming
exactly what they reviewed.

**Cutter ≠ sole promoter.** A release carrying tier-1 artifacts cannot be
promoted by the person who cut it unless a second identity has signed the
release (`POST /api/releases/:version/review`) — or a second person simply
promotes it themselves. Tier detection is a deliberate textual scan for
`sr_11_7_tier: 1+` across the release's documents: tier lives both on
measures and in governance blocks, and over-matching turns the stricter
control on — the safe direction — where a parse that missed one shape would
turn it off.

**Enforcement placement.** Refusals live in `api.ts` (the identity gate and
review routes), `runtime.ts` (the release and promotion gates), and
registry-mcp's tool layer — the same three places the agent refusals sit.
Tests take the agent-refusal shape: same person, both roles, refused with
the control named; the browser surface degrades to "save failed" with the
control in the tooltip rather than crashing.

**Deliberately not done here.** No identity *provider* ships in this repo —
authentication is the reverse proxy's job, and the registry's contract is
"the header is the assertion". The review UI on registry-web (a queue of
flagged revisions awaiting a second name) is follow-on surface work; the
control does not wait for its chrome.

---

---

## ADR-63 — the scale is d3's; the marks are still ours (amends ADR-8)

Shipped. ADR-8 rejected ECharts and hand-rendered the charts instead, and
two-thirds of that decision has held: Phase-1 widgets never needed the
interaction machinery, and when cross-filtering did land in Phase 4 it cost
about six lines per widget — `onPick`, `role="button"`, `tabIndex`, an Enter
handler — with better keyboard behaviour than a library's click model would
have given us. That part stands unchanged.

What did not hold is the half of ADR-8 nobody argued for. It reasoned about
*rendering* and concluded about *geometry*, so the scale arithmetic got
hand-rolled too, on the same "no dependency" grounds. Three defects came out
of that, and all three are in the class this product exists to prevent —
a number that is not what it claims to be:

- **A gridline was not where its label said.** `ticks()` cut the extent into
  four equal steps and `formatTick` rounded to a whole unit. On an LCR series
  around the 100% minimum that drew a line at 100.671% labelled `101%`; at
  the billion boundary it labelled a $1.134B tick `$1.1B`, a $34M error on a
  landmark someone measures against. Worse, the extent's divisions landed
  nowhere nameable, so **100% — the threshold the whole chart is read
  against — never got a line at all.**
- **The x axis was the array index.** `query.ts` returns the as-of dates that
  exist, so a business-day series skips weekends; spacing points by position
  drew a Friday-to-Monday move as though it happened overnight.
- **The SVGs stretched.** `preserveAspectRatio="none"` on five widgets scaled
  a 600×240 viewBox to whatever the card was, distorting type and stroke
  weights by the cell's aspect ratio — under ADR-48, which self-hosts Inter
  precisely so numeric columns hold their shape.

**Decision:** `d3-scale` (with `d3-array`) supplies the y domain, its ticks
and the time axis. `scaleLinear().nice()` gives bounds whose divisions are
round, so ticks land on values a reader can name and the LCR chart gets its
100% line; `scaleUtc` spaces points by elapsed time, UTC because an as-of
date is a calendar day and a DST zone would shift some points and not
others; `formatTick` now picks precision per value — the fewest decimals
that still say the number exactly — so the label is true of the position by
construction rather than by luck.

This is not ADR-8 reversed. d3-scale is arithmetic: no React, no DOM, no
CSS, no component model, nothing that renders. Every mark on every chart is
still an SVG element this package writes itself, in the idiom ADR-8 chose,
and the widget contracts are untouched — no spec changes, no version bumps,
because none of this is visible through the catalog seam. That seam is what
made the amendment cheap, which was ADR-8's own argument for having it.

**Why not a chart library.** The occasion for this was a proposal to rebase
the widget catalog on Evil Charts (Recharts + Apache ECharts behind
shadcn/ui and Tailwind, installed as a copy-in registry). It would fix the
two scale defects — by vendoring d3-scale, which is the part actually doing
the work — and charge a Tailwind/shadcn substrate the studio does not have
(ADR-34 declined the same trade for AI Elements), an ECharts provider that
reverses ADR-8 by the back door, and 49 components carrying their own
palette against COL-03's viz ordering. The governed half of the catalog —
contracts as data, importable by the server without React, `family` as a
claim about which rules apply (ADR-42) — has no counterpart there and would
have had to be rebuilt on top. The escape hatch stays where ADR-8 put it: a
widget that genuinely needs brushing, a synchronised crosshair or canvas at
scale can take that dependency behind its own contract, on evidence, one
widget at a time.

**What now fails if this regresses.** `every gridline is where its own label
says it is` sweeps ten series across the shipped formats, parses each label
back with an inverse of `formatTick`, and asserts it equals the position the
line is drawn at. The old code fails it five times over. The test that was
there before — `ticks sit strictly inside the extent` — passed throughout:
containment was true, and it was never the property that mattered.

## ADR-64 — the treasury grid is a headless core behind the widget seam, not AG Grid and not a component library

Phase 0 shipped; the plan's later phases are its consequence. The occasion
is a request to build the dashboard builder's standard grid to the shape of
the AG Grid Enterprise demo — grouping with subtotals, set filters, pinning,
master-detail, xlsx export — over a non-ticking treasury book, arranged so
the data layer can later become DuckDB-WASM or Dremio and so the grid's
state doubles as an agent tool contract.

**Decision, in four parts.**

*The table logic is TanStack Table v9, pinned exact (`9.2.4`).* Headless:
it owns row models, state slices and the feature registry, and renders
nothing. This is ADR-63's arrangement, one layer up — the arithmetic is a
library's, the marks are ours. v9 is explicit where v8 was implicit: a
state slice, an API or a row model exists only if `tableFeatures()`
registers it, and the registry type-checks its own prerequisites, which is
why the grid declares every feature once (`grid/features.ts`) and every
screen reaches the same instance through one hook. The version is pinned
because the API moved between betas and the docs lag; the declarations and
skills shipped in `node_modules/@tanstack/*` are the reference, not memory.

*Tailwind and shadcn — declined here, reversed by ADR-65.* The plan as
pasted specified both; Phase 0 shipped without either on ADR-34's reasoning
and ADR-48's binding, with one stylesheet of geometry that named no colour
of its own. The reversal, its terms, and how ADR-48 survives it are ADR-65's.
The component contract is still what the AG Grid demo is worth replicating.

*Column meta is the single source of behaviour.* Formatting, groupability,
aggregation, conditional formatting and the export's number formats all
read `ColumnMeta`; there is no per-feature column list. Where a unit
already has a rendering in the widget catalog the grid delegates to
`chartroom-widgets/format`, so a cell says the tile's number and the deck's
(ADR-29). One vocabulary difference is recorded rather than papered over:
the grid's `bps` is a *unit* the stored value is in, where the catalog's
`bps` is a *format* that converts a percent — when the grid binds to a
registry metric the contract's `format` derives the meta, and that mapping
is where the two meet.

*The package sits at `spec ← grid ← studio`.* It is not a widget: a widget
receives a few hundred resolved aggregates and may not fetch, and this grid
holds fifty thousand raw positions behind a `DataSource` that a remote
adapter will one day implement. So it is a sibling of the catalog, not a
member — the boundaries test says it imports the widgets' React-free
subpaths only, and that its table, components and export never fetch;
`src/data` is the one directory a query may leave from. When the grid does
become a canvas widget (`data-grid@1`, Phase 4+), the widget will be a thin
contract over this package, the way `perspective-grid@1` is a contract over
a renderer (ADR-9).

**Why not the alternatives.** AG Grid Enterprise is licensed per developer
and closed; its state is not a JSON shape an agent can be handed and
validated. FINOS Perspective (ADR-9's deferred wrap) is a pivot engine, not
a row grid, and its WASM is the weight ADR-9 declined to pay for a few
hundred cells — it may still land under `perspective-grid@1` when the
cross-filter loop gives it a job. Building the row models by hand is what
ADR-8 did for scales, and ADR-63 records how that went.

**What Phase 0 leaves honest.** `wavg` was declared in meta but not
registered until Phase 2 landed it behind its tests (ADR-67); until then a
weighted column showed blank on a subtotal row rather than an average of
averages (ADR-44). Pagination is not registered at all: `getRowModel()` resolves to the last
registered model, and a paged one would hand the Phase-1 virtualizer ten
rows; it returns as `manualPagination` in Phase 5. Every deferred hook is a
`TODO(grid-phase-N)` at the seam it plugs into.

**What now fails if this regresses.** `column meta drives the table` builds
a headless v9 instance and asserts every cell carries the meta its column
declared and formats through the registry to the same string; `says the
catalog's number` pins `ccy`, `mm` and `pct` to the widgets' `formatValue`;
the studio's `grid.spec.ts` reads the harness at `#/grid` and checks the
rendered units. The boundaries test fails on the grid importing a widget
component, the server, the studio, or fetching from anywhere but its data
seam.

## ADR-65 — the grid renders on shadcn/ui and Tailwind; Aperture Risk is still the only palette

**Pinned:** the treasury grid plan's stack — "TanStack Table v9 +
shadcn/ui" — declined by ADR-64 at Phase 0 and reinstated here at the
owner's direction. Supersedes ADR-64's third part and amends ADR-34's last
sentence; leaves ADR-48 whole.

**Decision.** The grid is built on shadcn/ui components over Tailwind v4,
on four terms.

*shadcn lands as source, not as a dependency.* Each component is copied
into `chartroom-grid/src/components/ui` by the CLI (`components.json` is
the package's), read, and kept — shadcn's own model, and the same
arrangement ADR-63 made for scales: the library's arithmetic, our marks.
This package is bundled by the studio's Vite and owns no `@/` alias, so a
landed component's imports are rewritten relative on arrival. One upstream
file carries one addition, `Table`'s `containerClassName`, because a sticky
header sticks to the nearest scrolling ancestor and shadcn's container is
that ancestor.

*Tailwind is the studio's build, and it does not touch the studio.* The
app's stylesheet imports Tailwind's `theme` and `utilities` layers and
declares the layer order; it does not import `preflight`. The studio's base
styles — Inter's feature settings, the focus ring, the header — are its own
and stay unlayered, and an unlayered rule beats any layered utility, so
nothing already on screen is rewritten. The grid's `theme.css` carries the
`@source` for the package's own files; the studio does not need to know
where the grid lives.

*The theme is a bridge, and the default palette is withdrawn.* `theme.css`
binds Tailwind's theme tokens in shadcn's vocabulary (`--color-background`,
`--color-muted-foreground`, `--color-border`, …) to `--cr-*` aliases, and
each of those is an Aperture token by reference (ADR-48). It declares
`--color-*: initial` first, so Tailwind's palette does not exist in this
build: a `text-red-500` compiles to nothing. ADR-48 made "no colour beside
the system" structural for the stylesheet by aliasing; this makes it
structural for utilities by subtraction. Beyond shadcn's vocabulary the
theme names only the readings this surface has and shadcn does not — the
subtle row rule, the faint label step, the breach text mix, up and warn.

It declares no bare variable. shadcn's own `:root` layer (`--accent`,
`--border`, `--radius`, …) is skipped, and not as a simplification: those
are Aperture's token names. The first build declared shadcn's `--accent`
— its grey hover highlight — at `:root`, and the studio's brand and links,
which alias Aperture's `--accent` yellow, turned grey. Tailwind's
`--color-*` namespace cannot collide with a design token; the bridge lives
there and nowhere else, and the test below holds it to that.

Where Tailwind's own theme layer and Aperture do share a name — the type
scale (`--text-xs` is 11px here, not Tailwind's 0.75rem), tracking,
leading, `--font-mono`, `--radius-*` — the system wins by construction:
Tailwind emits its defaults inside `@layer theme`, Aperture's tokens are
unlayered, and an unlayered declaration beats a layered one. A `text-xs`
utility on a grid cell is therefore Aperture's type step. Aperture declares
no `--spacing`, so Tailwind's spacing scale is the one the utilities use.

*Scope.* shadcn and Tailwind classes belong to the grid package and to
what frames it (the harness). The widget catalog and the rest of the
studio keep their stylesheets and their rule: no hardcoded colour, which
now also means no utility that names one (the test below reads both). The
Phase 3 surface — Popover, Command, ContextMenu, Sheet, DropdownMenu — is
the occasion this decision is for: those are the components a grid needs
twenty of, and where a hand-built library costs the most for the least.

**Why now, and why not before.** ADR-34's reasoning was that the
component contract is the transferable part and the CSS is not, which held
for a chat pane of six components written once. A grid's surface is a
different order — menus, popovers, command palettes, sheets, each with
focus management and keyboard behaviour that Radix gets right and a
hand-rolled version gets right on the third attempt. The cost of the
substrate is a second styling idiom in one app; the terms above keep it
inside one package and one route, and keep its palette the system's.

**What Phase 0 leaves honest.** The `@/` alias is not real: the CLI writes
it, the landing rewrites it, and a component that reaches the bundle
un-rewritten fails to resolve at build rather than at runtime. Dark is the
only theme, as it is everywhere in the studio; shadcn's `.dark` variant is
not declared and would be a no-op if it were.

**What now fails if this regresses.** `the theme is Aperture Risk by
reference` reads `theme.css` and rejects any hex, `rgb`, `hsl` or `oklch`
literal, any declaration outside the `--color-*` and `--radius-*`
namespaces or any `:root` block, and any theme that fails to withdraw the
default palette; it walks the package's sources for a Tailwind palette
class. The studio's
`grid.spec.ts` still reads the rendered units and the breach colour on a
negative MTM, now through shadcn's `data-slot` markup.

## ADR-66 — the view state is the contract, and the data seam is a query of it

**Pinned:** the grid plan's second and third principles — "view state is
the contract" and "no SQL crosses a trust boundary" — and its Phase 1. The
occasion is the first thing after Phase 0 that could have been done two
ways: a table whose state lives in the table, with a save button that
serializes it, or a JSON shape that *is* the state, which the table is
driven from.

**Decision.** The second, in three parts.

*One versioned, strict, zod-validated shape (`grid/viewState.ts`).* It
carries the table's slices — grouping, filters, global filter, sorting,
expansion, pagination, visibility, order, pinning, sizing — under a
`version` literal, and refuses at the boundary what a plain `TableState`
would render: an unknown key, a column that does not exist, a grouping on
a column whose meta is not `groupable`. That last one is the point. An
agent handed `set_view` (Phase 4) can ask for anything; asking to group by
trade id is answered with an issue naming the column, not with fifty
thousand groups. `pagination` is carried but not driven — the paginated
row model is unregistered (ADR-64) until Phase 5's server-side modes.

*The table is controlled from the view, slice by slice.* v9 has no global
state callback; one functional update on the view fans out to a change
handler per registered slice, so a feature API — `column.toggleSorting()`,
`column.pin()` — writes the view through the hook, and the view is never a
copy of the state that could drift from it. The hook stays the one
constructor of a table (ADR-64); a screen supplies rows and a view, or
neither and the grid keeps its own.

*A source answers a view; it does not receive SQL.* `DataSource` is two
methods: `describe()` — name, as-of, row count, the columns' meta, and
which stages it will serve — and `query(view, { groupPath? })`. The
in-memory source returns the whole book and says in `applied` that it
filtered, sorted and grouped nothing; the client row models do that work.
A DuckDB or Dremio source will compile the view and report what it
applied, and the table flips its `manual*` modes from that answer rather
than from configuration — the seam is built now so Phase 5 swaps an
implementation, not an architecture. `groupPath` is lazy expansion's hook,
and the in-memory source serves it so the remote one has a reference to be
tested against.

**Virtualization is renderer composition, not a feature.** TanStack
Virtual windows the *final* row model — never the raw data, which would
ignore the filter and the grouping — in the grid/flex geometry the
maintained example uses, with column widths from meta (`width`, one more
reading of the same declaration) and a fixed row height that is never
measured. A treasury grid is a lattice, not a feed; a measured row is a
scrollbar that jumps.

**What Phase 1 left honest.** The grid queried the source once per
source, since the in-memory source serves no stage of the view; Phase 5
keys the query on the slices a source reports it serves (ADR-70). The
Phase 1 e2e drove no interaction; the contract was exercised headlessly
and the screen at rest, and the later phases drive it.

**What now fails if this regresses.** `the view state contract` refuses
another version, an unknown key, an unknown column and an ungroupable
grouping, and round-trips a view through JSON; `a view drives a headless
table` builds a table from a view and asserts it sorts, groups (collapsed
until `expanded`), hides, orders and sizes as the view says; `the
in-memory source` describes the book from the meta, answers with
`applied` all false, serves a group path equal to brute force and refuses
one deeper than the grouping. The studio's `grid.spec.ts` reads a count
that only `describe()` could have supplied, a window of rows in the DOM
over a body fifty thousand rows tall, and the last trade after a scroll
with the header still in view.

## ADR-67 — a subtotal is decomposed, never averaged; grouping is a reading of meta

**Pinned:** the grid plan's Phase 2 — group rows with subtotals, a grand
total, a group-by drop zone and a columns sidebar, and "only `meta.groupable`
dimensions group" — with its instruction that the aggregation tests come
before the grouping UI.

**Decision.**

*`wavg` decomposes.* A weighted average carries Σ(x·w) and Σ(w) as its
result; a parent group merges its children's pairs and never re-reads a
leaf (`grid/aggregations.ts`, registered through v9's
`constructAggregationFn({ aggregate, merge })`). The alternative — a mean of
the sub-group means — is the number a spreadsheet gives when someone drags
a formula down, and it is wrong the moment two sub-groups differ in size,
which in a treasury book is always. The test asserts the decomposed number
equals brute force at every level of a three-deep grouping *and* that the
mean of means differs from it, so the guard cannot pass by accident. The
weight column is read from meta (`weightBy`); a row without a finite value
or weight contributes nothing, and a zero total weight renders the dash
(ADR-44). The result is a `Number` subclass so a sort compares by value and
the cell reads one number; the parts ride along for `merge`.

*A cell renders what it is.* On a group row the grouped column renders the
toggle, the value and the leaf count; an aggregated measure renders its
aggregate through the same `formatValue` as a leaf; a dimension the row
does not group by, or a grouped column on a leaf row, renders nothing. A
leaf value on a group row is a wrong number with a confident face (ADR-44),
and `data-cell` names each kind so a test can tell them apart. Grouped
columns move to the front (`groupedColumnMode: 'reorder'`): the tree reads
left to right and a chip's order is the column order.

*The grand total is `column.getAggregationValue()`.* v9 aggregates
independently of grouping over the pre-grouped (filtered, sorted) rows, so
the footer's number is the same function the subtotals use, over the rows
the filter left — the test holds the total to the sum of the top-level
subtotals and a filter's subtotals to brute force over the remaining rows.

*Every gesture is a feature API.* A header or a sidebar item dropped on the
zone is `column.toggleGrouping()`, refused unless `getCanGroup()` — the
zone's highlight is not a promise, the meta is the rule; a chip reordered
is `table.setGrouping()`; a sidebar item moved is `table.setColumnOrder()`;
a checkbox is `column.toggleVisibility()`. All of them write the view
through the hook (ADR-66), so a grouping made by drag is the same JSON a
saved view or an agent would hand over. Each drag has a click path — the
sidebar's group button, the chip's remove — so a keyboard reader can do
what a mouse can.

*The set filter and the number filter are v9's own.* A dimension filters
by `arrHas` (a scalar equal to one of the chosen values) and a measure by
`inNumberRange` (an inclusive range whose blank ends are open), both chosen
from the meta's `kind` and both proven in the Phase 2 tests before Phase 3
builds their UI.

**Why dnd-kit and not HTML5 drag.** The native API cannot render a drag
preview the design system controls, has no keyboard path, and fires
nothing usable in a virtualized body. dnd-kit's pointer sensor with an
activation distance leaves a header click free for Phase 3's sort.

**What now fails if this regresses.** `the weighted average` asserts
registration from meta, brute-force equality at every level with the mean
of means excluded, decomposition of parent parts into children's parts,
and the grand total; `subtotals and totals` asserts every subtotal is the
sum of its children and of its leaves, and the grand total the sum of the
top level; `filtering updates subtotals` asserts a set filter, a range
filter with an open end and a quick filter each change the subtotals to
the rows that remain. The studio's `grid.spec.ts` groups from the sidebar,
expands a group, stacks a second grouping, ungroups from the chips, and
drags a header onto the zone.

## ADR-68 — the AG Grid surface is a set of feature APIs with a face, and the export is the screen

**Pinned:** the grid plan's Phase 3 — set filter, number filters, pinning,
resizing, a header menu, conditional formatting, master-detail, a context
menu, row selection, a status bar, density, xlsx export and a quick
filter; deferred by the plan and left as marked seams: range selection,
undo/redo, charts and the pivot UI.

**Decision.**

*Every control is a feature API with a face.* A header click is
`column.toggleSorting()`; the header menu's items are `pin`, `toggleGrouping`,
`toggleVisibility`, `resetSize`; the filter popover writes
`column.setFilterValue()` in the two shapes Phase 2 proved — a set for a
dimension, an open-ended range for a measure; the quick filter is the
global filter, debounced; the context menu's "filter to this value" is the
set filter with one value; the resize handle is `header.getResizeHandler()`
wired to both mouse and touch, as the shipped skill insists. Each of them
therefore writes the view (ADR-66) and each appears only where the column
says it may (`getCanSort`, `getCanPin`, `getCanFilter`, `getCanHide`,
`getCanResize`), which the column def set from meta. The selection column
is the one exception: structural, not a field, composed in the hook and
never in the view — pinned at the start by the hook, stripped from any
pinning or order update before it reaches the view, so a saved view never
names a column it cannot validate.

*The renderer owns positioning.* v9 computes pinned regions and offsets and
nothing else; the cells take `position: sticky` with `getStart('start')` and
`getAfter('end')`, a solid background (`bg-inherit` from a row that is
never translucent), and a rule on the pinned edge. A selected row is the
accent mixed into the panel, solid, for the same reason: a pinned cell must
hide what scrolls beneath it.

*Conditional formatting reads meta and the facets.* A `heatmap` column
mixes the accent token by the value's place in `getFacetedMinMaxValues()`
— logarithmic when the range is positive, since notional spans three
orders of magnitude and a linear ramp lights only the top decile; a
`negativeRed` value takes the breach text token. No colour is named
(ADR-48). Selection and detail state are transient and stay in the shell.

*Master-detail is a row, not a measurement.* The body is windowed and never
measures, so a detail panel is a second virtual item of declared height
under its leaf row, a `<tr>` with one full-width cell, and the virtualizer
is told when the declaration changes. Row density is the same mechanism:
two declared heights.

*The export is the screen, with the meta's number formats.* The workbook
carries the visible columns in order, the current row model — a collapsed
group as its subtotal row, indented by depth — and the grand total. Every
number stays raw; the format is derived from the same meta the cell used
(ADR-29): `mm` scales by a million in the format (`,,`) so a SUM in the
sheet still adds dollars, and `pct` takes a literal "%" suffix because the
value is already in percent units — Excel's `%` type would multiply by a
hundred. exceljs loads lazily, on the first export. The export module is
typed structurally against what it reads, because v9's `Table` is
invariant in its registry and the React table and the headless test table
are two registries.

*The status bar aggregates the selection by the meta's own aggregation.* A
selection's notional is a sum and its yield a weighted average — the same
`wavg` (ADR-67), over the selected leaf rows through
`column.getAggregationValue({ rows })` — so the number in the bar is the
number the footer would show for those rows alone.

**Deferred, with the seam named.** Range selection would be v9's
`cellSelectionFeature` in the registry and a drag on the body cell; undo
and redo a history of view states in the shell, which the contract makes
trivial and the plan defers; charts the selected rows handed to a widget
contract; the pivot UI `columnGroupingFeature`'s pivot mode. Each is a
`TODO(grid-deferred)` where it would plug in, and none is started.

**What now fails if this regresses.** `Excel formats from meta` pins each
unit's format; `the workbook` reads a sheet back and asserts the visible
headers, raw values with their formats, the total row, and a collapsed
grouping exported as bold, indented subtotal rows with blank dimensions;
`the heat ramp` asserts the logarithmic ramp, the clamps and that only the
accent token is mixed. The studio's `grid.spec.ts` sorts from the header,
filters by set and by range and by the quick filter, pins with sticky
positioning, hides from the menu and restores from the sidebar with the
body following the header, resizes by drag with the cells following,
selects into the status bar, opens and closes a detail panel, switches
density, filters from the context menu, and downloads the export.

## ADR-69 — the view is the agent's contract too: saved, linked, and served over MCP

**Pinned:** the grid plan's Phase 4 — saved views, URL state, the
`describe_view` / `query_view` / `set_view` tools, and an MCP server — and
its second principle, that the view state is the contract every consumer
speaks (ADR-66). This ADR is that principle's third and fourth consumers.

**Decision.**

*The React-free core is one import graph, and the agent lives in it.* The
registry, the columns, the view state and the aggregations import
`@tanstack/table-core`, not the React adapter; only the hook touches
`@tanstack/react-table`. `agent/headless.ts` constructs a table without a
screen from the same three, so an agent tool, a test or a server answers a
view with the row models, the aggregations and the formatter the screen
uses — the same `wavg`, the same dash for a missing value. `src/agent`
may not fetch (the boundaries test), and a stdio server must import
`node:` (which `src` may not), so the MCP entry sits at the package root
and the server builder in `src/agent` takes a source through the seam.

*Three tools, and the third refuses.* `describe_view` returns the source's
description, the current view and a *contract*: every column with its
meta, which are groupable, which filter shape each takes, and every slice
of the view in a sentence an agent reads before it patches. `set_view`
merges a patch slice for slice — or replaces the view when asked — and
validates the result against the same zod schema the URL and the store
validate against; an unknown column, an ungroupable grouping or an unknown
slice comes back as issues naming what was wrong, never as a view that is
almost right (ADR-44). `query_view` answers the view as the screen shows
it — group rows with subtotals and leaf counts, leaf rows with values,
grand totals, optionally each value formatted — a window at a time, with
`total` the filtered leaf count and `applied` what the source itself did.
The MCP server holds one view per process, the agent's session; a person
can be handed it as a link.

*A saved view is a validated document.* `views/store.ts` is an interface
with two implementations — memory, and any `getItem`/`setItem` storage,
the browser's included. Every read re-validates; a view saved by an older
build that no longer parses is dropped and counted, not rendered half
right. The interface is the seam for the governed API to hold views
tomorrow — a saved view is something a steward could review, which is why
it is the validated JSON and nothing else.

*The URL carries the view, and a clean link stays clean.* `#/grid?v=…` is
the validated JSON, base64url; the default view writes no parameter. The
studio route reads the parameter on load and refuses one that does not
parse — with the issues shown, not a blank grid — and writes the view
back with `replaceState` on every change, so a link is the state and a
reload is a no-op.

**Why not JSON Schema from the zod.** The classic zod API this package
uses has no schema emitter, and a raw schema would still not say that a
`pct` value is already in percent units or that `wavg` is never a mean of
means. The contract is the sentences an agent needs, generated from the
same meta the columns are — one source, read a fourth way.

**What now fails if this regresses.** `describe_view` asserts the contract
lists every column with its filter shape and the notes; `set_view` asserts
slice-wise merging, replacement, and refusals of an unknown column, an
ungroupable grouping, an unknown slice and a non-object; `query_view`
asserts a sorted window with formatted values and totals, a grouped answer
whose subtotals equal brute force with dimensions blank, expansion on
request, and the filtered total; `the MCP server` lists the three tools,
refuses a bad patch with `isError`, keeps one session view and answers a
supplied view without changing it. `the view store` saves, replaces,
removes and drops what no longer parses; `the view in a URL` round-trips,
writes nothing for the default and refuses what does not parse. The
studio's `grid.spec.ts` loads a grouped view from a link, watches the
hash follow a change, reloads into the same view, saves a view and loads
it back, and shows the refusal for a link that does not parse.

## ADR-70 — the view compiles to SQL behind the seam, and the table does not redo what the engine did

**Pinned:** the grid plan's Phase 5 — `compileSql`, lazy group expansion,
`manual*` modes, DuckDB-WASM and Dremio — and its third principle, that no
SQL crosses a trust boundary. The seam was built in Phase 1 (ADR-66) so
this phase would swap an implementation, not an architecture; it did.

**Decision.**

*The view compiles; identifiers come from meta and values never enter the
text.* `data/compileSql.ts` is pure: a view, a table and a dialect in, a
statement and its parameters out. A column id the meta does not know
throws before a byte of SQL exists; a table name is validated as an
identifier path; a value is a positional parameter, or — for Dremio's REST
API, which takes none — an escaped literal from one function, and the
Dremio executor refuses a statement that arrives with parameters, so the
one injection path this package could have is closed at compile time. The
quick filter binds once per column it is matched against, because a
positional placeholder binds once and a needle reused across fifteen
columns leaves fourteen of them null — the test that caught it stays.

*Two shapes, one WHERE.* A leaf statement selects positions, filtered,
sorted, windowed. A group statement, asked when the view groups deeper
than the `groupPath` given, aggregates the next level: the dimension, a
count, each measure by its meta's `agg` — `wavg` as SUM(x·w) / SUM(w),
the client's decomposition (ADR-67) in the engine's words, with the parts
alongside. Both take the view's set and range filters, the quick filter
and the path's dimensions. The tests run the compiled statements through
Node's own SQLite and hold the answers equal to the in-memory path:
filtered and sorted leaves in the same order, subtotals at every level
equal to brute force and to the client's aggregation.

*A group the source made is a row the columns can read.* `sqlSource`
returns Position-shaped nodes — the grouped dimension filled, the others
blank, every measure holding its aggregate — with `__group` carrying the
level, the value, the count and the path a child query needs. The shell
attaches fetched children as sub-rows, the hook's `getSubRows` reads them,
and a node can expand before its children arrive; the same cell renderer
draws a source group and a client group alike, and the footer's
`getAggregationValue()` over group nodes still gives the right weighted
average, since Σ(avg·W)/ΣW over groups is Σ(x·w)/Σw over leaves. Row ids
for source groups (`g:Credit/EUR`) differ from the client's, so a saved
`expanded` slice does not transfer between sources — recorded, not hidden.

*`manual*` follows `applied`, not configuration.* The source's answer says
what it applied; the hook sets `manualFiltering`, `manualSorting` and
`manualGrouping` from that, so the client row models pass through what
the engine already did rather than doing it twice, and the shell
re-queries only when a slice the source *serves* changes — debounced,
since a resize handle moves the view many times a second. The in-memory
source serves nothing and the grid behaves as it did.

*Two engines, one executor interface.* DuckDB-WASM in the browser: the
book loaded into a table in a worker, the module and worker shipped as
assets and loaded only when a reader picks that source; parameters bound
through prepared statements; Arrow's BigInt counts read back as numbers.
Dremio over its REST SQL API: submit, poll the job, page the results, the
transport injected so a test can be it. Arrow Flight is the faster wire
and a gRPC client, which a browser cannot be — the Flight path is a
server-side executor (the API's Python agent already speaks it) behind the
same `SqlExecutor`, and is not in this package.

**What stays honest.** Pagination is still carried and not driven: a leaf
answer from the engine is every matching row, which is the right answer
for a fifty-thousand-row book and the wrong one for fifty million, where
`limit`/`offset` in `compileSql` — already there — meet `manualPagination`
next. The DuckDB path loads the book from JSON on first use, seconds of
work the studio harness shows as a loading title; a real deployment
registers a Parquet file or a remote table instead.

**What now fails if this regresses.** `compileSql` pins the leaf statement
and its parameters, the group statement with `wavg` decomposed and the
path scoping, the refusals, and the dialect difference; `the SQL source
answers as the in-memory path does` runs through SQLite and holds leaves
and subtotals equal; `the Dremio executor` submits with the token, polls,
pages, refuses parameters and names a failed job, and as a source sends
the compiled dialect with literals inlined. The studio's `grid.spec.ts`
loads the DuckDB source, sees the status bar say what it serves, sorts and
filters through the engine, groups a level at a time and expands to
children and then to leaves still filtered.

## ADR-71 — a block of cells is a thing to copy, not a view

**Pinned:** the owner's request after Phase 5 for Excel-like range
selection and copy, which the grid plan had deferred; un-deferred here.

**Decision.** v9's `cellSelectionFeature` joins the registry. A drag or a
Shift-click selects a rectangle, Ctrl or Cmd adds or subtracts one, the
arrow keys move the active cell and Shift-arrows extend it, Escape clears.
The selection column takes no part. The selection is transient — a
reader's hand on the book, like row selection (ADR-68) — and never enters
the view, a saved view or a link.

*Copy is the screen's text.* Ctrl+C, and the context menu's "Copy range",
write the block as tab-separated text: the formatted number the reader
sees by default, the raw value on request, an optional first row of column
labels, one blank line between disjoint rectangles. A group cell copies
its value, an aggregate its number, a placeholder nothing — the same
reading as the cell (ADR-67). The copier resolves cells from the
selection's *bounds* over each row's visible cells, in the render order
the feature resolves its rectangles in — pinned start, centre, pinned end
— because `getSelectedCellRangesData()` yields values, and a value cannot
say what it is.

*Paste has nowhere to land.* The grid is read-only over a source; a paste
into cells would be an edit and a write path to the source, a decision of
its own. Copying out to a spreadsheet is what "copy/paste" means here
until that decision is made.

*Ranges are corners, not cells.* v9 anchors a range to its corner ids, so
a sort or a filter keeps the corners and recomputes what sits between
them; a reorder or a pin resets the selection in the shell, as the
shipped skill advises, rather than letting a rectangle scatter.

**What now fails if this regresses.** `range copy` selects a block on a
headless table and asserts the tab-separated text, formatted and raw, the
label row, a group row's cells as the screen shows them, and two disjoint
ranges separated by a blank line. The studio's `grid.spec.ts` drags a
block, reads the outline and the count, copies with Ctrl+C and reads the
clipboard back.

## ADR-72 — a measure's aggregation is the view's to choose, within what the column can bear

**Pinned:** the owner's request after Phase 5 to "expose agg functions";
ADR-67 fixed one aggregation per measure in column `meta`, and this entry
opens that to the reader without giving up what ADR-67 protected.

**Decision.** The view gains a `columnAggs` slice (view version 2; a
version-1 view migrates with an empty slice): a map from a measure's id
to one of `sum`, `wavg`, `mean`, `median`, `min`, `max`, `count`,
`uniqueCount`. The column's `meta.agg` stays the default; the view's
entry, when present, is what the column aggregates by, everywhere at
once — a group's subtotal, the grand total, the status bar, the xlsx
export, the agent's `describe_view`, and the SQL the seam compiles.
Columns are rebuilt from the view, so there is one place that decides
(`effectiveAgg`) and no reader keeps its own opinion.

*The column says what it can bear.* `allowedAggs` lists a measure's
choices: every aggregation for a plain measure, and `wavg` only where
`meta.weightBy` names a weight — a weighted average without a weight is
not a number, so the menu never offers it and the parser refuses it. A
dimension has no aggregation and no menu. A view carrying a choice a
column cannot take does not parse, the same as a sort on an unknown
column (ADR-66): a link or an agent cannot make the grid show a figure it
cannot stand behind.

*The engine gets the same word.* `compileSql` turns the choice into the
dialect's function — `AVG`, `COUNT(DISTINCT …)`, `MEDIAN` where the
dialect has one — and decomposes `wavg` as before (ADR-70). A dialect
without a median (SQLite) throws at compile time with the column named,
rather than serving a mean and calling it a median.

*The default is a menu item, not a mystery.* The header menu's "Aggregate
as" marks the column's default, shows the current choice in its trigger,
and offers "Restore default" only while a choice is in force. Restoring
deletes the entry rather than writing the default back, so a view carries
only what the reader changed.

**What now fails if this regresses.** `viewState.test.ts` migrates a
version-1 view and refuses a dimension, an unknown aggregation and an
unweighted `wavg`; `aggregation.test.ts` re-aggregates a group and the
grand total under a chosen mean and median; `sql.test.ts` compiles each
choice per dialect and runs a mean per desk through SQLite; `agent.test.ts`
reads the choices back from the contract. The studio's `grid.spec.ts`
chooses a mean for Yield from the header menu and reads the footer, a
group row and the link.

## ADR-73 — the quick filter is a grammar, and every filter reads back as a chip

**Pinned:** the owner's request after Phase 5 for a top-level search
filter, richer set filters and a place to see what is applied.

**Decision.** The view's `globalFilter` stays one string — no new slice,
no version bump, every saved view and link still parses — but the string
now reads as space-separated tokens, all of which must hold. A bare word
matches any column, as before. `desk:Credit` is a dimension containing
the text, `desk=Credit` equal to it, `desk!=Credit` anything else;
`notional>1bn`, `yield<=3.5`, `mtm!=0` compare a measure to a number,
with `k`, `m` and `bn` suffixes and a tolerated `%`; a column is named by
its id or its label (`ccy`, `entity`); quotes keep spaces together. One
parser (`parseSearch`) serves the client filter, the compiled SQL and the
filter bar, so the three cannot disagree on what a token means; the
SQL test proves the engine keeps the same rows as the client for each
kind of token.

*A word the grid does not know is a word.* `cpty:foo` names no column,
so it stays free text and finds nothing rather than pretending to be a
term. A known measure given something that is not a number, or a
dimension given a comparison, is *unknown*: it keeps no row, the chip
shows it struck through with the reason, and the SQL carries `1 = 0` —
"notional > abc" has no honest answer, and an answer of "every row" would
be the dishonest one.

*The global filter answers for the row.* v9 asks the global filter once
per globally filterable column and stops at the first yes, so a
row-level grammar answers on the first ask and memoises the verdict for
the other columns of that pass; the parse happens once per filter value,
in `resolveFilterValue`, not per row.

*The filter bar is a reading, not a state.* Under the toolbar, one chip
per column filter — the set's values, the range's ends — and one per
token, each removable on its own; removing a token rewrites the string
without it, keeping the rest as typed. Nothing in the bar is stored:
it is the view, read back. "Clear all" lives there, next to what it
clears.

*The set filter's empty list means none.* Excel's All / None / Invert,
and a value's Only / Exclude, all write the same `arrHas` list. v9's
built-in would drop an empty list as "no filter"; the registry's
`arrHas` keeps it, so "none of these" keeps no row on the client and
compiles to `1 = 0` for the engine, and a full list still collapses to
no filter so the view stays clean. Exclude is an include list without the
value, as Excel's is: the list is what the reader saw when they chose.

**What now fails if this regresses.** `search.test.ts` parses each token
kind, quotes, suffixes and the unknown cases, filters a headless book by
a mixed query against a hand-written predicate, and keeps no row for an
empty set; `sql.test.ts` compiles each token kind and runs four token
queries through SQLite against the same predicate. The studio's
`grid.spec.ts` types three tokens, reads three chips, removes one from
the bar, sees an unknown term keep nothing, and works None, Invert,
Exclude and Only on the product set.

## ADR-74 — a reader formats the reading, never the unit

**Pinned:** the owner's request after Phase 5 to "expose better column
formatting options", taken under NUM-01 ("never let format overrides
touch units") because the owner did not say otherwise when asked.

**Decision.** The view gains a `columnFormats` slice (view version 3; a
version-2 view migrates, a version-1 view migrates twice): per measure,
the decimals, the scale a dollar amount is read at (`units`, `k`, `m`,
`bn`), how a negative is written (`minus` or accounting `parens`), and the
two colourings the meta already knew (`negativeRed`, `heatmap`). The
column carries the result: `buildColumns` lays the view's format over the
declared meta (`effectiveMeta`), so a cell, a subtotal, the grand total,
the status bar, a copied block and the xlsx column all read the same
object and none asks who chose what.

*What a column can take is the column's to say.* `allowedFormatKeys`
lists a measure's keys, and `scale` only for a dollar unit; a dimension
has none. A percent reads to more or fewer decimals but never in basis
points, dollars never become a percent, and a view that says otherwise
does not parse — the same refusal as an aggregation a column cannot bear
(ADR-72). The header menu offers exactly these keys, marks the current
reading, says "Format · custom" while a choice is in force, and "Restore
default" drops the entry rather than writing the default back.

*The catalog's reading stays the catalog's.* Where the chosen reading is
one the widget catalog already renders (`currency_usd`, `currency_usd_mm`,
`percent_Ndp`), `formatValue` still delegates to it (ADR-29); a reader's
scale or decimals produce the same shape, scaled. Accounting negatives
wrap the whole reading with the sign removed, so `($1.2M)` and `(3.46%)`
read the way a ledger does.

*Excel scales in the format, not the cell.* The export keeps the raw
number and expresses the scale as commas in the number format — one per
thousand — so a SUM in the sheet still adds dollars whatever the column
reads in; parentheses and `[Red]` are the format's too.

**What now fails if this regresses.** `format.test.ts` reads dollars at
each scale and decimals, negatives in parentheses in every unit, a percent
that stays a percent, and a grouped headless table whose cell, subtotal,
grand total and copy all carry the chosen format; `viewState.test.ts`
migrates versions 1 and 2 and refuses a unit change, a dimension, a scale
on a percent and seven decimals; `export.test.ts` reads the scaled and
parenthesised Excel formats. The studio's `grid.spec.ts` reads Notional in
billions to two decimals from the header menu, sees the footer and the
link follow, puts a negative MTM in parentheses and restores it.

## ADR-75 — a header band is a reading of the columns, not a node in the tree

**Pinned:** the owner's request after Phase 6 for AG Grid's column header
groups.

**Decision.** Every column's meta names the family it belongs to (`band`:
Book, Instrument, Trade, Exposure, Risk, Return), and the table draws a
row above the headers with one cell per contiguous run of visible columns
that share a family, sized to their summed widths and pinned the way they
are. Nothing else changes: the leaf columns keep their ids, their order,
their pinning and their drag handles, the view carries no band state, and
an agent's `describe_view` says nothing new.

*Why not v9's column groups.* A group column would make the band a parent
in the column tree, which is what `columnOrder`, `columnPinning` and the
drag-and-drop all operate on. A reader who drags DV01 next to Desk, or
pins it, would then be moving a column out of its parent, and every one
of those features would need a rule for what that means. Read as a run
of leaves instead, the band simply follows: hide a column and the band
narrows, drag one away and the band splits, pin one and the pinned half
sticks while the rest scrolls, because a sticky cell cannot span into the
scrolling middle and the run ends at the pinning boundary.

*The display order follows the families.* `book` moved from after
`counterparty` to after `legalEntity`, so the Book family is contiguous
by default; the SQL projection, the copied header row and the range test
moved with it.

**What now fails if this regresses.** `bands.test.ts` runs contiguous
columns together, splits at a pinning boundary, never merges bandless
columns, and asserts every declared column names a family. The studio's
`grid.spec.ts` reads the six bands in order, measures the Risk band
against DV01 and CS01, hides CS01 and sees the band narrow, pins Desk and
sees Book split with the pinned half sticky.

## ADR-76 — undo is a stack of views, not a set of inverse operations

**Pinned:** the owner's request after Phase 6 for Excel's Ctrl+Z over the
grid.

**Decision.** The grid shell keeps a history of the views it has rendered:
every view that arrives — from a header click, a drop on the group zone, a
filter chip, a format choice, a saved view loaded, a link followed, an
agent's `set_view` — is one step, and undo hands the previous view back
through the same `onViewChange` every other write uses. Nothing in the
grid knows how to invert a sort or a filter, because it does not need to:
the view is one JSON object (ADR-66) and a step is a whole one. The stack
is transient, like row selection (ADR-68); it is not in the view, a saved
view or a link.

*Two readings keep the stack honest.* A change that leaves the view equal
is not a step, so a click that writes the same JSON costs nothing to
undo. A column resize writes one view per pointer move, so a sizing-only
change within six hundred milliseconds of the last one replaces the
present rather than pushing it: Ctrl+Z undoes the drag, not one pixel.
The depth is bounded at a hundred steps.

*The keyboard is Excel's.* Ctrl+Z (Cmd on a Mac) undoes and Ctrl+Shift+Z
or Ctrl+Y redoes anywhere in the shell except a text field, where the
browser's own undo of typing must keep working. The toolbar carries the
two arrows with their enabled state, so the affordance is visible.

**What now fails if this regresses.** `history.test.ts` pushes, undoes
and redoes through the same views, drops the redo branch on a new push,
ignores an equal view, coalesces a resize run and splits it at a pause or
another change, and bounds the depth. The studio's `grid.spec.ts` groups,
sorts, undoes both with Ctrl+Z, redoes from the toolbar, sees a new
search drop the redo branch, and undoes the search.

## ADR-77 — a pinned row is one of the rows on screen, held still

**Pinned:** the owner's request after Phase 6 for AG Grid's row pinning.

**Decision.** v9's `rowPinningFeature` joins the registry. A leaf row's
context menu pins it to the top or unpins it; the pinned rows render in
the sticky header block, under the column headers, in the order they were
pinned, and leave the virtualized body, which scrolls the centre rows
only. Like row selection and cell ranges (ADR-68, ADR-71) the pins are a
reader's hand on the book, transient, never in the view, a saved view or
a link.

*A pinned row is one of the rows on screen.* `keepPinnedRows` is off:
filter the row out, or collapse the group it sits in, and it leaves the
top as it leaves the body, and comes back when the view shows it again.
The alternative, holding a row the view says is not there, would put a
number on screen the filter bar cannot explain. A group row cannot be
pinned; its subtotal is the group's, and a subtotal held away from its
children would be a figure with no reading.

*The row is the same row.* The pinned block renders through the same
`BodyRow` the body does, so a pinned row's cells format, heat, select and
open their detail exactly as they did a moment earlier in the body, and
its context menu offers to unpin it.

**What now fails if this regresses.** `rowPinning.test.ts` moves rows from
the centre to the top and back in pin order, refuses a group row, and
sees a leaf under a collapsed group stay off the top. The studio's
`grid.spec.ts` pins the first row from the context menu, scrolls the body
far and finds the row still in view, filters it out and back, and unpins
it from its own menu.

## ADR-78 — a highlight rule earns emphasis, never a verdict

**Pinned:** the owner's request after Phase 6 for AG Grid's conditional
formatting; COL-03, which reserves semantic colour for a governed
threshold.

**Decision.** A measure's format (ADR-74) may carry up to four highlight
rules: a comparison, a number, and the emphasis a matching cell earns —
*highlight* (the selection tint), *bold*, or *fade*. The first matching
rule wins. Rules live in `columnFormats`, so the link, a saved view and
an agent's `set_view` carry them, the parser refuses them on a dimension,
and the column's meta delivers them to every reader: the cell, the
subtotal, the grand total, and the xlsx as conditional formats with the
same emphasis.

*Why emphasis only.* Red, amber and green on this platform say breach,
warning and within limit, and each of those is a governed threshold with
a citation and a review (COL-03, ADR-48). A reader's "show me the ones
over three billion" is a question about size, not a judgement about
safety; dressing it in the breach colour would let a scratch rule
impersonate a limit. So the editor offers no colour, and the export
writes bold, a grey font or a tinted fill, never a red or a green.

*Why four.* A fifth rule is a banding scheme, and a banding scheme with a
meaning is a threshold table; that belongs in the registry where it can
be cited and reviewed, and the editor says so when the fourth is in.

*Numbers read as the search does.* The threshold field takes `3bn`,
`-2.5m`, `250k` through the same grammar the quick filter uses (ADR-73),
so a reader learns one way to write a number.

**What now fails if this regresses.** `format.test.ts` matches first-wins
over the six comparisons and ignores non-numbers; `viewState.test.ts`
refuses a fifth rule, a colour that is not an emphasis, an unknown
comparison and a rule on a dimension; `export.test.ts` reads one cellIs
rule per highlight rule over the data rows and finds no red or green in
their styles. The studio's `grid.spec.ts` adds a rule from the header
menu, sees the large notionals emphasised and the small ones not, reads
the rule in the link, and removes it.

## ADR-79 — a calculated column is a closed operation over governed measures, and a draft

**Pinned:** the owner's question after Phase 6, "can we add custom
calculation fields?"; NUM-01 (units belong to the function), GOV-02 (no
ungoverned metric beyond draft), ADR-67 (never a mean of means).

**Decision.** The view gains a `computedColumns` slice (view version 4;
older views migrate): each entry an id under the `c:` prefix, a label, an
operation from a closed vocabulary — `ratio`, `delta`, `sum`,
`pct_change`, `scaled` — and its operands, which are registry measures.
The grid builds a real column for each: an accessor that evaluates the
operation on the row, a meta derived from the operands', an aggregation
that applies the operation to the operands' aggregates, a range filter, a
numeric sort, and a place in every other slice — order, visibility,
pinning, sizing, formats — under the same validation, so a link cannot
name a calculated column the view does not define.

*Why not a formula.* A formula string can say `mtm + yield`, and the grid
would have to either print a number that means nothing or parse the
string to find out. The vocabulary makes the unit a property of the
operation, as NUM-01 wants it to be: a difference or a sum of two columns
in one unit keeps that unit (dollars in either reading count as one), a
ratio or a change of two columns in one unit reads as a percent of the
second, a scaling keeps the first's, and two units that differ are
refused before the column exists — in the editor, which says why, and in
the parser, which says the same.

*A ratio of sums, never a sum of ratios.* A group's value is the
operation applied to the operands' aggregates over the group's rows, each
operand by its own rule, so a weighted average stays weighted inside a
delta and a share at desk level is the desk's MTM over the desk's
notional. The client aggregation asks the operand columns for their
aggregate over the same rows; the SQL compiler composes the operands'
aggregate expressions the same way for an engine-served sort, and the
leaf expression for an engine-served filter. The grouped SELECT needs no
new column: a group node carries the operands' aggregates, and the
accessor derives the calculated value from them on the client, which is
the same arithmetic.

*A draft, marked as one.* A calculated column is a reader's scratch
figure. The header carries a *calc* badge and the Calculated band, the
xlsx header says *(calculated)*, and the agent contract lists the slice
as the view's, not a metric: it has no citation and no review, and
promoting it means writing it into the registry through the existing
path. Eight is the most a view carries; a ninth is a model. An operand is
always a registry measure, never another calculated column, so a chain
cannot launder a draft into an input. The quick filter's grammar does not
name calculated columns yet — TODO(grid-computed-search).

**What now fails if this regresses.** `computed.test.ts` derives the unit
for each operation and refuses a mixed one, evaluates each operation and
its no-answer cases, builds a table whose calculated cells equal the
arithmetic on the row, whose subtotals equal the operation on the
operands' subtotals against brute force, and whose grand total does the
same; `viewState.test.ts` migrates version 3, refuses a bad id, a
registry id, a computed operand, a ninth column, a unit mismatch, a
grouping on a calculated column and an aggregation choice for one, and a
sort naming a calculated column the view does not define; `sql.test.ts`
sorts and filters by a calculated column through SQLite and matches the
client. The studio's `grid.spec.ts` adds an MTM-share column from the
sidebar, reads its cells and its badge, groups by desk and checks the
subtotal against the operands' subtotals, sees the link carry it, and
removes it.

## ADR-80 — a pivot is one dimension across the top, and every column it makes is a real column

**Pinned:** the owner's request after Phase 6 for AG Grid's pivot mode.

**Decision.** The view gains a `pivot` slice (view version 5; older views
migrate): the groupable dimension across the top, or null, and the
measures it spreads (empty meaning every measure). For each of the
dimension's values and each spread measure the grid builds a column
`p:<measure>:<value>`: an accessor that reads the measure only for rows
in that value's bucket, a meta that is the measure's with the value as
its band — so the header bands (ADR-75) draw the value row with no new
header machinery — and an aggregation that is the measure's own rule
over the bucket's rows, so a weighted average stays weighted and a count
counts the bucket. The spread measures keep their own column after the
buckets under a Total band, and the dimensions keep their place, so the
row side reads as it did.

*The columns are the source's values, not the filter's.* The values
across the top are the dimension's distinct values over the whole source
— `distinct()` on the seam, served by SQL for an engine and by a pass
over the rows in memory — so a filter narrows the cells and never makes
a column vanish under the reader's eye. A pivot id is accepted by shape
in order, visibility, sizing and pinning, because the values are the
data's and a link cannot know them; a stale one is simply absent.

*What a pivot column is not.* It is not filtered (filter the measure or
the dimension), not grouped, not given its own aggregation (it aggregates
as its measure does) and not given its own format (format the measure,
and every bucket follows): each refused by the parser with those words.

*The engine serves the buckets.* At a grouping level the SQL compiler
emits `CASE WHEN dim = value THEN measure END` inside each aggregate, one
per value per spread measure, with a weighted average's parts alongside;
the node carries them under the pivot ids and the client accessor reads
them back, so a served subtotal and a client subtotal are the same
number, which the SQLite test holds them to. A leaf query needs nothing
new: the accessor buckets on the client, and an engine-served sort by a
bucket sorts by the measure within it, rows outside it last.

**What now fails if this regresses.** `pivot.test.ts` names and parses
ids, reads distinct values in order, buckets a row, builds the columns in
the right order with the right bands, and holds subtotals and the grand
total — a sum, a weighted average, a count — to brute force per bucket;
`viewState.test.ts` migrates version 4 and refuses a pivot on an
ungroupable column, a dimension among the values, and a filter,
aggregation or format on a pivot column; `sql.test.ts` reads the
dimension's values from the engine, compiles the bucketed aggregates and
their sort, and matches the served subtotals to the client's. The
studio's `grid.spec.ts` pivots by currency from the header menu, reads
the bands and the EUR bucket's columns, sees a leaf's notional only under
its own currency, groups by desk and checks the bucket against the
total, reads the link, and stops from the chip.

## ADR-81 — a chart from a range is a widget the grid describes and the host draws

**Pinned:** the owner's request after Phase 6 for AG Grid's integrated
charts; the boundary rule (`spec ← grid ← studio`, the grid never imports
the widgets' React components).

**Decision.** The context menu's "Chart selection" turns the selected
block into a chart request: the grid reads the range's cells through the
same resolver the copier uses (ADR-71), takes the first dimension column
in the block as the category and each measure column as a series, keeps
the rows in the order the screen shows them, and hands the host a
`ChartRequest` — the widget type (`bar@1`), the resolved `WidgetData`
the widgets' contract expects (rows keyed by the category, the unit and
the format the measure's meta maps to), and a title naming the columns.
The grid draws nothing: the shell's `onChart` prop is the seam, and the
studio, which may import the widgets, renders the request with the
governed `Bar` renderer in a panel beside the grid. Without a host handler
the menu item is absent.

*Why the host draws.* The widgets are governed renderers: they format
through the catalog's function (ADR-29), take colour from the theme, and
refuse to fetch. A chart the grid drew itself would be a second renderer
with its own formatting and its own colours, and the boundary test exists
to stop exactly that. Handing over data in the widgets' own shape keeps
one renderer for a number wherever it appears.

*What a range can chart.* A block holds one category — the first
dimension column in it, or the group column on grouped rows — and one or
more measures in one unit; a block with two units, or with no dimension
and no group rows, is refused with the reason in the panel rather than
charted wrong (NUM-01: a bar chart has one axis). A grouped row's
subtotal charts as the group's value; a placeholder cell charts as
nothing. A calculated column (ADR-79) charts as the draft it is, with its
label suffixed.

**What now fails if this regresses.** `chart.test.ts` builds a request
from a headless range: the category from the first dimension, one series
per measure, rows in screen order, the unit and format from meta, group
rows by their subtotal; and refuses two units and a block without a
category. The studio's `grid.spec.ts` drags a block of desk and notional,
opens the context menu, charts it, and reads the bars' labels and values
against the cells.

## ADR-82 — the grid reads its columns from the source, and the treasury book is one source

**Pinned:** the owner's "what's next": the grid as the standard component in
the dashboard builder, whose data is a registry metric's groups, not a
book of positions.

**Decision.** A `GridSchema` — column meta by id, the display order, and
the column that identifies a row — replaces the fixed treasury columns
everywhere the grid used to read them: the column builder, the view
contract's parser, the search grammar, the SQL compiler, the sources, the
headless table and the agent tools. The treasury book becomes one schema
among many (`TREASURY_SCHEMA`), and the default wherever a schema is not
given, so nothing that spoke to the grid before has to change and every
test that proved a behaviour on the book still proves it. A source's
`describe()` now names its `rowId` beside its columns, and the shell
builds its schema from the description: the grid shows whatever the
source says it serves.

*One parse per schema.* The view contract is a zod schema built from a
grid schema — column ids checked against it, groupability and measure
kind read from it — and cached per schema object, so a link is still
refused at the boundary with the column named, whichever source it is
for. A component that needs a column's declared meta, not the view's
reading of it, asks a schema context the shell provides.

*The search grammar reads the table.* The quick filter used to resolve
`ccy:` against the treasury labels; it now resolves against the table's
own columns, calculated and pivot columns included — which closes the
TODO in ADR-79 as a side effect — and against an explicit schema for the
SQL compiler and the agent, so the three still agree.

*A row is a record.* `Position` is a type alias with the book's fields,
assignable to the grid's `GridRecord`; a source of any other shape hands
the grid records and a schema, and the row id is whatever the schema
names.

**What now fails if this regresses.** `schema.test.ts` drives the grid
with a second schema — a registry metric's groups by entity and tenor —
and shows views parsing against it and refusing the treasury columns,
tables identified by its row id with subtotals and totals, the search
grammar naming its columns by label on the client and in SQL, and the
agent contract and tools speaking it. Every earlier test runs unchanged
against the treasury default.

## ADR-83 — the grid is a dashboard widget the host draws, and its view is the widget's state

**Pinned:** the owner's original ask — the standard grid component in the
dashboard builder — and the boundary rule that the widgets package never
imports the grid.

**Decision.** `grid@1` joins the widget catalog as a contract of family
`grid` with `renderer: 'host'`: the catalog carries it, the linter reads
it (GRID-01 demands its cell ceiling, AGG-01 keeps a ratio off it, NUM-01
its units), a proposal can cite it, and the studio — not the widgets
package — draws it, because the renderer lives in `chartroom-grid` and
`spec ← widgets` must not grow an arrow to the grid. The widget's binding
resolves to the same group query every other widget runs; the answer's
rows become grid records and its dims and format become a grid schema
(ADR-82) — one groupable dimension per bound dim, the value, the prior and
the move as measures in the unit the contract's format names, and a key
column that identifies a group — over an in-memory source, so the reader
gets the whole grid: grouping, sorting, filters, pivot, calculated
columns, highlight rules, range copy.

*The arrangement is the widget's.* `WidgetInstance` gains an optional
`state`, opaque to the spec: renderer-owned, validated by the renderer
against the columns it actually has. The grid writes its view there on
every change through the same spec edit the inspector uses, so grouping
by entity is an edit — undoable, saved with the dashboard, visible in the
source tab — and a state the grid refuses (a column the binding no
longer has) falls back to the default view rather than blocking the
frame.

*Totals sum only what sums.* A measure aggregates by sum where the
contract's `allowed_aggregations` says it may; otherwise its subtotals
stay blank, the same refusal ADR-67 made for the book. The contract
summary the studio receives now carries `allowed_aggregations` for
exactly this.

**What now fails if this regresses.** `metricGroups.test.ts` builds the
schema from a contract and dims, maps each catalog format to a grid
unit, leaves a non-additive measure without an aggregation, and rolls the
interpreter's rows into a table whose subtotal is the group's sum. The
widgets' catalog test lists `grid@1` as host-rendered with no component.
The studio's `studio.spec.ts` finds the seeded working table with dollar
rows, groups it by entity from the header menu, and reads the arrangement
back in the source tab.

## ADR-84 — an ordinal dimension declares its order once, and every reader of the column follows it

**Pinned:** the owner's question — a string column such as a tenor
bucket has an implied order that a lexical sort scrambles ("10Y+" before
"1M"); how does a reader get the ladder? — and BAR-02, which already
gives the bar chart the same answer for the same dims.

**Decision.** `ColumnMeta` gains `order?: readonly string[]` on a
dimension: the values in their implied order. It is declared once, on
the schema, never on the view — a reader chooses *whether* to sort by
tenor; the book knows *what* tenor order is — and every path that reads
the column follows it:

- *The sort.* The column's `sortFn` is `ordinal`, registered in the
  feature registry beside `alphanumeric`; it reads the order off the
  column's own meta, so the column definition stays a name, not a
  closure, and group rows sort by it as leaves do. A value the order does
  not name sorts after every named one, alphanumerically among its kind,
  so a bucket the data grew appears at the end rather than nowhere.
- *The SQL.* `compileSql` orders such a column by `CASE col WHEN v₀ THEN
  0 … ELSE n END`, then the column, every value a parameter (inlined,
  escaped, for Dremio); a grouping level on the dimension reads in that
  order by default, as it read alphabetically before.
- *The set filter* lists the values in that order; *the pivot* lays its
  buckets across the top in that order.
- *The treasury book* declares the tenor ladder (`O/N … 10Y+`). *A
  registry metric's* ordinal dims — the API already marks a
  `*_bucket` dim `ordinal` and knows its values — now carry those values
  in the contract summary, and `metricGroupsSchema` turns them into the
  column's order; where a summary has none, the studio takes the order
  the engine served the groups in, which is BAR-02's rule.
- *The agent contract* names the order on the column, so `set_view`'s
  author knows a sort on it is not lexical.

**Not chosen.** A per-view sort comparator (the view is JSON every
consumer speaks; a function does not serialize, and a view that carried
the ladder would let two views disagree about what tenor order is). A
numeric shadow column (`tenorYears`) sorted in the ladder's stead — it
works for tenors and for nothing else, and it leaks a sort key into the
data. A `sortDescFirst` toggle — orthogonal; the ladder's direction is
still the reader's.

**What now fails if this regresses.** `ordinal.test.ts` sorts leaves,
group rows and pivot buckets by the ladder in memory, compiles the CASE
with a parameter per value and inline literals for Dremio, proves SQLite
answers the order the client does, and builds a metric schema whose
ordinal dim orders by the contract's values. The API's contract test
finds the maturity ladder on the summary. The grid e2e reads the tenor
set filter in ladder order and walks the header sort from `O/N` to
`10Y+`.

## ADR-85 — a source that serves windows answers a leaf view one window at a time, with the engine's totals

**Pinned:** the TODO every phase since 5 admitted — server-side row
windowing — and the seam's rule that no SQL crosses it.

**Decision.** `serves.window` joins the source description. A source that
serves it (every `sqlSource`: DuckDB-WASM, Dremio, the tests' SQLite) is
asked for a leaf view as `query(view, { window: { offset, limit },
totals? })` and answers only those rows, in the view's order, with
`offset`, the `total` they were cut from and, when asked, `totals`: the
grand total of every measure by its aggregation, pivot buckets included,
over everything the view's filters keep. `compileSql` gains the `totals`
shape — the same aggregates a grouping level takes, with no dimension —
and the leaf query takes its `LIMIT` and `OFFSET` from the window. A
grouped view is untouched: a level is answered whole, as ADR-70 left it,
because groups fan out at far fewer rows than the leaves do.

*The body draws the whole answer.* The grid holds one window of a
thousand rows and the virtualizer counts the total: rows before and after
the window are placeholders of the same height, so the scrollbar spans
the book and a row keeps its place while the window it sits in arrives.
The body reports the range on screen; when it leaves the window's middle
the shell asks for the next, centred on it and snapped to a block of a
hundred, and drops any answer that is no longer the one wanted. A served
slice changing (a filter, a sort) starts the answer over at the top.

*The footer never sums a window.* With `totals` from the engine the grand
total row reads them and nothing else; the status bar's count is the
engine's `total`. The agent's `query_view` maps its own `offset` and
`limit` onto the window and reads the same totals, so an agent asking
for rows 20 to 27 of a Dremio table moves eight rows, not the table.

*What a window does not carry.* A block copied across a window's edge
copies the rows the grid holds; a pinned row leaves when its window does;
the in-memory source serves no window, since a source that filters and
sorts nothing has nothing to cut.

**Not chosen.** A block cache of many windows (more to invalidate when a
served slice changes, for a scroll pattern — jump, read, jump — that a
single window centred on the reader serves as well). Driving the window
from the view's `pagination` slice (the window is the screen's, not the
reader's; a saved view must not remember how far someone scrolled).
Client-side totals over the window (a sum of a thousand rows presented
as the book's would be exactly the wrong number ADR-44 forbids).

**What now fails if this regresses.** `window.test.ts` compiles the
totals shape, reads a window from SQLite with its offset, total and
grand totals equal to brute force, sees a grouped view ignore the window,
and proves the agent's query over the SQL source answers the rows and
totals the in-memory path does. The DuckDB-WASM e2e reads the served
capabilities, the whole book's count and notional in the footer, scrolls
to the last trade and back to the first through placeholder rows.

## ADR-86 — a pivot names which of the dimension's values become columns

**Pinned:** ADR-80's rule that the values across the top come from the
whole source, so a filter never removes a column under the reader's eye,
and the owner's ask for a picker over them.

**Decision.** The view's `pivot` slice gains `buckets: string[]` — the
dimension's values that become columns, in that order — and the view is
version 6; a version-5 view migrates with `buckets: []`, which means what
it meant before: every value the source has. The column builder, the SQL
source's bucketed aggregates and totals, and the headless table all read
the same rule through `pivotBuckets`: the chosen values, else every
distinct one, in the dimension's own order where it has one (ADR-84). A
source asked for chosen buckets compiles them straight in and skips the
`DISTINCT` query.

*The picker sits on the chip.* The pivot chip carries a list button
opening the dimension's values from the source with a checkbox each,
"All" and "First only"; the count of chosen values shows on the button.
Every value ticked is written as no choice at all, so a view that pivots
over everything stays as small as it was. Changing the pivot dimension
clears the buckets — they were the old dimension's values.

*A bucket the data lacks stays.* A saved view that names `HKD` keeps an
HKD band of blanks when the book has no HKD today, so a layout survives
the data under it, as ADR-80 asked; the picker only lists what the source
has, so a reader cannot choose a value that is not there.

**Not chosen.** Buckets on the filter (a pivot that hides USD is not a
book without USD: the Total band still sums it). A "top n by value"
rule (which n, by which measure, as of when — a view should say what it
shows, not a rule that shows something else tomorrow).

**What now fails if this regresses.** `viewState.test.ts` migrates a
version-5 pivot to 6 and refuses an empty bucket name; `pivot.test.ts`
restricts the headless table to the chosen buckets in the dimension's
order; `sql.test.ts` serves a level and the totals with only the chosen
buckets, equal to brute force; the pivot e2e unticks USD and watches its
band go, reads the nine buckets off the link, and clears the choice with
All.

## ADR-87 — editing is a capability the host grants, and the dashboard never grants it

**Pinned:** the owner's ask — editing as a general capability of a
portable grid package, off in the dashboard — and Phase 6's refusal to
paste into a grid that had nowhere for a value to land.

**Decision.** `TreasuryGrid` takes an optional `edit: EditPolicy` — which
columns may change (a list, or a rule over the meta; every registry
column by default) and `onCommit(edits)`, where a committed change goes.
Without it the grid is exactly what it was: read-only over its source.
With it, a double-click, Enter, F2 or a typed character on the focused
cell opens an inline editor; Enter commits and moves down, Tab commits
and moves along, Escape gives up, a blur commits a good value and drops a
bad one. A value that does not read stays under the reader's hands with
the reason, never half-committed. Ctrl+V lands a tab-separated block
from the focused cell over the visible columns — the paste ADR-71 had no
home for — skipping and naming what cannot change: a group row, an
aggregate, a placeholder, a calculated or pivot column, a value that does
not parse.

*What typed text means.* The stored value in the column's unit, read
the way the search grammar reads a number: `2.5bn` in a notional column
is 2,500,000,000 dollars, `3.5%` in a yield column is 3.5, `(1,200)` is
-1200, `$1,200,000` is a number with its sign stripped. A dimension takes
text; a date takes an ISO day. NUM-01 holds: the grid never changes what
a column means, only what a cell holds.

*Where a commit goes.* The cells change at once — an overlay over the
rows, so subtotals and totals recompute — the host's `onCommit` is
called, and when it settles the source is asked again where the reader
is, so what is shown is what the source holds: a host that persists
nothing sees the value revert, honestly. A host that throws puts the
cells back and the status bar says why. Every cell edited in the session
wears a corner mark and the status bar counts them. `DataSource.update`
joins the seam as an optional write: the in-memory source replaces the
rows it names, the SQL source runs one `UPDATE … WHERE rowId = ?` per
edit (inlined and escaped for Dremio), DuckDB-WASM inherits it; a
portable host may wire `onCommit` straight to it.

*What a commit never touches.* The row id column: it is what every
edit, mark and selection is keyed by, so the grid refuses it whatever the
policy says, and the SQL source refuses it again. A batch over SQL runs
in one transaction where the engine has them (DuckDB, SQLite; Dremio's
REST API takes one statement per job), so a paste lands whole or not at
all; and a refused batch still re-reads the source, so what is shown is
what it holds even where a host wrote part of it before refusing.

*The dashboard grants nothing.* `GridWidget` passes no policy, and says
so in a comment: a dashboard reads a governed number, and an edit there
would edit a query result nobody stores. The `grid@1` contract is
unchanged. The harness grants editing behind `#/grid?e=1` and wires it
to the source's `update`, so a reviewer can edit the seeded book in
memory or in DuckDB.

*Not carried.* Edits are data, not view: they do not enter the view's
history, so Ctrl+Z undoes an arrangement and never a number — an undo of
a write is the host's to offer, against its own source. The agent tools
stay read-only; an agent that changes a number is a different decision
(GOV-02 territory) and is not made here.

**Not chosen.** Editing on by default with an `readOnly` prop (a host
that forgets a flag would be editing a governed number; the grant must be
explicit). A cell-level `editable` in the meta (which cells may change is
the host's policy over its source, not a fact about the column). An
edit queue with a Save button (a commit is a commit; batching is the
host's `onCommit` to do).

**What now fails if this regresses.** `edit.test.ts` reads typed text in
every unit, rules columns in and out by policy, lands a pasted block from
an anchor and names every skipped cell, lays edits over rows without
touching the others, and reads edits back from the in-memory and SQLite
sources. The grid e2e at `#/grid?e=1` types `2.5bn` into a notional and
reads `$2,500.0M` with a moved footer total, drops a typed character with
Escape, holds an unreadable yield with its reason, pastes a two-by-two
block, and finds the same book read-only once the grant is off. The
studio e2e double-clicks a value in the seeded grid widget and finds no
editor.

# Proposed — recorded gaps, not yet accepted

The entries below are **stubs with status: proposed**. They record the
conceptual gaps a hostile internal review would find first, and the intended
shape of each answer, so the gap analysis lives in the same governed record
as the decisions — not in a deck. Accepting one means fleshing it out in
place and building it; rejecting one means recording why, here. Numbering is
claimed now so later references stay stable.

## ADR-58 (proposed) — the ingestion control plane: lineage grows a left edge

**The gap.** Lineage starts at `source_binding`; everything upstream is
assumed. The first BCBS 239 question — did every source land, complete, on
time, tied to the ledger — has no governed answer, so "every number proves
itself" is true only rightward of the source table.

**Intended shape.** An `ingestion_contract` document kind: expected
sources, arrival windows, completeness checks (row/notional against
control totals), and GL tie-out tolerances — each check a cited,
effective-dated threshold whose breaches land on the same exception strip
as every other monitor. The lineage graph gains left-edge nodes so
`usedBy` can answer "which filings does this feed's failure touch".

**Acceptance requires.** One real feed contract dogfooded against the
fixture loader, and a decision on where control totals come from.

## ADR-59 (proposed) — governance of the agent layer itself

**The gap.** The platform governs what the agents touch, not what they
are. Under current model-risk expectations the design and definition
agents need their own evidence file: citation accuracy, proposal
accept/reject rates, behavioral regression when the underlying model
version changes. The audit trail pairs agent acts with principals; it does
not yet measure the agent.

**Intended shape.** An agent performance record built from data already
flowing: sampled citation-verification of agent-proposed bodies (the
regime skills define the check), accept/reject/edit rates derived from
comparing proposals to what humans actually saved, and a pinned
model-version field on every agent-attributed act so a vendor model change
is a visible event with a regression gate, not ambient drift.

**Acceptance requires.** A decision on sampling rate and reviewer, and a
place for the evidence (a report kind is the natural fit).

## ADR-60 (proposed) — the filing seam

**The gap.** "One number everywhere" currently ends at this platform's own
surfaces. The actual FR 2052a leaves through a vendor reg-reporting stack;
platform-vs-filing-engine drift is new and unmonitored — the most
expensive drift is the one the pitch is silent on.

**Intended shape.** A reconciliation monitor class: the platform's
computed submission rows against the filing platform's extracted values,
at the filing's own grain, with governed tolerances — the same
`variance_monitor` machinery pointed across the boundary. Not a
replacement claim; a seam with a number on it.

**Acceptance requires.** Access to one filing extract and a mapping
document for its grain.

## ADR-61 (proposed) — parallel-run as the adoption instrument

**The gap.** The machinery for this exists and the framing does not: the
pitch says "trust the pilot" when it could say "here is the divergence
report". Shadow-running the platform beside the incumbent process, with
governed thresholds on the deltas, converts the scale and trust objections
into pilot metrics.

**Intended shape.** No new engine concepts — a monitor whose two inputs
are the platform's number and the incumbent's imported number, plus a
dashboard pattern for divergence-over-time with sign-off when a measure's
divergence stays inside tolerance for the agreed window. Pilot exit
criteria become threshold ids.

**Acceptance requires.** An import path for the incumbent's numbers
(CSV-grade is enough) and agreement on tolerances per measure.

## ADR-62 (proposed) — governed growth of the derivation vocabulary

**The gap.** ADR-53's closed vocabulary is the right control, but its
growth path is undemonstrated for engine ops, so it reads as a ceiling.
The widget and pattern catalogs already show the shape: versioned entries,
proposal → steward → publish.

**Intended shape.** A documented op-addition process with the same
standard the existing five ops met — semantics stated, all three backends,
conformance-tested, refusal behavior for what it cannot do — plus a
published expectation for lead time, so a treasury SME's "what if you
don't have my op" has a process answer instead of a shrug.

**Acceptance requires.** Writing the process down and proving it once, by
adding one op a real 2052a derivation needs.
