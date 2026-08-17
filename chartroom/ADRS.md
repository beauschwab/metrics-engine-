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
