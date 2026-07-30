# Metrics Definition Layer

An authoring surface for governed metric definitions — the place a liquidity
analyst writes an FR 2052a rule, watches the number it produces, and reads the
plan that the nightly pipeline will run.

Built from the Claude Design handoff in `project/` (the original brief is
`project/HANDOFF.md`) as a React + TypeScript app with a real CodeMirror 6
editor.

```
npm install
npm run dev        # http://localhost:5173
npm run server     # the registry API on :8787 (SQLite by default)
npm run verify     # typecheck, 327 unit tests, 46 browser checks
npm run build      # typecheck + production bundle
```

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

Every bug that harness has found — nine so far, every one of them in code that
was in code that had been emitted and read many times but never executed. They
are written up in `IMPLEMENTATION.md`.

## Persistence

`server/` is the registry: a small HTTP API over **SQLite in development and SQL
Server in production**, selected by `KEEL_DB` and defaulting to SQLite so a fresh
clone works with no connection string. Without it the surface still runs — it
loads the shipped documents, says `not connected · edits are local`, and behaves
as the static prototype it began as.

**Revisions are append-only.** Saving never updates a row; it adds one. That is
what lets the registry answer the question that matters about a filed number —
what were the rules when we filed it — and it completes the bitemporality the
documents already declared: `effective.from/to` is when a rule *applies*,
`created_at` is when the registry *knew* it. `GET /api/artifacts?at=<iso>` returns
the workspace as it stood at an instant.

Two authors saving at once do not merge. The second gets a `409` naming who got
there first, because silently picking a winner is how a reviewed rule change
disappears into a stale browser tab.

## Where to read next

`IMPLEMENTATION.md` covers the architecture, the diagnostic catalogue, the
classification layer, the conformance policy, every deliberate deviation from
the prototype, and the limits that are still open — filed amounts are now exact
to the cent but intermediate arithmetic is still binary floating point, PySpark is
parsed rather than executed, and the SQL Server path is proved as portable T-SQL
without a SQL Server to run it against.

## Testing

```
npm run test         # 327 unit, conformance and server tests
npm run conformance  # just the executed backends (needs python3, polars, pyiceberg)
npm run e2e          # 46 browser checks against the built bundle
```

The browser suite resolves Chromium the ordinary way. On a machine that already
has one and no route to download another, point it there:

```
CHROMIUM_PATH=/path/to/chromium npm run e2e
```
