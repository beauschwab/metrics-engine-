# Metrics Definition Layer — implementation

The authoring surface from the Claude Design handoff in `project/`, built as a
React + TypeScript app with a real CodeMirror 6 editor.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle
npm run typecheck
```

Desktop only, one canvas at 1600×1000 — the same call the design made. Below
1280px the spec calls for the validation column to become a drawer, and below
900px for the surface to go read-only; neither is built.

---

## Layout

```
src/
  App.tsx                    state, the evaluation loop, the three columns
  engine/                    everything that computes — no DOM, no React
    vocab.ts                 pill taxonomy, closed-choice fields, source columns
    fixtures.ts              seeded 60-day test data, calibrated to the spec's numbers
    documents.ts             the two views the surface opens with
    parse.ts                 position-preserving YAML read
    predicate.ts             `where:` compiler
    expression.ts            arithmetic, comparisons, functions, `case … end`
    evaluate.ts              measure → 60-point daily series
    diagnostics.ts           the KEEL catalogue + pure quick-fix transformations
    completion.ts            context-scoped candidates
    tokens.ts                what becomes a pill, and in which state
    trace.ts                 derivation trace + blast radius
    plan.ts                  generated query + backend conformance
    format.ts                number formatting
  editor/                    CodeMirror 6 extensions
    context.ts               app state in editor state; live re-parse of the doc
    pills.ts                 replace-widgets, atomic ranges, edit-reveal
    chrome.ts                key/value colouring, active-measure rail, both gutters
    lint.ts                  diagnostics → inline squiggles + fix actions
    completion.ts            completion source, auto-open on fixed-choice lines
    ghost.ts                 dimmed inline suggestion, accepted with Tab
    peek.ts                  ⌥-click block widget
    quickActions.ts          ⌘. menu
    keymap.ts                Tab priority, pill traversal, drag-insert
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
strip and the `⌘.` menu without any of them re-deriving it.

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
`onChange`, and every mutation — typing, quick fixes, drag-insert, rename —
goes through the view, so there is one undo history and no way to desync.

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
  raised five spurious `KEEL001` errors and rendered red pills. They are now in
  a `KEYWORDS` set and excluded from resolution, pills and the trace.
- **Diagnostics point at the line the text is on.** For a folded block scalar
  (`expression: >`) the prototype pointed every expression diagnostic at the
  key's line, which put the squiggle above the code and made the rename fix
  rewrite a line not containing the name. `Measure.contentOf` tracks the
  content line and diagnostics use it.
- **The value panel holds the last good number** (§8.6). The prototype rendered
  `—` when an edit broke the arithmetic; it now holds the previous value dimmed
  with an honest staleness caption, and the blast radius does the same.
- **The definition card has no buttons.** §5.5 sketches
  `[Go to definition] [Show dependents]`; the reviewed prototype omits them and
  so does this. Both actions live on `⌘.` and on ⌘-click.
- **`⌘.` offers rename-across-references but not inline/extract.** The two
  omitted actions from §5.4 are not stubbed out.
- **Loop timing is measured, not simulated.** The `updated in Nms` figure in the
  problems strip is the real elapsed parse + diagnose + evaluate time.

## Verified

Driven end-to-end in headless Chromium: pill select / edit-reveal / atomic
delete / undo, quick fixes from both the strip and `⌘.`, live blast-radius
propagation with the MRM note, the completion picker on every fixed-choice
field with live `format:` samples, `where:` completion offering values actually
present in the data, `KEEL051`/`KEEL052` firing from real row counts and a real
parse failure, ⌥-click peek, ⌘-click navigation, drag-insert from the tree,
fixture switching, all seven pill states, both trace modes, and the query tab.
No console errors.

The checks were ad-hoc scripts rather than a committed suite — there are no
automated tests in the repo yet.
