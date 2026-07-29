# Metrics Definition Layer — implementation

The authoring surface from the Claude Design handoff in `project/`, built as a
React + TypeScript app with a real CodeMirror 6 editor.

```
npm install
npm run dev        # http://localhost:5173
npm run test       # 81 engine tests
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
    engine.test.ts           82 tests — measures, diagnostics, fixes
    classification.test.ts   45 tests — rules, coverage, effective dating
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

## Testing

`npm run test` runs 127 engine tests covering the calibrated figures, the
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

The UI was driven end-to-end in headless Chromium — 38 checks over pill
lifecycle, atomic delete and undo, quick fixes from both the strip and `⌘.`,
`⌘N` templates, `⌘↑/↓` navigation, extract and inline, `where:` completion
against real data, ⌥-click peek, ⌘-click navigation, drag-insert, fixture
switching, all seven pill states, both trace modes, the query tab, column
resizing with persistence, and the digit roll. Those scripts are not committed:
they hard-code this environment's Chromium path, so they would fail anywhere
else. A committed Playwright suite is the obvious next step.
