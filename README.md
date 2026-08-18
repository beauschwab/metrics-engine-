# Metrics Definition Layer

An authoring surface for governed metric definitions — the place a liquidity
analyst writes an FR 2052a rule, watches the number it produces, and reads the
plan that the nightly pipeline will run.

Built from the Claude Design handoff in `docs/handoff/project/` (the original brief is
`docs/handoff/project/HANDOFF.md`) as a React + TypeScript app with a real CodeMirror 6
editor.

`product.md` states what this product is and what it refuses to do;
`IMPLEMENTATION.md` records how it was built and what broke on the way.
[`chartroom/`](chartroom/README.md) is the consumption half — an agent-guided
studio for dashboards bound to these definitions.

```
npm install
pip install -r requirements.txt   # only for the executed backends and Dremio
npm run dev        # http://localhost:5173
npm run server     # the registry API on :8787 (SQLite by default)
npm run mcp        # the MCP server on stdio (read-only by default)
npm run verify     # typecheck, 603 unit tests, 89 browser checks
npm run build      # typecheck + production bundle
```

The surface itself needs no Python — rules are evaluated in the browser.
`requirements.txt` is for `npm run conformance`, which runs the compiled Polars
and Iceberg plans in a real interpreter, and for the warehouse connection below.
The pins are exact on purpose: `flightsql-dbapi` pins `sqlalchemy<2` and
installing it once silently broke PyIceberg's catalogue in this repo.

## What it does

Three columns. The registry tree on the left, the document in the middle, and
on the right the answer to "is this right?" — which is a different question for
each kind of document the workspace holds:

| Document | Holds | Verified by |
| --- | --- | --- |
| `metrics_view` | derivations and measures | the value, its derivation trace, and what moves if you change it |
| `classification` | an ordered rule set | coverage — which rule fired, on how many records, moving how much notional |
| `parameter_set` | governed assumptions | the in-force window, the keys, the citation behind each rate |
| `report` | a grain and a destination | the rows that would actually be filed |
| `variance_monitor` | thresholds on a rollup | what each threshold did across the window — fired, passed, or had no threshold at all |
| `source_binding` | a client system's column names and codes | whether the adapter it generates can faithfully stand in for the canonical source |

Eight documents ship in the workspace: two metrics views (`liquidity_pit`,
`irrbb_eve`), the FR 2052a product-ID rule set and its LCR rate table, the
outflow view that applies them, the daily submission report, a day-over-day
variance monitor over what that report files, and a source binding mapping one
client system's columns onto the canonical source.

**Variance monitoring** answers the question a report cannot: did a number move
more overnight than it should have? Thresholds are either static — an absolute
amount or a percentage — or derived from how much that particular rollup normally
moves, as `k × σ` of its trailing 30 or 60 daily changes. Two details decide
whether such a control works at all: σ is the dispersion of past *changes*, not of
the levels, and the trailing window excludes today so a spike cannot widen the band
that judges it. Both are pinned by tests, and DuckDB is made to raise the same
breach list as the browser.

The surface is desktop-only at 1600×1000 — the same call the design made.

## Two ways to write the same rule

A rule filed with a regulator is written by people who understand liquidity and
read by people who understand liquidity. Requiring both to also be fluent in a
serialisation format puts a translator between the expert and the artifact, and
every translation step is somewhere a rule can come out meaning something
slightly different from what was intended.

So there are two modes over one document — **Form** (the default) and **YAML** —
and the governing constraint is that there is *no parallel model*. Every control
writes back into the same lines the editor shows, so validation, evaluation, the
derivation trace and the blast radius all run off one engine and cannot
disagree. Build a rule in the form, flip to YAML, read exactly what you produced.

Form mode is one measure as a card: a sentence restating the rule in English with
its current value, then three numbered sections.

> **⟨hqla_total⟩** · Reads a column
> Adds up hqla_eligible_amount, counting only rows where is_encumbered = false.
> Shown as $284,120,000.

The sentence rewrites itself on every edit, which is what makes the mode
self-checking: an author who reads *"across every row"* and expected a filter has
found their own mistake without running anything.

Four things in it are doing real work:

**The condition builder offers only values the data holds.** The commonest silent
error in metric authoring is a predicate that matches nothing — `segment =
'Retail'` against a book that says `RETAIL` — and it returns a confident zero
rather than an error. The value dropdown lists the distinct values actually
present in the bound fixture, so that class of mistake is unconstructible.

**A filter it cannot represent is shown, never rewritten.** A clause with
parentheses, `in`, `not` or `is null` has no faithful row form, so it renders
read-only with a pointer to YAML. Approximating it would change what the measure
counts without saying so.

**Dropping a measure into a formula also adds it to the dependency list**, in one
edit — so `KEEL005`, *used in the formula but missing from `requires`*, cannot be
built here at all.

**Validation is attached to the field it is about**, routed by diagnostic code,
with the specific fix — *Insert stub*, *Add to requires* — rather than a generic
one. A banner at the top of the card makes the reader hunt for which field it
meant. Anything the routing table cannot place falls to a short list at the
bottom, visible but not competing.

Renaming is one transaction: the `name:` line **and** every reference to it in
other measures' dependency lists and formulas. A rename without the second half
leaves a document that still parses, still renders, and has quietly stopped
computing.

## How the workspace is organised

Documents are grouped by **what they are for**, not by what they contain — because
`kind:` cannot tell those apart. `liquidity_pit` holds the LCR ratio a dashboard
reads and `fr2052a_outflows` classifies positions for a filing; both are
`kind: metrics_view`.

| Stage | The question it answers | Runs |
| --- | --- | --- |
| **Prepare** | what each record is | compiled into whatever files from it |
| **File** | what gets submitted | in the pipeline, writing a table |
| **Publish** | what people read | at query time, writing nothing |
| **Watch** | what checks it | after the report, raising breaches |

Prepare → File → Publish is a chain; each consumes the last. **Watch is not a
fourth link — it points at the chain**, which is why a monitor sitting as a peer
of the report it watches reads wrong.

Every stage is *derived*, never declared. A view is Prepare when a report files
from it and Publish when none does, so deleting the report reclassifies the same
unedited view. That is what stops the picture drifting from the workspace.

The chain itself is drawn above the editor, source table to last consumer, with
the open document marked:

```
alm.fct_2052a_positions › fr2052a_outflows › fr2052a_submission › reg.fr2052a_daily › fr2052a_variance
```

Every document step navigates, so "what does this feed?" is something you follow
rather than reconstruct from `using:` fields across four files. Rule sets and rate
tables hang off a step as inputs rather than appearing as links, because
`positions → product_id → outflows` is not what runs — and misdescribing the
pipeline to whoever is judging whether an edit is safe is worse than drawing
nothing. Beside it sits the sentence the surface could not previously say:
`Pipeline · writes reg.fr2052a_daily` against `Query time · writes nothing`.

## Three ideas worth knowing before reading the code

**References are pills.** A resolved name is a CodeMirror replace-widget over an
atomic range: it deletes as one unit, comes back on one undo, and reveals its
raw text only when you open it deliberately. Colour carries state — recognised,
unknown, deprecated, restricted, recalculating — so a broken reference is
visible without reading.

**The engine knows nothing about React or the editor.** Everything in `engine/`
is a pure function of (document text, fixture), which is why one diagnostic
drives the inline squiggle, the gutter glyph, the problems strip and the `⌘.`
menu without any of them re-deriving it — and why the whole 68-code catalogue
is testable without a DOM.

**One definition, several execution targets.** The compiler walks the rules,
rates, derivations and measures once and emits SQL, Polars and PySpark. The
claim that the pipeline runs the same definition the author verified is not
asserted — it's executed. `npm run conformance` seeds a real DuckDB, runs the
compiled plan, and compares the filed table row for row against the in-browser
evaluator; runs the Polars plan through a real Python process for the same
comparison; and stands up a real Iceberg catalogue to run the plan *whole*,
including the write, then reads the sink table back and reconciles it. That last
leg also proves the two things only a catalogue can answer: filing one day
leaves every other day untouched, and a pinned snapshot still reproduces a filed
number after the source has been corrected underneath it.

Every defect written up under *Conformance* in `IMPLEMENTATION.md` came out of
that harness, and every one of them was in code that had been emitted and read
many times but never executed. A count is not given here because it would go
stale; the list is.

## Persistence

`packages/registry/` is the registry: a small HTTP API over **SQLite in development and SQL
Server in production**, selected by `KEEL_DB` and defaulting to SQLite so a fresh
clone works with no connection string. Without it the surface still runs — it
loads the shipped documents, says `local only`, and behaves as the static
prototype it began as.

**Revisions are append-only.** Saving never updates a row; it adds one. That is
what lets the registry answer the question that matters about a filed number —
what were the rules when we filed it — and it completes the bitemporality the
documents already declared: `effective.from/to` is when a rule *applies*,
`created_at` is when the registry *knew* it. `GET /api/artifacts?at=<iso>` returns
the workspace as it stood at an instant.

Two authors saving at once do not merge. The second gets a `409` naming who got
there first, because silently picking a winner is how a reviewed rule change
disappears into a stale browser tab.

## Pointing it at your own data

Until now every number in the surface came from a 160-position generated book.
That is enough to judge whether a rule is *expressible* and not enough to judge
whether it is *right* — the question an author actually has is "are there records
in my book my rules do not classify?", and a fixture cannot answer it.

Set `KEEL_DREMIO_URI` and the registry will run the same compiled plan against
**Dremio over Arrow Flight SQL**:

```
export KEEL_DREMIO_URI=grpc+tls://dremio.internal:32010
export KEEL_DREMIO_TOKEN=<personal access token>
```

| Route | Returns |
| --- | --- |
| `GET  /api/live/status` | what it is connected to, and whether rows may leave |
| `POST /api/live/report/:name` | the filed table, from production positions |
| `POST /api/live/coverage/:view` | records per emitted value — including the ones no rule matched |
| `POST /api/live/sample/:view` | a stratified sample of source rows (gated, see below) |

Three things about this are deliberate.

**It is the same plan.** `liveReport` calls `compileReport`, the compiler the
conformance harness executes against DuckDB, Polars and Iceberg. A second SQL
generator for "live preview" would be a second thing to keep conformant. The
end-to-end test in `packages/registry/live.test.ts` seeds a real Flight SQL server with the
fixture the browser evaluates and asserts the two filed tables are equal to the
cent, over gRPC — the product claim in one assertion.

**It cannot write.** Every statement passes `packages/registry/readonly.ts` first, which
strips comments and string literals before scanning, so `SELECT 1 /* x */ ; DROP
TABLE t` is refused rather than parsed as harmless. The materialize half of a
compiled plan is stripped, never sent: filing the submission is the pipeline's
job, and an authoring surface that could write one is an authoring surface that
can be wrong in production. A refusal happens before the connection is opened,
which is what the test proves by pointing at a closed port.

**Aggregates by default; rows are a decision.** `coverage` answers the real
question without a single position leaving the warehouse. Sampling is off unless
`KEEL_DREMIO_SAMPLING=allowlist` *and* the view is named in
`KEEL_DREMIO_SAMPLE_VIEWS` — two gates, both server-side, so enabling row export
is a deliberate and auditable act rather than a checkbox in a browser. When it is
on, the sample is stratified over the columns the rule set branches on, because
a head-of-table read never contains the six-position segment nobody mapped, and
that segment is the entire reason to look.

Every result carries the exact statement that produced it, capped at
`KEEL_DREMIO_ROW_CAP` rows (default 5000) and flagged `truncated` when the cap
bit — a truncated answer presented as a complete one is worse than no answer.

The stub in `packages/registry/query/flight_sql_stub.py` is a real Flight SQL server, not a
mock, but it is not Dremio: the transport, the token, the guard and the
reconciliation are tested, while Dremio's catalogue naming, dialect quirks and
access controls are not.

## Before you save: what the edit does

The diagnostics strip says whether a document is well formed. A separate banner
says what changing it does to things that already exist — and those come apart
most sharply on a control:

> **CONTROL** Silences 3 breaches across 1 series · *worth a second pair of eyes*

**Loosening a threshold is how a breach disappears.** A wrong number is a data
error; a control that no longer fires is a control failure, which under SR 11-7
is the more serious finding because it is systemic. It is also the easiest edit
to make for an innocent reason — this alert is noisy — and the hardest to see in
a diff, because the document still says `thresholds:` and still lists the same
number of them.

So the assessment **runs both versions** rather than pattern-matching the YAML. A
raised limit is not flagged because a number got bigger; it is flagged because
breaches that fire on today's data stop firing. That distinction matters in both
directions: a widened band that changes nothing is not reported, and a *narrowed
trailing window* that quietly spans a calm period is. It also reports rule changes
in records and money, report grains that lose a dimension, and rates that moved
while their citation did not.

## Publishing to the semantic layer

`liquidity_pit` defines `lcr_pct` under a governance tier with a citation and a
revision history. Until now the last hop was a human retyping
`100.0 * HQLA / net outflows` into a dashboard, after which the two definitions
drift and nothing compares them.

The compiler now emits two more targets from the same AST:

```
CREATE OR REPLACE VIEW analytics.liquidity_pit AS …   # any BI tool can point at it
semantic_models: / metrics:                            # dbt, for stacks with a metric layer
```

`conformance-semantic.test.ts` creates the view in a real DuckDB over the same
fixture the browser evaluates and reconciles every published measure against the
value on screen. What cannot be published is **named rather than dropped**:
`ema()` is a preview approximation with no portable SQL, so it is refused by name
instead of being approximated into a dashboard that is confidently wrong.

## For agents: the MCP server

```
npm run mcp                      # read-only
KEEL_MCP_WRITE=1 npm run mcp     # writes allowed
```

Twelve tools over stdio. The reads return **resolved semantics, not YAML** —
`get_rules` gives every rule in evaluation order with its condition, emitted
value, citation and share of the book, because first-match precedence means a
rule's position is part of its meaning and no caller should re-derive that.
`get_lineage` answers the question behind most edits: `usedBy` is the list of
things that break.

Authoring is a loop, not a `PUT`. `test_rules`, `preview_report`, `validate`,
`compile` and `assess_change` all take a proposed **body** and write nothing, so
an agent can propose a rule set, see which records it strands, and iterate
without touching the registry.

Writes go through the same `Repository.save` a browser uses — append-only
revisions, optimistic concurrency, attribution — behind three gates:

1. **Off by default.** An agent that can rewrite a governed rule set is not
   something you get by forgetting to turn it off.
2. **New errors block.** The same catalogue a person is held to — but only for
   errors the change *introduces*. A flat check made an unrelated edit to a
   document with pre-existing problems impossible, and an agent told to fix
   someone else's problem first will either give up or fix it badly.
3. **A weakening must be acknowledged.** `assess_change` runs before every save;
   if the edit silences a control the save is refused unless
   `acknowledgeReview: true` is passed — and the acknowledgement, with what was
   silenced, lands in the revision message. Not a veto: a step that cannot
   happen by accident.

Identity comes from `KEEL_MCP_IDENTITY`, never from a tool argument. An author
field the caller can set to any string is not an attribution.

## Deploying, and consuming at run time

The surface autosaves every settled edit as a revision. That is right for
authors and would be poison for a runtime client — whatever it read would change
mid-afternoon because somebody was typing. So editing and deploying are separate
acts:

```
edit     → a revision     automatic, cheap, nothing reads it
release  → a snapshot     every artifact pinned at one revision, immutable
promote  → a deployment   a channel now points at that release
```

A client dereferences a **channel** — `production`, `staging` — never a release.
Rollback is repointing the channel; nothing is edited back, and the old release
is still exactly what it was. Every promotion records who, when and why, so
*"what were we computing on the 14th"* is a query rather than an investigation.

**Promotion is where the governance gate bites hardest.** `assessChange` runs
between what the channel currently serves and the candidate release, and a
change that silences a control or restates filed history is refused unless the
caller passes `acknowledgeReview` — which is then written into the promotion
record. It judges rollbacks the same way, because a rollback is a deployment.

Cutting a release records the workspace's diagnostic counts rather than gating
on them. The shipped workspace itself carries two `KEEL030`s, and a release gate
that refuses anything imperfect is a gate people learn to route around. The one
hard refusal is a document that does not parse: that is not a deployable thing,
it is a broken file with a version number.

**The header says which half you are in.** `saved · r7` reads exactly like
"shipped" to anyone who has not internalised the model above, so next to it sits
what production is actually running: `production r2 · live` when every document
matches the deployed release, or `production r1 · 3 ahead` in amber when it does
not, hovering to name the documents that have moved. It offers no deploy button.
Cutting and promoting are governed acts with an acknowledgement seam behind them,
and a button in an editor is the wrong shape for something that should be
reviewed. Telling the truth about the current state is the whole job.

The runtime contract is four GETs and needs no SDK — manifest, plan, rules — and
is documented with a zero-dependency client and a worked example in
[`packages/registry/clients/README.md`](packages/registry/clients/README.md). Both are executed by the test suite,
so the documentation is checked rather than described.

## When the client's columns are not your columns

The rules are written once against canonical names — `balance_usd`, `segment`,
`is_secured`. A client system rarely has those: Murex calls the balance
`BAL_AMT_USD` and codes the segment `RTL`/`WSL`/`SBB`.

The tempting fix is a different compiled plan per system. That is N plans to
keep conformant, and the entire point of the compiler is that there is one.

A `source_binding` does the opposite. It generates an **adapter view** that
presents the client's table under the canonical names, and the canonical plan
runs on top of it byte-identical everywhere:

```yaml
kind: source_binding
binds: alm.fct_2052a_positions      # the canonical source it stands in for
table: murex.v_liq_positions        # the client's table
columns:
  - canonical: balance_usd
    column: BAL_AMT_USD
  - canonical: segment
    column: CUST_SEG
    map: {RTL: RETAIL, SBB: SMALL_BUSINESS, WSL: WHOLESALE}
```

An unmapped client code becomes **NULL**, not the raw code — NULL lands in
classification coverage as *unmapped*, where the surface already makes gaps
visible, while the raw code would fail every rule while looking like data.

And the check that makes it safe to serve: a binding missing a column the rules
read, or carrying a vocabulary that can **never produce** a value some rule tests
for, is refused with the list. That second failure is the reason the check
exists — omit `SBB: SMALL_BUSINESS` and the small-business rule never fires on
that one system, forever, while every number still computes and every coverage
report still looks clean.

## Chartroom — dashboards over the registry

A second app in the monorepo (`chartroom/` — seven npm workspaces plus a
Python agent service): an **agent-guided studio for governed analytics
dashboards** whose every number traces to a registry function and whose every
visual clears an executable design guide. A dashboard is a declarative spec —
schema-validated, content-hashed, versioned, diffed in reviewer vocabulary —
never freeform code; the renderer is a deterministic interpreter over a
versioned catalog of 12 widgets. The linter carries the design guide as 20
rules with IDs and one-click JSON Patch fixes; governance status derives from
the registry's own release/channel system, so a dashboard cannot leave draft
while binding a measure production has never served.

The agent loop is governed the same way: an MCP server exposes 28 tools, the
intake interview's eight slots are a schema (`create_brief` rejects an
incomplete brief naming the slot), and an agent session cannot compose until a
human approves the design brief in the studio — nor approve anything itself,
ever. An LLM design critic judges composition against the brief and degrades
to a WARN when no model is available; the deterministic linter stays the hard
gate. Since Phase 7 the loop itself is a Python LangGraph + deepagents service
consuming that same MCP roster.

Queries route by backend — `CHARTROOM_BACKEND=fixtures|duckdb|dremio`. The
fixture path stays the default *and the oracle*: a parity harness runs every
query shape against both engines over identical rows and requires agreement to
1e-6, and warehouse execution compiles the engine's own measure SQL rather than
a second implementation of it.

```
npm run chartroom:api      # :8788 — contracts, queries, dashboards, governance
npm run chartroom:studio   # :5174 — the studio (brief approval lives here)
npm run chartroom:mcp      # stdio — the agent's tool surface
# the Python agent service (:8789) — see apps/chartroom-agent/README.md
```

Three dogfood dashboards (an LCR monitor, a limit board, and a variance walk)
seed on first boot, bound to the real shipped measures.
[`docs/chartroom/README.md`](docs/chartroom/README.md) is the tour;
[`docs/chartroom/ADRS.md`](docs/chartroom/ADRS.md) records every deviation from the design
handoff's pinned decisions, including the ones that record a mistake and its
correction.

## Where to read next

`product.md` states what the product is, who it is for, what ships today, and
the four things it deliberately refuses to do. `IMPLEMENTATION.md` covers the architecture, the diagnostic catalogue, the
classification layer, the conformance policy, every deliberate deviation from
the prototype, and the limits that are still open — filed amounts are now exact
to the cent but intermediate arithmetic is still binary floating point, PySpark is
parsed rather than executed, the SQL Server path is proved as portable T-SQL
without a SQL Server to run it against, and the Flight SQL client is proved
against a real implementation of the protocol rather than against Dremio itself.

## Testing

```
npm run verify       # everything below, across all 14 workspaces
npm run test         # 823 unit, conformance, server and MCP tests
npm run conformance  # just the executed backends (needs python3, polars, pyiceberg)
npm run e2e          # 111 browser checks against the built bundles
npm run setup:agent  # build the Python agent's venv, once

Turborepo runs these over the package graph and caches by input hash, so a
second `npm run typecheck` with nothing changed is milliseconds. Scope any of
them with a filter: `npx turbo run test --filter=keel-engine`.
```

The server tests include a live Flight SQL round trip. They skip themselves,
rather than fail, when `pyarrow.flight`, `adbc_driver_flightsql` or `duckdb` is
absent — a missing optional dependency should read as "not run", not as a defect.

The browser suite resolves Chromium the ordinary way. On a machine that already
has one and no route to download another — a sandbox, a locked-down CI image, or
any environment whose pre-installed browser build does not match the pinned
`@playwright/test` — point it there:

```
CHROMIUM_PATH=/path/to/chromium npm run e2e
```
