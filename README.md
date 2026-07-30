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
npm run verify     # typecheck, 383 unit tests, 46 browser checks
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
npm run test         # 383 unit, conformance and server tests
npm run conformance  # just the executed backends (needs python3, polars, pyiceberg)
npm run e2e          # 46 browser checks against the built bundle
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
