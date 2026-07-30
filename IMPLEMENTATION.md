# Metrics Definition Layer — implementation

The authoring surface from the Claude Design handoff in `project/`, built as a
React + TypeScript app with a real CodeMirror 6 editor.

```
npm install
npm run dev        # http://localhost:5173
npm run server     # the registry API on :8787 (SQLite by default)
npm run test       # 327 unit, conformance and server tests
npm run conformance  # just the executed backends (needs python3, polars, pyiceberg)
npm run e2e        # 46 browser checks against the built bundle
npm run verify     # all of the above, plus both typecheck projects
npm run build      # typecheck + production bundle
```

Desktop only, one canvas at 1600×1000 — the same call the design made. Below
1280px the spec calls for the validation column to become a drawer, and below
900px for the surface to go read-only; neither is built, per the scoping
decision in the design chat.

---

## Layout

```
src/
  App.tsx                    state, the evaluation loop, the three columns
  engine/                    everything that computes — no DOM, no React
    vocab.ts                 pill taxonomy, closed-choice fields, source columns
    fixtures.ts              seeded 60-day test data, calibrated to the spec's numbers
    documents.ts             the five documents the surface opens with
    registry.ts              cross-document resolution + effective dating
    compile.ts               one AST → SQL · Polars · PySpark
    report.ts                the grouped table that gets filed
    rows.ts                  Tier E row-level derivations, coverage, migration
    classification-diagnostics.ts  the KEEL06x/07x families
    parse.ts                 position-preserving YAML read
    predicate.ts             `where:` compiler
    expression.ts            arithmetic, comparisons, functions, `case … end`
    evaluate.ts              measure → 60-point daily series
    diagnostics.ts           the KEEL catalogue + pure quick-fix transformations
    refactors.ts             passive structural prompts (§7.3)
    completion.ts            context-scoped candidates
    tokens.ts                what becomes a pill, and in which state
    trace.ts                 derivation trace + blast radius
    plan.ts                  generated query + backend conformance
    format.ts                number formatting
    conformance.ts           fixture → DDL, plan retargeting, tolerance policy
    engine.test.ts           82 tests — measures, diagnostics, fixes
    classification.test.ts   rules, coverage, effective dating
    compile.test.ts          plan emission, report grain, reconciliation
    conformance.test.ts      the compiled SQL, executed on DuckDB
    conformance-python.test.ts  the compiled Polars, executed; PySpark, parsed
    conformance-iceberg.test.ts the whole plan, against a real Iceberg catalogue
    money.ts                 what a filed amount is — rounding as computation
    variance.ts              day-over-day change, trailing dispersion, thresholds
    variance-diagnostics.ts  the KEEL09x family — is the control watching?
    compile-variance.ts      the monitor as window functions, per backend
    conformance-variance.test.ts  same breaches in DuckDB as in the browser
  editor/                    CodeMirror 6 extensions
    context.ts               app state in editor state; live re-parse of the doc
    pills.ts                 replace-widgets, atomic ranges, edit-reveal
    chrome.ts                key/value colouring, active rail, gutters, hints
    lint.ts                  diagnostics → inline squiggles + fix actions
    completion.ts            completion source, auto-open on fixed-choice lines
    ghost.ts                 dimmed inline suggestion, accepted with Tab
    peek.ts                  ⌥-click block widget
    banner.ts                signed-off measure banner (§11)
    quickActions.ts          ⌘. menu — fixes, navigate, rename, extract, inline
    keymap.ts                Tab priority, pill traversal, ⌘N, ⌘↑/↓, drag-insert
    apply.ts                 document mutations, narrowed to the smallest edit
    theme.ts                 the editor's visual layer
  components/                the React chrome around the editor
  styles/
    app.css                  surface tokens + layout
    aperture/                Aperture Risk token files, copied from the bundle
public/
  fonts/                     Inter, self-hosted — the surface makes no network call
server/                      the registry API — no React, no browser
  dialect.ts                 every SQLite/SQL Server difference, in one file
  db.ts                      the two drivers behind one interface
  repository.ts              append-only revisions, optimistic concurrency
  api.ts                     request in, response out — no socket to test
  index.ts                   config from env, wire, listen
e2e/
  surface.spec.ts            the three columns, the loop, fixes, plans, layout
  editor.spec.ts             pills, keyboard, completion, gutters
  persistence.spec.ts        edits survive a reload, against its own registry
```

The split that matters: **`engine/` knows nothing about the editor or React.**
Everything in it is a pure function of (document text, fixture), which is why
the same diagnostic drives the inline squiggle, the gutter glyph, the problems
strip and the `⌘.` menu without any of them re-deriving it — and why the whole
catalogue is testable without a DOM.

## Pills, per §5.7

`Decoration.replace({ widget })` substitutes each resolved reference;
`EditorView.atomicRanges` derives from that same set, so arrow keys and
Backspace treat a reference as one unit; and the decoration is dropped when the
selection enters the range, restoring raw text.

One thing the spec leaves implicit: atomic ranges are exactly what stops the
cursor from ever landing *inside* a pill, so "cursor enters" cannot happen by
itself. Entering the text is therefore explicit — **double-click, or Enter on a
selected pill**. While a range is open it is neither decorated nor atomic, and
it closes as soon as the selection leaves or an edit touches outside it.

Structure is always re-parsed from the live document inside the editor, while
values and diagnostics arrive from React one render behind. That is what lets
pills repaint on the keystroke without waiting on evaluation.

**CodeMirror owns the document.** React's copy is a mirror kept current by
`onChange`, and every mutation — typing, quick fixes, drag-insert, rename,
extract, inline — goes through the view, so there is one undo history and no
way to desync.

## Diagnostics

All 29 codes in §6.2 are emitted, plus four the prototype added
(`KEEL026`/`KEEL027` for trailing windows, `KEEL035` for deprecated external
references, `KEEL044` for closed-choice fields, `KEEL050`–`KEEL052` for
filters). Severity is coupled to governance tier, so the same missing
description is `error` at tier 1–2 and `warn` at tier 3.

Every fix is a pure text transformation. The test suite asserts an invariant
that caught two real bugs: **a fix must change the document, and must clear the
diagnostic that offered it.** A fix that inserts an empty stub fails that test,
which is how `KEEL024` ended up proposing a real weight column instead of a
blank line.

`KEEL032` and `KEEL034` compare against the document as it was when the session
opened, so they fire on *change* rather than on load — editing a signed-off
measure raises `KEEL032` and shows an inline banner, but is never blocked. A
lock would be routed around by copying the file; the diagnostic and the audit
record are the control.

## The classification layer

A metrics view aggregates. FR 2052a first has to decide *which bucket each
record belongs to*, and no single number reveals a record sent to the wrong
one. That is a row-level stage upstream of every measure:

```
source rows
  → derivations   (days_between · date_bucket · classify · param_lookup · expr)
  → measures      (Tier A aggregates, reading the derived columns)
  → derived · windowed
```

Three document kinds share one parser, discriminated by `kind:`:

| Kind | Holds | Verified by |
|---|---|---|
| `metrics_view` | derivations + measures | value, trace, blast radius |
| `classification` | an ordered rule set | coverage, precedence, migration |
| `parameter_set` | governed assumptions | in-force window, keys, citations |
| `report` | a grain + a destination | the rows that would be filed |
| `variance_monitor` | thresholds on a rollup | what each threshold did, over the window |

**Row-level operators are the safest tier in the algebra, not an extension of
its riskiest part.** Every one is stateless and row-wise, so a rule chain maps
onto `ibis.cases`, a Polars `when/then`, a Spark `F.when` and a Deephaven
`update()` formula without any of them needing incremental state. And because
the emitted value is categorical, cross-backend conformance is exact string
equality rather than a float tolerance — a stronger proof than anything the
measure layer can offer.

**Parameter sets are inlined, not joined.** The rate table is bounded, so it
compiles to a literal mapping. Fan-out is impossible by construction, and the
regulatory assumptions stay inside the governed artifact rather than in an
upstream table nobody reviews. A missing rate resolves to NaN, never to zero —
zero would quietly report no outflow for a product that has one.

**Effective dating is bitemporal.** Git carries transaction time (when we
changed our implementation); `effective.from` / `effective.to` carry valid time
(when the regulation applied). Re-running a prior submission resolves the rule
set in force on *that* as-of date. A gap raises KEEL066 rather than silently
classifying nothing; an overlap raises KEEL067 rather than letting document
order decide which regulation you filed under.

### Verification, for a rule set

The value panel is replaced by coverage, which answers the three questions in
order: does every record land somewhere, where did the money go, and which rule
decided each record.

- **Coverage** — records and notional classified, unmapped called out in red.
- **Notional by product ID** — the distribution, sorted by money.
- **Rules** — records and notional per rule, each annotated with what
  pre-empts it (`OD-1 takes 4 first`). Precedence is documentation, not a
  defect, so it lives here rather than in the problems strip.
- **Migration** — the blast radius for a rule change: *"O.D.2 → O.D.1, 8
  records, $11,337,272"*, computed by running the filed and edited rule sets
  over the same rows.

New diagnostics: KEEL060 unmapped records (with notional at stake), KEEL061 a
rule the data never exercises, KEEL062 a rule that can never win, KEEL064 an
emitted value off the declared domain, KEEL065 a product ID with no rate,
KEEL066/067 effective-date gap and overlap, KEEL068 duplicate rule id, KEEL069
an unreadable condition, KEEL070/071 unknown operator or artifact, KEEL072 a
condition or rate changed without touching its citation, KEEL074 an uncited
tier-1 rule, KEEL075/076 duplicate or unreadable parameter entries.

Subsumption is evaluated *empirically against the test data*, not proved. That
is a deliberate limit: it catches the rule that is dead on real data, and the
message says so in those terms rather than claiming a proof it does not have.

## The compiler

`predicate.ts` parses to an AST and *derives* the row-level closure from it.
That is the architectural point rather than a refactor: the same tree that
decides a row in the browser is what `compile.ts` walks to emit SQL, Polars and
PySpark. One definition, one parse, several targets, and no second
implementation to drift against.

```
where: direction = 'OUTFLOW' and insured_flag = true

SQL      (direction = 'OUTFLOW' AND insured_flag = TRUE)
Polars   ((pl.col("direction") == 'OUTFLOW') & (pl.col("insured_flag") == True))
PySpark  ((F.col("direction") == 'OUTFLOW') & (F.col("insured_flag") == True))
```

Rule sets compile to a nested `CASE` **in declared order**, so first-match-wins
is preserved by construction rather than depending on each engine evaluating
branches alike. There is deliberately no `ELSE` arm: an unmatched record
arrives as NULL and gets caught, instead of being swept into a bucket nobody
chose.

Parameter sets are **inlined as literal mappings**, so the compiled plan
carries the regulatory rates *and their citations* where an auditor reading the
query can see them.

Derivations become chained CTEs, one stage each. SQL resolves a `SELECT`'s
aliases only in later stages, so a helper column has to be defined before the
expression that reads it — emitting them side by side produces a query that
fails on every engine. A test asserts no stage references an alias declared
beside it.

A `report` declares a grain and a destination:

```yaml
kind: report
view: fr2052a_outflows
grouping: [product_id, maturity_bucket, currency, entity_id]
measures: [gross_outflow_balance, weighted_outflows_30d]
materialize:
  target: iceberg
  table: reg.fr2052a_daily
  partition_by: [as_of_date]
  mode: overwrite_partitions
```

Its panel shows the rows that would be filed, and the compiled plan per
backend beside them — because "the pipeline runs the same definition you
verified" is a claim, and a claim should be inspectable. The suite asserts the
filed totals reconcile to the view's own measure values, which is the property
that stops the submission and the dashboard disagreeing.

Report diagnostics: KEEL080 unknown view, KEEL081 no grouping, KEEL082 a
grouping column nothing produces, KEEL083 a measure the view does not define,
KEEL084 a portfolio-level cap being evaluated per group (the 75% inflow cap is
not 75% per product ID), KEEL085 no materialize target, KEEL086 a target with
no partition column.

## Data

`fixtures.ts` generates 60 days × 4 entities × 40 instruments per source model
from a seeded LCG, then scales each column by one calibration factor so the
headline figures land where the spec says: `hqla_total` at $284,120,000 and
`lcr_pct` at 118.4%. Deterministic across reloads. `edge` runs thin (zeros,
single-row entities); `stress` applies a shock. Calibration is computed against
`nominal` and reused, so the three fixtures stay comparable.

## Deviations from the prototype

- **`case`/`when`/`then`/`else`/`end` are expression grammar, not references.**
  The prototype resolved them as measure names, so every case-statement measure
  raised five spurious `KEEL001` errors and rendered red pills.
- **Diagnostics point at the line the text is on.** For a folded block scalar
  (`expression: >`) the prototype pointed every expression diagnostic at the
  key's line, which put the squiggle above the code and made the rename fix
  rewrite a line not containing the name. `Measure.contentOf` tracks this.
- **The value panel holds the last good number** (§8.6). The prototype rendered
  `—` when an edit broke the arithmetic; it now holds the previous value dimmed
  with an honest staleness caption, and the blast radius does the same.
- **`where: x <<` is a syntax error.** The prototype's predicate compiler
  accepted an operator in value position, silently compiling it to
  `x < '<'` — a filter that reads as valid while meaning nothing.
- **Backend conformance is driven by a `targets:` list** on the view rather than
  a hard-coded table, which is what gives `KEEL021` a fix that removes the
  backend that cannot run the operator.
- **The definition card has no buttons.** §5.5 sketches
  `[Go to definition] [Show dependents]`; the reviewed prototype omits them and
  so does this. Both actions live on `⌘.` and on ⌘-click.
- **Loop timing is measured, not simulated.** The `updated in Nms` figure is the
  real elapsed parse + diagnose + evaluate time.
- **The shipped rule set has no blind catch-all.** `OW-2` and `IO-1` scope to
  the segments they know about rather than sweeping the remainder into
  “other”, so a segment appearing upstream that nobody has mapped shows up as
  unmapped instead of being silently absorbed. The `edge` fixture carries
  exactly such a segment.

## Persisting rules

Until this layer existed there was no backend at all. The six documents were
string constants in the bundle held in React state, so every edit died on
reload — fine for a design prototype, not a registry.

`server/` is a small HTTP API over one of two databases: **SQLite in
development, SQL Server in production**, chosen by `KEEL_DB` and defaulting to
SQLite so a fresh clone works with no connection string and no network.

```
KEEL_DB=sqlite            # default
KEEL_SQLITE_FILE=keel.db

KEEL_DB=mssql
KEEL_MSSQL_SERVER=…       # required — a missing value refuses to start rather
KEEL_MSSQL_DATABASE=…     #   than silently writing to a file nobody backs up
KEEL_MSSQL_USER=…
KEEL_MSSQL_PASSWORD=…
KEEL_MSSQL_ENCRYPT=true
KEEL_MSSQL_TRUST_CERT=false
```

### Revisions are append-only

One decision shapes the whole schema: **a revision is never modified.** Saving
appends. That is not a feature added for auditors — it is what lets the registry
answer the only question that really matters about a filed number, which is
*what were the rules when we filed it*. An `UPDATE` destroys the answer and no
amount of logging afterwards recovers it.

It also closes the bitemporal gap the documents already implied. `effective.from`
and `effective.to` are **valid time** — when a rule applies. `revision.created_at`
is **transaction time** — when the registry knew it. Reproducing a submission
needs both, and before this the second axis lived only in git history, which the
running application could not read. `GET /api/artifacts?at=<iso>` now returns the
workspace as it stood at an instant.

Two consequences worth stating. Saving an identical body is not an error but is
not a revision either — a no-op save would fill the history with entries nobody
made a decision in, and the history is the thing an auditor reads. And two
authors saving at once do not merge: `expectedRevision` makes the second one a
`409` naming who got there first, because silently picking a winner is how a
reviewed and approved rule change disappears into a stale browser tab.

### One dialect layer, one of which is untested

Every difference between the two engines is in `server/dialect.ts`, because only
one of them can be executed here — there is no SQL Server in this environment and
no Docker daemon to start one. So the T-SQL side is held to the strongest checks
available without a connection: the DDL and DML text is asserted verbatim, and
every statement is handed to a T-SQL parser. **That is the same posture as the
PySpark emitter, and the same real gap: the SQL Server path is proved to be valid,
portable T-SQL and nothing more.** The repository logic above it runs against real
SQLite, and is written to be dialect-agnostic.

What that layer had to absorb:

- **No `LIMIT`, no `TOP`, no `RETURNING`, no upsert.** "The latest revision" is a
  correlated `MAX(revision_no)`, which both engines plan off the same index and
  neither spells differently. A test asserts none of those keywords appear.
- **Nothing reads back an identity.** That is the single most divergent operation
  (`lastInsertRowid` / `SCOPE_IDENTITY()` / `OUTPUT INSERTED`), so the revision
  insert is an `INSERT … SELECT` that computes its own number — which also means
  two concurrent writers collide on the unique constraint instead of interleaving
  a stale read.
- **Timestamps are ISO-8601 UTC strings, not `DATETIME2`.** A native date type
  indexes better, but `mssql` returns a JS `Date` where `node:sqlite` returns a
  string, and a repository that returns different types in development and
  production is a bug waiting for a deployment.
- **`LENGTH` is not `LEN`.** `LEN` ignores trailing whitespace and would
  under-report a YAML body; the T-SQL equivalent is `DATALENGTH` halved for
  `NVARCHAR`. It is the only function needing translation.
- **`NVARCHAR` throughout, `NVARCHAR(MAX)` for bodies.** `FR 2052a — daily
  submission` is already not Latin-1.

### What wiring it up found

- **The editor ignored a document it did not write.** "CodeMirror owns the text,
  React's copy is a mirror" was right and quietly assumed nothing else would ever
  write. The workspace arrives from the API after first paint, so the editor
  mounted on the shipped documents and never heard about the stored ones. The
  symptom was worse than a blank screen: the value panel reads from React, so it
  showed the *persisted* number while the visible rule text was still the shipped
  one. `MetricEditor` now accepts an external document change, annotated
  `addToHistory: false` so ⌘Z cannot "undo" a load into text that exists nowhere.
- **There was a flash of the wrong rules.** Even with that fixed, the surface
  painted the shipped documents and swapped them a moment later. Briefly — but an
  author reading a condition during that moment is reading the wrong one, so the
  first render is now gated on the load.
- **A fixed test port made the suite lie.** A registry left listening by an
  earlier crashed run answered the health check instantly, so the spec read *that*
  process's database while its own server died on `EADDRINUSE`. It failed with a
  message about a missing line of YAML. The spec now asks the OS for a free port.

The browser suite still runs the bundle with **no registry behind it**, which is
deliberate: the static prototype has to keep working standalone, and that is a
property worth testing rather than assuming. `persistence.spec.ts` brings its own
registry and its own preview server on ephemeral ports, and proves the rest —
edit, reload, the edit is still there, revision 1 is still readable, and a stale
save is refused.

Still open: there is no identity provider, so every save is attributed to
`authoring-surface`; and a conflict is reported but not resolved — the author is
told to reload rather than offered a merge.

## Day-over-day variance

A report says what is being filed. It cannot say whether a number moved more than
it should have overnight, because that is a statement about a *change* and a
report is a statement about a day. `kind: variance_monitor` is the seventh
document kind and the first whose answer spans more than one as-of date.

```yaml
kind: variance_monitor
report: fr2052a_submission       # the rollup being watched
measure: weighted_outflows_30d
watch:
  grain: [product_id, entity_id] # coarser than the submission, on purpose
thresholds:
  - id: HARD-USD
    basis: static_abs            # dollars
    limit: 1000000
    severity: error
  - id: RETAIL-PCT
    basis: static_pct            # percent
    limit: 12.0
    applies_to: product_id in ('O.D.1', 'O.D.2', 'O.D.3')
  - id: SIGMA-30
    basis: stddev_30d            # k · σ of the trailing 30 daily moves
    sigma: 3.0
  - id: SIGMA-60
    basis: stddev_60d
    sigma: 2.5
```

### Four decisions that carry the weight

**σ is the dispersion of the past *changes*, not of the levels.** A balance series
that trends has a large σ of levels and a small σ of daily moves, so `|Δ| > k·σ(level)`
fires essentially never and reads like a working control. There is a test that
pins this: a series rising by exactly 100 a day has σ(levels) > 1000 and
σ(changes) = 0.

**The trailing window excludes today.** `ROWS BETWEEN 30 PRECEDING AND 1
PRECEDING`, not `AND CURRENT ROW`. Including the current observation lets an
outlier widen the band it is being tested against — the bigger the break, the
wider the band — so the largest breaks are the ones most likely to be missed. It
is a one-word difference from the version that looks right, and the conformance
suite measures the effect rather than asserting it: among the 25 largest moves in
the window, over 80% would have had their threshold inflated by including today.

**Windows count observations, not calendar days.** `RANGE … INTERVAL '30' DAY`
is defensible, but it cannot be matched exactly by an evaluator walking an array,
and on a business-day series "trailing 30 days" operationally means the last 30
points. Choosing the definition both sides can implement identically is what makes
conformance testable at all.

**A σ from too little history is not a threshold, and is not silently treated as
one.** Below ten trailing moves the dispersion is dominated by whichever two days
happen to be in the window. Those points report `insufficient`, distinct from
`pass` — and the panel shows that column, because a monitor with no breaches and a
monitor with no coverage look identical without it.

A rollup can also be absent for a day. The change on the day it returns is
measured **across the gap** rather than dropped: suppressing it would silence a
breach because a bucket happened to be empty, which is exactly when a breach
matters. The distance is carried so the surface can say `⟂` rather than implying
the move happened overnight — and that alignment was found by conformance, where
DuckDB's `LAG` spanned gaps and the evaluator did not.

### The KEEL09x family

A monitor is a control, and a control's failure mode is not computing the wrong
number — it is looking like it is watching something and not.

| Code | What it catches |
| --- | --- |
| `KEEL090` | names a report that does not exist |
| `KEEL091` | watches a measure the report does not file |
| `KEEL092` | a grain, or a scope, the rollup key does not carry |
| `KEEL093` | a threshold with no basis, no limit, or an unreadable scope |
| `KEEL094` | a σ basis with no usable threshold on most points |
| `KEEL095` | **a threshold that never fires** |
| `KEEL096` | a threshold that fires so often nobody would read it |
| `KEEL097` | a limit every change exceeds |
| `KEEL099` | a tier 1–2 threshold with no citation |

`KEEL095` is the one worth reading twice. It is a warning, not an error — an
escalation trigger that has not fired in sixty days may be correctly set — but
"no alerts" and "no coverage" are indistinguishable from outside, and the author
should decide which one they have knowingly.

### What a design review pass found

The surface was drawn for five documents and now holds seven. Most of what the
last pass turned up was that consequence, not a mistake in the original design.

**Two of seven documents were unreachable from the tab strip.** The row was a
fixed flex line, so once the labels stopped fitting the last two tabs — including
the variance monitor — sat past the right edge with nothing to indicate they
existed. The strip scrolls now, keeps the current tab in view, and fades at
whichever edge has more behind it. A fixed row of tabs is a design that works
until it silently stops.

**Fixing that exposed the real crowding.** The 44px row was carrying four
unrelated jobs — document navigation, save status, fixture choice, and the
pill-state gallery from §5.7 — and only fitted because the tabs were overflowing
invisibly. With the tabs constrained, three labels folded onto second lines inside
a 44px row, which reads as a rendering fault. So the row was given a priority: the
gallery is a workspace-level *demonstration*, not a per-document control, and it
moved to the registry panel's footer where the other workspace-level affordances
live. Navigation went from 2.2 visible tabs to 3.5, and nothing wraps.

**The registry panel said "Measures" over a count of "16 rules".** A header
contradicting the number beside it reads as a bug. It has held five kinds of thing
since the classification layer landed and only ever admitted to one — so the
title, the search placeholder and the footer hint now all name whichever it is.
The hint mattered most: "Drag a measure into the editor to use it" was shown over
a rate table, a report and a monitor, none of which have measures or anything
draggable. An instruction that does not apply makes the reader doubt the ones that
do.

**Coverage and Assumptions were `div`s posing as tabs**, which put two of the five
document kinds outside the keyboard order and made the column's chrome change
shape depending on what was open.

**The per-threshold basis was truncated to `> $1,…` and `> 3σ …`.** Compact forms
now (`>$1.0M`, `>3σ/30d`) with the full sentence on hover.

Three defects of my own, found while fixing the above and worth recording because
they are all the same shape — an effect or a rule keyed on the wrong thing:

- A blanket `white-space: nowrap` meant for the tab row hit the class the
  registry footer's two-line hint also uses, and silently clipped its last two
  words.
- The strip-measuring effect was keyed on `[file, layout]`, but the strip does not
  exist until the workspace has loaded — so it ran once against a null ref and
  never again, and the fade never appeared. Same class of bug as the editor
  ignoring an externally-changed document.
- The inner scroller reused `.mdl-tabs`, putting two of them in one row and making
  "the tab row" ambiguous to select and to reason about.

And one flake removed rather than hoped about: the conformance legs run real
engines out of process and vitest runs files concurrently, so the default 5s test
bound was measuring machine load. A Polars leg that normally takes 200ms timed out
once in four full runs while the variance suite seeded sixty days into DuckDB
beside it.

## Conformance

`conformance-variance.test.ts` seeds DuckDB with the filed table day by day —
running the report 60 times, so what is monitored is genuinely what would have
been submitted — then runs the compiled monitor and compares. It checks the
breach lists are **identical as sets**, that every move agrees, and that σ *and
the observation count behind it* match on the quiet days too, since an off-by-one
frame shows up in the count before it shows up in a breach.

The monitor reads the **sink**, not the positions. A variance alert that disagrees
with the submission it is about is worse than no alert — and matching that meant
the evaluator had to roll up the *filed* rows rather than recompute the measure,
because each filed row is quantized to the cent and the two differ by rounding.

### Performance

Building the series runs the whole report once per day in the window, and the
editing loop calls it on every keystroke — 1252ms, which is a sluggish editor.
Nothing about the series depends on the thresholds, though: tightening a limit
re-judges points that are already computed. The expensive half is keyed on what it
actually depends on, and the loop settles at **26ms**.

## Conformance

Filed amounts are **exact to the cent on every backend**, not close. That used to
be a ±$0.005 tolerance in the comparison, which quietly conceded that the engines
did not actually agree — and a submission that reconciles only approximately is a
finding. The fix was to make rounding part of the computation rather than of the
display: a filed amount *is* the correctly-rounded amount in the minor unit, the
emitters say so (`ROUND(…, 2)` / `.round(2)` / `F.round(…, 2)`), and the tolerance
became an equality. `money.ts` carries the arithmetic, including the reason
`Math.round(x * 100) / 100` is wrong at the boundary — `1.005 * 100` is
`100.49999999999999`.

What that does *not* fix: intermediate arithmetic is still float64. A consequence
worth knowing is that the sum of the filed rows no longer equals the
portfolio-level figure exactly — it differs by up to half a cent per row, which is
an ordinary rounding difference in a filing and is asserted as a band computed
from the row count rather than guessed at.

The compiler's claim is that the nightly pipeline runs the same definition the
author verified. Until this layer existed, that claim was checked by asserting
the *shape* of the emitted plan — arms in declared order, rates inlined, each
derivation in its own stage. Shape assertions catch typos. They do not catch a
plan that is wrong in a way that reads correctly, and every defect below was
exactly that.

`npm run conformance` seeds an in-memory DuckDB with the same fixture the
browser evaluates, runs the compiler's own SQL, and compares the filed table
row for row against the in-browser evaluator. The Polars plan gets the same
treatment through a real Python process. In both cases only the *reader* is
substituted — `scan_iceberg` becomes `scan_csv`, and `retargetPolars` throws
rather than silently passing a plan it could not retarget, because a harness
allowed to touch the logic proves nothing.

The tolerance policy is per-measure and read off the declared `format`:

| kind | rule | why |
| --- | --- | --- |
| counts | exact | an identity, not a measurement |
| currency | ±$0.005 | the unit a submission is reconciled in |
| ratios | 1e-9 relative | two engines summing the same addends in different orders differ in the last bits |

A null grouping key and an empty one are folded together — both mean "no rule
fired" — and that is the only normalisation the comparison performs.

Three real defects surfaced the moment the plans were executed rather than
read:

- **The Polars and PySpark rule sets were not valid code.** Each arm was
  emitted as its own `pl.when(…).then(…)` on its own line, so what looked like
  a thirteen-rule chain was thirteen separate expressions — twelve of them
  evaluated and discarded. `emitCaseChain` now emits one chain per backend, and
  the PySpark plan is parsed by CPython on every run to keep it that way.
- **PySpark called `Column.replace`, which does not exist.** It is a `DataFrame`
  method; on a column it raises at run time, and nothing about reading the plan
  reveals that. Spark now gets a condition chain, the same as SQL.
- **An empty group summed to zero in the browser and to NULL in SQL.** Sixty
  filed rows differed — every group whose maturity bucket put it outside the
  30-day window. The engines genuinely disagree here (Polars returns 0, SQL and
  Spark return NULL), so the emitter now states the convention instead of
  inheriting whichever one the backend happens to hold: `sum` over nothing is
  zero, every other aggregate over nothing is absent.

PySpark is checked for syntax and chaining, not for numbers — a JVM Spark
session is not something a unit test should start, and `pip install pyspark`
does not build in this environment. That is a real gap: the PySpark emitter is
proved to be *valid, chained Python* and nothing more. The two defects above
that it shared with Polars are gone, but a Spark-specific arithmetic difference
would not be caught here.

### The Iceberg seam

The Polars leg proves the logic and nothing about either end of the plan: it
rewrites `scan_iceberg` to `scan_csv` and throws the materialize step away.
Those two lines are exactly where the definition layer touches a data platform,
and "registered here, executed in your pipeline, sinking to Iceberg" is the
claim the architecture rests on.

`conformance-iceberg.test.ts` runs the plan whole. It stands up a real
catalogue — a SQLite metastore over a local warehouse, `as_of_date`-partitioned
— writes the fixture in, binds `CATALOG` and `SNAPSHOT`, executes the
compiler's unmodified output *including the write*, then reads the sink table
back and reconciles it against the evaluator. It also checks the two things
only a catalogue can answer: that filing one day leaves every other day
untouched, and that a pinned snapshot still reproduces a filed number after the
source has been corrected underneath it.

Three more defects, all in code that had been emitted and read but never run:

- **The Polars write could not have worked.** It emitted
  `write_iceberg(table, mode="overwrite_partitions")`, and Polars has no such
  mode — `append` and `overwrite` are the only two. That call raises. Worse was
  the obvious "fix": `overwrite` replaces the *whole table*, so filing Tuesday
  would have deleted Monday. Partition-scoped overwrite is PyIceberg's
  `dynamic_partition_overwrite`, and that is what the compiler now emits for
  that mode; `append` and `overwrite` go through `sink_iceberg`, which streams
  instead of materialising the result first.
- **The result carried no partition column.** The report groups at the grain it
  is *read* at — product ID by bucket by currency by entity — and materialises
  into a table partitioned by `as_of_date`, which is none of those. Both
  `INSERT OVERWRITE … PARTITION (as_of_date)` and
  `dynamic_partition_overwrite` were being handed a result with no `as_of_date`
  in it. Partition columns are now appended to the grouping keys, which is
  sound rather than a patch: the plan is already filtered to one as-of date, so
  it adds no rows, and if that filter ever widens each day partitions correctly
  instead of every row being stamped with one literal. `KEEL087` now catches a
  partition column nothing produces, at the `partition_by` line.
- **The read named no catalogue and pinned no snapshot.**
  `pl.scan_iceberg("alm.fct_2052a_positions")` is ambiguous — Polars also
  accepts a metadata path in that position — and an unpinned read cannot
  reproduce a number that has already been filed, which is the first question
  anyone asks about a submission. Both arrive as parameters the pipeline binds
  rather than connection details the registry invents.

One thing the harness has to provide that the compiler does not:
`dynamic_partition_overwrite` needs a sink that already exists and is
partitioned. The plan writes; it does not provision. The test bootstraps the
sink from the plan's own output schema via a zero-row collect, which is what a
pipeline would do — but emitting a create-if-absent step is an open question.

## Testing

`npm run test` runs 203 engine tests covering the calibrated figures, the
expression evaluator, the predicate compiler, number formatting, every
diagnostic in the catalogue, every quick fix, the trace and blast radius
(including termination on a cyclic graph), completion scoping, and the parser's
handling of folded scalars — plus the classification layer: rule parsing,
ordered first-match semantics, coverage reconciliation (notional per rule must
equal notional per emitted value must equal classified notional), pre-emption
tracking, effective-date resolution, every KEEL06x/07x diagnostic, parameter
resolution, and notional migration.

Two defects the tests caught in this layer: the fixture drove `segment` and
`insured_flag` from the same counter, so no row could be both retail and
insured and the rule reading for exactly that combination matched nothing
— a correlated-fixture bug that would have made a real rule look dead; and the
first rule set shipped with blind catch-alls, which made unmapped records
structurally impossible to detect.

## End to end

`npm run e2e` drives the built bundle in headless Chromium — 33 checks in
`e2e/`, split between the surface and the editor. It runs against `vite
preview` rather than the dev server, because a production-only failure in
chunking or CSS ordering is exactly the kind a dev-server test cannot see.

What it covers is deliberately the half the unit tests cannot reach: that the
engine is wired to something. A quick fix has to reach the CodeMirror document
rather than React's mirror of it; a pill has to be a replace-widget with an
atomic range, so one ArrowRight clears the whole reference and one Backspace
deletes it as a unit and one undo brings it back; ⌥-click has to open the peek
pane *without* wiping the decoration set; switching a tab has to swap the
validation column for the surface that document needs — coverage for a rule
set, assumptions for a rate table, rows-to-file for a report. Every one of
those has been a real defect in this build, and none is visible from `vitest`.

An earlier version of these tests could not be committed because it hard-coded
this environment's Chromium path. The config now reads `CHROMIUM_PATH` and
falls back to Playwright's own browser resolution, so it behaves like a default
config anywhere with a normal toolchain:

```
npm run e2e                                    # ordinary machines
CHROMIUM_PATH=/path/to/chromium npm run e2e    # sandboxes, air-gapped CI
```

Three things it found. A report counted two filed measures in the tree header
and showed none beneath, because those measures are defined in the report's
*view* and the tree only ever listed blocks from the open document; they are
now listed with the document that defines them, and clicking one opens it
there. The registry tree nested `role="treeitem"` directly inside
`role="treeitem"`, with no `role="group"` between them, so a document's
accessible name was computed from its entire contents — every measure and every
value announced as one string. And the surface fetched Inter from Google Fonts
at first paint, which fails silently behind a proxy or offline and drops every
dense numeric column back to a proportional stack; tabular figures are what
make a column of currency scannable here, so the typeface is now self-hosted
and the suite asserts the page makes no external request at all.

`npm run verify` runs the typecheck, the unit and conformance suites, and the
end-to-end suite in one pass.
