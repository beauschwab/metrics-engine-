# Metrics Definition Layer

An authoring surface for governed metric definitions — the place a liquidity
analyst writes an FR 2052a rule, watches the number it produces, and reads the
plan that the nightly pipeline will run.

Built from the Claude Design handoff in `project/` (the original brief is
`project/HANDOFF.md`) as a React + TypeScript app with a real CodeMirror 6
editor.

```
npm install
pip install -r requirements.txt   # only for the executed backends and Dremio
npm run dev        # http://localhost:5173
npm run server     # the registry API on :8787 (SQLite by default)
npm run mcp        # the MCP server on stdio (read-only by default)
npm run verify     # typecheck, 491 unit tests, 62 browser checks
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

Seven documents ship in the workspace: two metrics views (`liquidity_pit`,
`irrbb_eve`), the FR 2052a product-ID rule set and its LCR rate table, the
outflow view that applies them, the daily submission report, and a day-over-day
variance monitor over what that report files.

**Variance monitoring** answers the question a report cannot: did a number move
more overnight than it should have? Thresholds are either static — an absolute
amount or a percentage — or derived from how much that particular rollup normally
moves, as `k × σ` of its trailing 30 or 60 daily changes. Two details decide
whether such a control works at all: σ is the dispersion of past *changes*, not of
the levels, and the trailing window excludes today so a spike cannot widen the band
that judges it. Both are pinned by tests, and DuckDB is made to raise the same
breach list as the browser.

The surface is desktop-only at 1600×1000 — the same call the design made.

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
menu without any of them re-deriving it — and why the whole 42-code catalogue
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

Nine bugs have come out of that harness, every one of them in code that had been
emitted and read many times but never executed. They are written up in
`IMPLEMENTATION.md`.

## Persistence

`server/` is the registry: a small HTTP API over **SQLite in development and SQL
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
end-to-end test in `server/live.test.ts` seeds a real Flight SQL server with the
fixture the browser evaluates and asserts the two filed tables are equal to the
cent, over gRPC — the product claim in one assertion.

**It cannot write.** Every statement passes `server/readonly.ts` first, which
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

The stub in `server/query/flight_sql_stub.py` is a real Flight SQL server, not a
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

## Where to read next

`IMPLEMENTATION.md` covers the architecture, the diagnostic catalogue, the
classification layer, the conformance policy, every deliberate deviation from
the prototype, and the limits that are still open — filed amounts are now exact
to the cent but intermediate arithmetic is still binary floating point, PySpark is
parsed rather than executed, the SQL Server path is proved as portable T-SQL
without a SQL Server to run it against, and the Flight SQL client is proved
against a real implementation of the protocol rather than against Dremio itself.

## Testing

```
npm run test         # 491 unit, conformance, server and MCP tests
npm run conformance  # just the executed backends (needs python3, polars, pyiceberg)
npm run e2e          # 62 browser checks against the built bundle
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
