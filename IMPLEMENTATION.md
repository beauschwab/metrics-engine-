# Metrics Definition Layer — implementation

The authoring surface from the Claude Design handoff in `docs/handoff/project/`, built as a
React + TypeScript app with a real CodeMirror 6 editor.

```
npm install
uv sync            # the Python side: only for the executed backends and Dremio
npm run dev        # http://localhost:5173
npm run registry   # the registry API on :8787 (SQLite by default)
npm run registry:mcp   # the MCP server on stdio (read-only by default)
npm run test       # 603 unit, conformance, server and MCP tests
npm run conformance  # just the executed backends (needs python3, polars, pyiceberg)
npm run e2e        # 89 browser checks against the built bundle
npm run verify     # all of the above, every workspace, via Turborepo
npm run build      # typecheck + production bundle
```

Desktop only, one canvas at 1600×1000 — the same call the design made. Below
1280px the spec calls for the validation column to become a drawer, and below
900px for the surface to go read-only; neither is built, per the scoping
decision in the design chat.

---

## Layout

```
apps/                        what deploys or ships
  registry-web/              the authoring surface — the three columns and the editor
    src/App.tsx              state, the evaluation loop, the three columns
    src/editor/              CodeMirror 6 extensions
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
    src/components/          the React chrome around the editor
      LineageStrip.tsx         where the open document sits in the chain
      ChangeImpact.tsx         what this edit does, while it is still an edit
      form/FormMode.tsx        one measure as a card — the structured authoring mode
      form/controls.tsx        field, note, picker, drop zone, chip
    src/styles/app.css       surface tokens + layout
    e2e/surface.spec.ts      the three columns, the loop, fixes, plans, layout
    e2e/editor.spec.ts       pills, keyboard, completion, gutters
    e2e/persistence.spec.ts  edits survive a reload, against its own registry
    e2e/form.spec.ts         the round trip, the builders, inline validation
  registry-mcp/              the registry as tools an external agent can call
    tools.ts                 plain functions over a Repository — all the decisions
    server.ts                the MCP binding: schemas in, JSON out, no decisions
  chartroom-api/             the chartroom API, on the registry's db layer (ADR-4)
  chartroom-studio/          read-first: the canvas under a stated scope (ADR-52)
    src/analyst/             as-of, context, exceptions, explain, palette, changes
    src/Inspector.tsx        the authoring pane, behind #/author
  chartroom-mcp/             chartroom over MCP — 28 tools, thin by contract
  chartroom-agent/           the Python agent service (FastAPI + LangGraph)
packages/                    what other workspaces import, by name
  engine/                    everything that computes — no DOM, no React
    vocab.ts                 pill taxonomy, closed-choice fields, source columns
    fixtures.ts              seeded 60-day test data, calibrated to the spec's numbers
    documents.ts             the seven documents the surface opens with
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
    money.ts                 what a filed amount is — rounding as computation
    variance.ts              day-over-day change, trailing dispersion, thresholds
    variance-diagnostics.ts  the KEEL09x family — is the control watching?
    compile-variance.ts      the monitor as window functions, per backend
    lineage.ts               what each document is *for*, and what feeds what
    binding.ts               a client system's columns, mapped to the canonical source
    form.ts                  form mode as document operations — no parallel model
    impact.ts                what an edit does, by running both versions
    semantic.ts              publishing a definition to the layer people read
    conformance.ts           fixture → DDL, plan retargeting, tolerance policy
    engine.test.ts           81 tests — measures, diagnostics, fixes
    classification.test.ts   rules, coverage, effective dating
    compile.test.ts          plan emission, report grain, reconciliation
    variance.test.ts         window semantics, thresholds, the KEEL09x family
    conformance.test.ts      the compiled SQL, executed on DuckDB
    conformance-python.test.ts  the compiled Polars, executed; PySpark, parsed
    conformance-iceberg.test.ts the whole plan, against a real Iceberg catalogue
    conformance-variance.test.ts  same breaches in DuckDB as in the browser
    lineage.test.ts          stages derived, chains built, nothing hardcoded
    binding.test.ts          adapters, and the mapping that can never be right
    form.test.ts             round trips, and the three losses they guard
    impact.test.ts           silencing measured, not inferred from a diff
    conformance-semantic.test.ts  the published view, executed and reconciled
  registry/                  the registry: persistence, the guard, the gateway
    dialect.ts                 every SQLite/SQL Server difference, in one file
    db.ts                      the two drivers behind one interface
    repository.ts              append-only revisions, optimistic concurrency
    api.ts                     request in, response out — no socket to test
    index.ts                   config from env, wire, listen
    readonly.ts                the guard: what may be sent to a warehouse at all
    query.ts                   the Dremio gateway — cap, timeout, sampling policy
    live.ts                    the three live reads, built on the same compiler
    runtime.ts                 releases, channels, and what a deployed client reads
    query/dremio.py            ADBC Flight SQL client, stdin JSON → stdout JSON
    query/flight_sql_stub.py   a real Flight SQL server over DuckDB, for the tests
    clients/README.md        the contract a runtime client reads: four GETs, no SDK
    clients/python/          a zero-dependency client + a worked example, both tested
  design-system/             Aperture Risk tokens, and Inter self-hosted beside them
  chartroom-spec/            the dashboard spec DSL: schema, canonical form, linter
  chartroom-widgets/         widget contracts + presentation-only components
  chartroom-patterns/        the pattern catalog and its design-guide rationale
  chartroom-critics/         the LLM critics, with a degrade path that never blocks
  typescript-config/         the tsconfig bases every workspace extends
docs/
  brand/final-marks.svg      the Atlas · Prism · Ballast marks and their usage rules
  chartroom/ADRS.md          51 records; read these before changing a boundary
  handoff/                   the design handoffs this was built from — provenance
turbo.json                   the task graph: what depends on what, and what caches
```

Everything under `apps/` and `packages/` is an npm workspace, and Turborepo
derives the task graph from them (ADR-50). The split is the whole convention:
`packages/` is imported by name and `apps/` is not imported at all. There is no
longer any relative import that leaves a workspace — `boundaries.test.ts` fails
on one, in TypeScript and in CSS alike.

The split that matters: **`engine/` knows nothing about the editor or React.**
Everything in it is a pure function of (document text, fixture), which is why
the same diagnostic drives the inline squiggle, the gutter glyph, the problems
strip and the `⌘.` menu without any of them re-deriving it — and why the whole
catalogue is testable without a DOM.

## Deploying: revisions, releases, channels

The surface autosaves every settled edit as a revision. That is right — cheap
drafts are good — and it means nothing that reads "the latest workspace" can be
a runtime contract: whatever a client read would change mid-afternoon because
somebody was typing.

So the fix is not to make saving harder. It is to make deploying a separate,
deliberate act:

```
edit     → a revision     automatic, cheap, nothing reads it
release  → a snapshot     every artifact pinned at one revision, immutable
promote  → a deployment   a channel now points at that release
```

A client dereferences a **channel**, never a release. Rollback is repointing the
channel — nothing is edited back, and the old release remains exactly what it
was. `server/runtime.test.ts` asserts the property that makes the whole thing
work: after a release is promoted, editing the workspace changes nothing the
runtime read path returns.

### One DELETE, and why it is not a hole

`server/dialect.test.ts` asserts that no statement in the registry updates or
deletes anything that is the audit trail. Adding channels required a `DELETE
FROM keel_channel` — there is no portable upsert across SQLite and T-SQL — and
the test caught it, correctly.

The narrowing is the design, stated: `keel_revision`, `keel_artifact`,
`keel_release`, `keel_release_pin` and `keel_promotion` are append-only and the
test enumerates them. `keel_channel` is a *pointer* saying what is deployed
right now, and repointing it is what a deployment and a rollback both are. Every
move it has ever made is appended to `keel_promotion`. Mutating the pointer
loses nothing; mutating the log would lose everything.

### The gate at the moment it matters most

`promoteRelease` runs `assessChange` between what the channel currently serves
and the candidate, and refuses a weakening without `acknowledgeReview`. Three
details:

**It compares against the channel, not the previous release number.** Releases
can be cut and skipped; the governance question is always what changes for the
people reading *this* channel.

**It judges rollbacks.** Promoting an older release that loosens a threshold
relative to what is deployed is refused the same way, because a rollback is a
deployment.

**The acknowledgement lands in the promotion record**, with what was silenced —
so six months later the question is not "was this allowed" but "who decided, and
did they know what it did", and that has an answer.

Cutting a release records diagnostic counts rather than gating on them. The
shipped workspace carries two `KEEL030`s, and a release gate that refuses
anything imperfect is a gate people learn to route around. The single hard
refusal is a document that does not parse — not a deployable thing, a broken
file with a version number.

### Saying it in the header

The model above is only useful to an author who knows it, and the header said
`saved · r7`, which reads as *shipped*. `DeployState` says the other half:
`production r2 · live`, or `production r1 · 3 ahead` in amber with the drifted
documents named on hover. The question it answers is not "is there a newer
release" — that is a release manager's question — but *is what I am looking at
what production is running*, which is the one every author has before walking
away from an edit.

Three decisions in a component this small:

**No deploy button.** Cutting and promoting go through the acknowledgement seam
above, and a button in an editor is the wrong shape for something that should be
reviewed. The indicator's whole job is telling the truth about the current
state.

**Nothing at all when offline or nothing is promoted.** Both are ordinary
states, and an indicator that shows a placeholder in the ordinary case is one
people stop reading in the case that matters.

**The drift is said in words.** `live` and `3 ahead` are different situations;
a reader should not have to decode which one a colour means. Colour reinforces
the word rather than carrying it. The `·` separator exists because `r1 1 ahead`
ran the release number into the count and read as one number.

`loadDeployment` compares the channel's pinned revisions against what the
workspace holds, so "ahead" is per-document rather than a single flag. It is
called on load and after every successful save — from an effect, not from inside
the `setConnection` updater where it first sat: updaters must be pure, and
StrictMode calls them twice, which double-fetched.

## Source bindings: one plan, many client shapes

The rules are written against canonical names. A client system rarely has them:
Murex calls the balance `BAL_AMT_USD` and codes the segment `RTL`/`WSL`/`SBB`.

The naive fix is a compiled plan per system. That is N plans to keep conformant,
and the entire point of the compiler is that there is one. So a binding does the
opposite: it generates an **adapter view** presenting the client's table under
the canonical names, and the canonical plan runs on top, byte-identical
everywhere. `server/runtime.test.ts` asserts exactly that — the plan text with a
binding and without one is the same string.

A binding is `kind: source_binding` — a governed artifact, revisioned and
releasable — because a wrong mapping changes what a number means as much as a
wrong rule does.

### No ELSE fallthrough

A mapped vocabulary becomes a `CASE` whose `ELSE` is `NULL`, not the raw client
code. An unknown code passed through would fail every rule while *looking like
data*; NULL sends it to classification coverage as unmapped, which is where this
surface already makes gaps visible.

### The check that makes it safe to serve

`checkBinding` refuses two things, and the second is the reason it exists.

A column the rules read that the binding does not map is survivable — it fails
loudly in the client's engine. Computing that set is fiddly and worth stating:
derived columns are excluded (`product_id` is produced by the classification, so
no client provides it), and the *report's* grouping keys are included, because
the compiled plan SELECTs `currency` and `entity_id` straight off the source even
though the view never mentions them. Too wide and every honest binding fails;
too narrow and a broken one passes.

**A vocabulary that can never produce a value some rule tests for is the silent
one.** Omit `SBB: SMALL_BUSINESS` and the small-business rule never fires on that
one system, forever. Every number computes. Every coverage report looks clean.
Nothing downstream can see it — this is the only place positioned to, so it
refuses:

```
the rules test segment = 'SMALL_BUSINESS', and no client value maps to it
  — that rule can never fire on murex_eu
```

## The runtime contract, and a client that is executed

`clients/` holds the answer to "how do I call the registry at run time": four
GETs, a zero-dependency Python client, and a worked example running the deployed
plan on a client-shaped DuckDB.

`server/client-example.test.ts` runs it — a real HTTP server on a real port, a
binding saved over the API, a release cut and promoted, the shipped script
executed as documented — and asserts the numbers it files from a table with
*none* of the canonical names in it equal the numbers the surface showed, to the
cent. Documentation that is not executed is aspiration.

Two things that cost a debugging cycle and are worth recording:

**A semicolon inside a generated comment.** The adapter header said "do not edit
it; edit the binding", the example split the SQL on `;` to find statements, and
the fragment after the semicolon became a statement beginning with prose. The
prose was fixed, but the real fix was to stop making every client a small, wrong
SQL parser: the response now carries `adapter.statements` pre-split alongside
`adapter.sql` for humans.

**DuckDB attaches a database file under its basename as a catalog.** The test's
`murex.duckdb` collided with the `murex` schema its table lived in and made every
reference ambiguous. Nothing to do with the registry, everything to do with
naming a file after a schema.

## Form mode

A second authoring surface over the same document, built from the design handoff
in `docs/handoff/design_handoff_form_mode_rule_builder/`. Form is the default: the mode that
needs no YAML is the one a new author should meet first.

The constraint that shapes everything else is that there is **no parallel
model**. `form.ts` is a set of document operations — lines in, lines out —
rather than a state container. Nothing holds a draft of a measure. A form model
that synced back on save is the design where the two views drift, and drift
between an author's mental model and the filed artifact is what this whole
surface exists to prevent.

That also means form mode inherits everything: the same diagnostics, the same
evaluator, the same trace and blast-radius panel, the same quick-fix
transformations. There is no second validation path to keep in step.

### The sentence

Each card opens with the rule restated in English, carrying its current value:

> Adds up hqla_eligible_amount, counting only rows where is_encumbered = false.
> Shown as $284,120,000.

It rewrites itself on every edit, and it is the cheapest check in the product: an
author who reads *"across every row"* and expected a filter has caught their own
mistake without running anything. The absence of a filter is stated rather than
omitted, because a sentence that simply leaves the clause out reads as though a
filter had been chosen.

### Three losses the tests guard

Each of these leaves a document that still parses and still renders, with
measures that have quietly stopped computing — which is why each has a test
named after the failure rather than after the function.

**The list marker.** A measure's first line is `  - name: hqla_total`. Writing it
back having preserved only the leading whitespace drops the `- `, which deletes
the measure from the parsed document and causes its remaining fields to be
absorbed by the measure above it. `parse.ts` already spelled the prefix
correctly and `diagnostics.ts` already wrote lines through it, so form mode
reuses both rather than introducing a fourth copy of the regex.

**The block scalar.** `expression:` is a header line plus every indented line
under it. Replacing only the header leaves the old body in place and the measure
keeps computing the previous formula underneath the new one.

**The references.** A rename rewrites the `name:` line *and* every occurrence in
other measures' `requires:` and `expression:` blocks, in one transaction. The
rewrite is scoped to those blocks so a substring of an unrelated identifier —
`hqla_us_unencumbered` when renaming `hqla_total` — is never touched.

### Two things made unconstructible

Better than validating against a mistake is arranging that it cannot be made.

**A predicate that matches nothing.** The commonest silent error in metric
authoring is `segment = 'Retail'` against a book that says `RETAIL`: it returns a
confident zero rather than an error. The condition builder's value control lists
the distinct values *actually present in the bound fixture*, quoted the way the
predicate compiler reads them back. Numeric columns get a text box instead — a
hundred distinct balances is not a menu, and `> 1000000` is the shape of a
numeric filter anyway. Changing the column resets the value, because a value from
the old column is meaningless against the new one.

**`KEEL005`, used in the formula but missing from `requires`.** Dropping a
measure into the formula strip appends it to the dependency list in the same
edit, so the form cannot produce the pair that raises it.

### What it refuses to represent

A `where` clause containing parentheses, `in`, `not` or `is null` has no faithful
row form. It renders read-only with the field hint changed to *"written by hand —
switch to YAML to change it"*. Round-tripping it through a lossy model would
change what the measure counts, and it would do so silently — the number would
still compute.

### Validation, attached rather than announced

Diagnostics are routed to the control they are about by a code table, falling
back to the measure's own field-to-line map for codes the table has not heard of.
A banner at the top of the card would make the reader hunt for which field it
meant. Anything still unplaced renders in a short list at the *bottom* — visible,
but not competing with the fields for the top of the reader's attention — and the
test asserts that placed plus unplaced equals every diagnostic in the block, so
nothing can be dropped on the way through.

The fix button carries the specific action (*Insert stub*, *Add to requires*)
rather than a generic "Fix", because the label is what tells a reader whether
they want it. It applies the same pure transformation the editor's `⌘.` menu
uses, so a fix applied from the form and one applied from the text produce the
same document.

### One field has a draft

Only the name. Committing per keystroke would rewrite the document on every
character, re-resolve every dependent, and flash "unknown name" for `lcr_p`,
`lcr_pc`, `lcr_pct`… A rename is also a transaction across other measures, and
running it seven times for one edit is both slow and wrong. It commits on blur or
Enter and reverts on Escape.

### Two defects found while building it

**`.mdl-mode` was already taken.** The editor's new Form/YAML switch and the
validation column's trace toggle ended up sharing a class, so each silently
restyled the other — the switch was rendering in the trace toggle's uppercase.
Caught by reading the computed style rather than by any test, and the fix is a
distinct class.

**Form as the default broke all 57 browser checks at once.** Every existing spec
asserted `.cm-content` was visible in its `beforeEach`, having implicitly relied
on the text editor being the only surface. The honest fix was to make those specs
switch to YAML explicitly: a test that reaches for `.cm-content` is a test about
the text editor and should say so.

### The dead end at the default

Form mode is built around measures, and `graph.measures` is empty for five of the
eight shipped kinds — classification, parameter set, report, variance monitor,
source binding. Since Form is also the *default* mode, opening any of those five
landed a new author on a card that said nothing and offered nothing: the mode
that exists so nobody has to meet YAML first was, for the majority of the
workspace, a wall.

The fix is not to pretend a form exists. Each kind names what its form *would*
be — *"an ordered rule set — conditions tried in order, first match wins"* — says
plainly that it is not built yet, and hands over an **Edit as YAML** button that
switches mode rather than making the reader find the switch. Naming the shape
tells an author the concept is understood and unimplemented, which is a different
message from a blank card, and it is the accurate one.

## The information hierarchy

The registry knew its documents by what they *contained* — rules, rates,
measures, thresholds. That is a syntactic taxonomy, and it put two very different
things in the same drawer:

| | `liquidity_pit` | `fr2052a_outflows` |
| --- | --- | --- |
| Kind | `metrics_view` | `metrics_view` |
| Holds | `lcr_pct = 100 × HQLA / net outflows` | classify, rate lookup, weighting |
| Runs | at query time, in a dashboard | in the nightly pipeline, into a filed table |
| Was shown as | ⧉, row 1 of 7 | ⧉, row 5 of 7 |

Same kind, same glyph, one flat hardcoded list, nothing between them. `lineage.ts`
derives the taxonomy an author actually reasons about:

**Prepare** — what is this record? **File** — what goes on the form? **Publish** —
what does it mean? **Watch** — should anyone look at it?

The first three are a chain; each consumes the last. **Watch is not a fourth
link — it points at the chain.** That distinction is why a monitor listed as a
peer of the report it watches reads wrong, and why the fix is not simply a
fifth glyph.

### Derived, never declared

No document says which stage it is in, and adding a `stage:` field would have
been the wrong answer — it is a fact about the workspace, not about a document,
and a hand-maintained one goes stale in a week. Four kinds map straight through;
`metrics_view` is derived:

> A view is **Prepare** when a report files from it, and **Publish** when none
> does.

Structural rather than heuristic, and the test is the proof: delete
`fr2052a_submission` and the same unedited `fr2052a_outflows` becomes Publish.
Add a report over `liquidity_pit` and it becomes Prepare. Nothing is hardcoded,
so the picture cannot drift from the workspace.

### Saying where things run

`targets: [duckdb, snowflake, …]` says which engines *could* run a plan. What an
author needs before editing is what happens tonight, and the compiler is the
authority: `compileReport` inlines a view's derivations, which inline its rule
sets and rate tables, into one plan. **Only the report writes.** So a rule set
reads `Compiled in · writes nothing` rather than "runs nightly", which would have
been a comfortable lie about the thing most likely to be edited carelessly.

Each node carries a short label for the strip and the full sentence for its
tooltip — the chain is the content, the runtime is a caption on it, and a test
holds the short form to 36 characters so it cannot grow back into the chain's
width.

### Drawing the chain

`LineageStrip` renders the spine above the editor, every document step
navigable:

```
alm.fct_2052a_positions › fr2052a_outflows › fr2052a_submission › reg.fr2052a_daily › fr2052a_variance
```

Two things it deliberately does not do. Real lineage is a DAG, and drawing it as
one produces a picture nobody reads — so the spine is the path the data travels
and everything else hangs off a step. And a rule set is **not** drawn as a link:
`positions → product_id → outflows` is not what runs, and misdescribing the
pipeline to whoever is judging whether an edit is safe is worse than drawing
nothing. Rule sets appear as inputs *on* the step that folds them in, and only
when you are standing on that step.

That last clause was a fix, not a design. The first cut carried the inputs at
every step, which pushed `fr2052a_variance` off the right edge — so standing on
the report, the monitor watching it was invisible, and the surface looked like it
had told you everything. It is the document-strip bug exactly: an element that
scrolls needs an affordance saying there is more. Both edges now fade and the
current step scrolls into view, the same treatment and for the same reason.

## What an edit does

`impact.ts` answers a question nothing on the surface previously asked: not *is
this document well formed* but *what does changing it do to things that already
exist*. Those come apart most sharply on a control. A monitor with a raised limit
has no diagnostics, parses cleanly, and has stopped watching sixteen series.

**Loosening a threshold is how a breach disappears.** A wrong number is a data
error; a control that no longer fires is a control failure, and under SR 11-7
that is the more serious finding because it is systemic — nobody would have
caught the next one either. It is also the easiest edit to make for an innocent
reason (this alert is noisy) and the hardest to see in a diff, because the
document still says `thresholds:` and still lists the same number of them.

### It runs both versions

The whole design turns on refusing to pattern-match the YAML. A heuristic — the
number went up, so this is a loosening — is wrong in both directions: it flags a
widened band that changes nothing, and it misses a narrowed trailing window that
now spans a calm period and stops flagging a series. So `assessChange` runs the
monitor over both documents and diffs the breach lists.

| Edit | Reported as |
| --- | --- |
| `limit: 1000000` → `5000000` | silences 3 breaches across 1 series · **needs review** |
| `sigma: 3.0` → `6.0` | silences 32 breaches across 18 series · **needs review** |
| `limit: 1000000` → `100000` | raises 46 new breaches · no review needed |
| description reworded | nothing |

That last row matters as much as the first. Prose moving must not produce a
governance finding, or the finding stops being read — which is how a real one
gets missed.

### One defect worth recording

The first cut identified a breach by rollup and date. Raising `HARD-USD` from
$1mm to $5mm reported **nothing** — those same three key-days were still
breaching under `SIGMA-30`, so the rollup still appeared in the "after" list. The
rollup looked watched; the specific control that had been weakened was invisible.

That is precisely the blindness the module exists to remove, reproduced inside
it. A breach is now identified by *which threshold* fired on which rollup on
which day, and the test that catches it says so.

### Beyond controls

The same pass reports a rule change in records and money — with the prompt the
effective dating exists to record — a report grain that loses a dimension, a
measure that stops being filed, a sink that was redirected (which goes stale
rather than failing), and a rate that moved while its citation did not. That last
one is what a reviewer is actually looking for: a governed assumption changing
under an unchanged authority.

`ChangeImpact.tsx` puts it above the editor rather than in the problems strip. A
problem is something wrong with what you wrote; this is a consequence of what you
wrote being right, and filing them together would teach people to clear both with
the same reflex. It does not block — the surface has no maker-checker model and
inventing a soft one would be worse than saying the thing plainly. **The MCP path
does block**, because an agent has no eyes to read a banner with.

## Publishing to the semantic layer

The compiler emitted SQL, Polars and PySpark — three ways of running a plan in a
pipeline, none of which a dashboard consumes. So the last hop of a governed
number was a human retyping it: `lcr_pct` is defined here under a tier with a
citation and a revision history, and then somebody writes
`100.0 * [HQLA] / [Net Outflows]` into a Tableau calculated field, and *that* is
what the committee sees.

The two then drift — a rounding rule here, a filter there — and the drift is
undetectable because nothing compares them. **Drift you cannot detect is worse
than a wrong number you can.**

`semantic.ts` adds two targets from the same AST: a `CREATE OR REPLACE VIEW` any
BI tool can point at, and a dbt semantic model for stacks that already have a
metric layer. Simple measures become `measures:` and derived ones become
`metrics:` of type `derived`, which is dbt's own split and happens to be exactly
the one the documents already make.

### Refusing rather than guessing

The expression language is SQL-shaped by design, so most of a derived measure
passes through untouched. Three things do not, and each is refused by name:

- `ema()` is `x * 0.981` in the browser — fine for a sparkline, not a definition
  anybody should publish. Emitting *something* would be a dashboard that is
  confidently wrong.
- `max(a, b)` is scalar here and an aggregate in SQL, so it becomes `GREATEST`.
  Passing it through would be a syntax error on some engines and a silent
  aggregate on others, which is worse.
- A `windowed` measure has no single-row form at all.

A refused measure is **named in the issues list, never dropped** — a measure
silently missing from a published view is a number that quietly stops existing on
somebody's dashboard.

### Executed, not asserted

`conformance-semantic.test.ts` creates the view in a real DuckDB over the same
fixture the browser evaluates, and reconciles every published measure — all ten,
including the staged chain `net_cash_outflows_30d → lcr_pct → lcr_buffer` — to
the value on screen. An emitter nobody executes would recreate the drift problem
one layer further in, and a generated view that is subtly wrong is worse than a
hand-written one because it carries the authority of having been generated.

Derived measures each get their own CTE stage, for the reason the report compiler
chains them: SQL cannot reference an alias declared beside it.

## The MCP server

`mcp/` exposes the registry as tools an external agent can call. The split
mirrors `server/api.ts`: `tools.ts` holds every decision as plain async functions
over a `Repository`, and `server.ts` is a schema binding with nothing in it —
so the behaviour is tested without a subprocess, and the protocol is tested
without re-testing the behaviour.

### Releasing and deploying

Six more tools: `list_releases`, `get_release`, `list_channels`, `get_manifest`,
`create_release`, `promote`. Reading is always allowed; cutting and promoting sit
behind the same `KEEL_MCP_WRITE` gate as saving, and `promote` carries the same
acknowledgement seam — an agent that wants to deploy a weakening has to say so,
and the saying is recorded.

The disabled descriptions say what an agent *can* still do rather than only what
it cannot, because a refusal it could have read about first is a wasted turn.

### The reads return semantics, not YAML

`get_rules` gives every rule in evaluation order with its condition, emitted
value, citation and share of the book. First-match precedence means a rule's
position is part of its meaning, and making every caller re-derive that from a
document body is exactly the work a tool should absorb. `get_lineage` answers the
question behind most edits — `usedBy` is the list of things that break —
and `list_artifacts` carries the stage, because otherwise an agent sees several
`metrics_view`s and cannot tell a dashboard ratio from a pipeline enrichment
stage. The same collision, one layer out.

### Authoring is a loop, not a PUT

`validate`, `test_rules`, `preview_report`, `compile` and `assess_change` all
take a proposed **body** and write nothing. An agent can propose a rule set, see
which records it strands, and iterate without touching the registry. A tool that
only saved would be a worse `PUT`.

### Three gates on writing

1. **Off by default.** `KEEL_MCP_WRITE=1` or nothing is written. An agent that
   can silently rewrite a governed rule set is not a capability anybody should
   acquire by forgetting to disable it.
2. **New errors block** — the same catalogue a person is held to, but only for
   errors the change *introduces*. A flat "no errors" gate was implemented first
   and immediately made an unrelated edit to `liquidity_pit` impossible, because
   it ships with two KEEL030s. An agent told to fix someone else's problem before
   it may touch a file will either give up or fix it badly, so pre-existing
   errors are reported in the outcome and are not this edit's fault.
3. **A weakening must be acknowledged.** `assessChange` runs before every save,
   and a change that silences a control is refused unless `acknowledgeReview` is
   passed. The acknowledgement — with *what* was silenced — is appended to the
   revision message. Not a veto: a step that cannot happen by accident, and that
   lands in the history rather than only in the agent's transcript. Six months
   later the question is not "was this allowed" but "who decided, and did they
   know what it did".

Identity comes from `KEEL_MCP_IDENTITY`, never from a tool argument — an author
field the caller can set to any string is not an attribution.

`server.test.ts` drives the real thing over stdio with the SDK's own client, and
checks the one failure mode that is invisible until it is fatal: the banner goes
to **stderr**, and stdout holds nothing at all before a request, because every
byte there is one the client must parse as a protocol message.

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

All 29 codes in §6.2 are emitted, plus the families this build added
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

## Reading a real warehouse

Everything above judges a definition against 160 generated positions a day. That is
enough to answer *is this expressible* and not enough to answer *is this right*,
because the question an author actually has — **are there records in my book my
rules do not classify?** — is a question about their book. A fixture cannot have
the answer, however good it is.

`KEEL_DREMIO_URI` connects the registry to **Dremio over Arrow Flight SQL** and
offers exactly three reads. The set is small on purpose; each one is there
because it answers a question the fixture cannot.

| Read | The question |
| --- | --- |
| `liveReport` | what would this file, from production, today |
| `liveCoverage` | which records does no rule match |
| `liveSample` | show me the rows behind that |

`liveCoverage` is the one worth the connection. It takes the view's own compiled
plan and regroups it to the classification's emitted column; because the compiler
emits no `ELSE`, an unmatched record arrives as a group with a blank key. So one
row of a small aggregate is the completeness of a rule set against production —
and no position-level data left the warehouse to compute it.

It counts records as well as totalling notional, which is the difference between
a coverage report and a rounding error: a bucket holding forty positions that net
to zero is invisible in a column of amounts. The count is not bolted on beside
the compiler either — `ReportSpec.countAs` makes it something the compiler emits,
in each backend's own idiom (`COUNT(*)`, `pl.len()`, `F.count("*")`), placed
after the grouping keys so the positional `GROUP BY` still means the keys. That
last detail is the kind that fails silently rather than loudly, so it has a test
of its own.

### Four decisions

**The plan is the compiler's, not a second generator.** `liveReport` calls
`compileReport` — the same function the conformance harness executes against
DuckDB, Polars and Iceberg. A dedicated "live preview" emitter would have been
easier and would have been a second artifact to keep conformant, which is the
one thing this codebase is organised to avoid. `liveCoverage` goes further and
synthesises a `ReportSpec` rather than SQL, so even the regrouping is compiled.

**It reads. It cannot write.** Three layers, because one is a suggestion:

1. `splitPlan(...).query` — the materialize half of a compiled plan is never
   sent. Filing the submission is the pipeline's job, and an authoring surface
   that can write one is an authoring surface that can be wrong in production.
2. `isReadOnly` — a verb scan over a *skeleton* with comments and string literals
   removed, so `SELECT 1 /* x */ ; DROP TABLE t` and `-- x\nDROP TABLE t` are
   both refused, and `SELECT 'DROP TABLE customers' AS advice` is not. It also
   refuses a second statement outright, and `SET`/`USE`/`PRAGMA`, which are side
   effects wearing a read's clothing.
3. The refusal happens **before the socket opens**. `query.test.ts` proves that
   by pointing at a closed port and asserting `QueryRefused` rather than a
   connection error — otherwise "the guard runs first" is a claim about code
   ordering rather than a property.

**Aggregates by default; rows are a decision someone makes.** Sampling requires
`KEEL_DREMIO_SAMPLING=allowlist` *and* the view named in
`KEEL_DREMIO_SAMPLE_VIEWS`. Both are server-side, and both are checked in
`liveSample` rather than at the route, so there is no second path to the same
rows. The default is `off` because the failure mode is not a wrong number, it is
customer positions on a laptop.

**A sample is stratified, not a head-of-table read.** `LIMIT 100` returns the
common case, which is the case an author already understands. The strata are
taken from the columns the rule set actually branches on — read off the parsed
predicates, not a regex — so every combination a rule can distinguish survives
into the sample. The test makes the difference observable rather than asserted:
468 rows of which two are `PUBLIC_SECTOR`; the uniform sample misses that segment
entirely and the stratified one keeps it. That segment is the whole reason to
look.

### Testing a protocol without the product

There is no Dremio here and no way to start one, so the alternative to mocking
was to implement the protocol. `server/query/flight_sql_stub.py` is a real Flight
SQL server — handshake, `CreatePreparedStatement`, `GetFlightInfo`, `DoGet`,
Arrow IPC over gRPC — backed by DuckDB, so the SQL it answers is real SQL.

`server/live.test.ts` seeds it with the same 2052a fixture the browser evaluates
and asserts the filed table it returns equals `runReport`'s to the cent. That
equality is the product claim in one assertion — *the number you verified in the
surface is the number the warehouse computes* — and it now holds across the
compiler, the guard, the row cap, gRPC and Arrow, not just in-process DuckDB.

What that does **not** prove is stated in the test's own header rather than left
for someone to discover: Dremio's catalogue naming, its dialect quirks, its
access controls and the wording of its auth errors all need a real instance.

Three things this layer cost, all of them dependency archaeology rather than
design. `flightsql-dbapi` pins `sqlalchemy<2` and installing it silently
downgraded the SQLAlchemy that PyIceberg's `SqlCatalog` needs — the Iceberg
conformance leg started failing for a reason that had nothing to do with Iceberg,
which is why the Python side is locked, not merely pinned (ADR-51). ADBC replaced it:
same protocol, no pin, and the Arrow batches arrive without a DB-API layer in
between. ADBC also *always* prepares a statement, so the stub returned `EOF`
until the prepared-statement actions were implemented — which meant hand-rolling
protobuf varint encode/decode, since the `Any`-wrapped command messages have no
Python bindings outside the driver.

Every result carries the exact statement that produced it, capped at
`KEEL_DREMIO_ROW_CAP` (default 5000) by *wrapping* rather than appending — so an
existing `LIMIT` is not doubled — and asking for `cap + 1` rows, which is what
makes `truncated` detectable rather than guessed. A truncated answer presented as
a complete one is worse than no answer at all.

Still open: no identity flows through to Dremio, so the PAT is the server's and
every author reads as that principal. Row-level access control in the warehouse
therefore applies to the service account rather than to the person, which is
acceptable for aggregates and is the reason sampling is off by default.

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

### Conformance, for a monitor

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

## Chartroom

A second application in the monorepo (`chartroom/`, seven npm workspaces plus
a Python agent service:
`spec`, `widgets`, `server`, `studio`) implementing Phase 1 of the
agent-guided dashboard studio design handoff. The full tour is
`chartroom/README.md`; every deviation from the handoff's pinned technology
decisions is a numbered ADR in `chartroom/ADRS.md`. What belongs here is the
seam it needed from the engine and the shape of the trust chain.

**The engine grew two optional constructor arguments and nothing else.**
A grouped query ("weighted outflows by maturity bucket") is answered by the
same `Evaluator` that answers the headline number, restricted by a `rowFilter`
predicate that runs *after* row derivations — so a classification's emitted
column groups exactly like a source column, and there is no parallel "grouped
evaluator" to drift. The second argument, `rowSource`, exists because the
naive per-group construction re-ran the entire row stage — classification
included — once per group per date: an entity × product pivot measured ~6s
cold. Sharing one probe's derived rows across all group evaluators made the
row stage run once per date (~300ms cold, ~10ms warm from the query cache),
and `query.test.ts` pins the conservation law that keeps the seam honest:
per-group values sum back to the headline for an additive measure.

**Metric contracts are derived, never stored.** Unit and precision from the
measure's declared `format`, dimensions from actually running the row stage
and looking at what a row has, denominator lineage from the ratio expression,
and governance status from the release/channel system: `approved` means "the
production channel serves exactly this revision of this document". There is no
second status flag to fall out of date, and Chartroom's GOV-02 rule (no
ungoverned metrics beyond draft) is thereby wired to the registry's real
promotion gate rather than to a parallel invention.

**The design guide is three enforcement layers.** The Zod schema makes the
worst mistakes unrepresentable (no SQL, no HTML, no color field, no dual
axes); fourteen linter rules with IDs carry the judgment calls, each a pure
function over injected contracts with golden tests, fixes as RFC-6902 patches,
and a round-trip test asserting every fix resolves its own finding; the LLM
design critic (Phase 2) judges composition against the approved brief and is
advisory by design — the deterministic linter is the hard gate, per the
handoff, and a critic outage degrades to a WARN finding that says so.

**Phase 2 is the agent loop, and its governance is server-side.** Three more
workspaces — `patterns` (archetypes + rule rationale as data), `critics` (the
design critic with a Zod-validated finding schema, one retry, and a
never-blocks degrade path), and `mcp` (28 tools over stdio, thin by contract).
The grilling protocol is a schema: `BriefSchema`'s eight intake slots are
required fields, so `create_brief` rejects an incomplete intake naming the
missing slot whoever sent it. Composition by an `agent:*` identity requires an
approved brief; approval is refused to agents at the API boundary and the MCP
ships no approve tool at all — plan-before-pixels is enforced where the agent
cannot reach it. Editing a brief supersedes its approval and re-locks
composition, because an approval must point at the exact artifact reviewed.
The audit trail pairs each agent action (`agent:mcp-<session>`) with the human
principal it acted for. The studio grew a Brief tab — the intake slots as an
approvable card; its Approve button is the human half of the seam. ADRs 17–22
record the Phase-2 decisions (Claude Code as the agent surface, the missing
approve tool, approval superseding, critic degradation as a finding).

**One studio bug Phase 2's e2e caught in Phase-1 code**: `open()` was not
idempotent — clicking the already-open dashboard fired a second load whose
response landed after subsequent edits and silently reset the spec to the
saved version. Data loss wearing a refresh's clothes; fixed with an
opening-intent ref, alongside sequence-guarding the debounced lint so a stale
report can never overwrite a fresh one.

**Verification**: `npx turbo run typecheck test e2e --filter='chartroom-*'` —
typecheck across the chartroom workspaces, 132 unit tests (55 spec, 10 widgets, 6 patterns, 9 critics + 8
live-model evals that skip without a key, 40 server, 12 MCP), and 11
Playwright checks: the Phase-1 acceptance loop (form edit → lint → fix → save
→ reload), a conflicting save refused with a 409, the widget-states harness —
and the Phase-2 approval seam end to end: an agent session drafts a brief and
is refused composition, a human approves the card in the studio, the same
agent session is then allowed through, with the audit trail naming both.

## Testing

`npm run test` runs 603 tests — 379 in `src/engine/`, 168 in `server/`, 58 in `mcp/` — covering
the calibrated figures, the
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

`npm run e2e` drives the built bundle in headless Chromium — 89 checks in
`e2e/`, split between the surface, the editor and persistence. It runs against `vite
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
config anywhere with a normal toolchain. The escape hatch is also what to reach
for when an image ships a pre-installed Chromium whose build number does not
match the pinned `@playwright/test` — the whole suite fails at launch, which
looks like 89 regressions and is one mismatched path:

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

### The server was never typechecked

Found while adding `mcp/`, and worth recording because of how long it survived.
`tsconfig.json` includes only `src`; the harness project adds `e2e`. Nothing
included `server/`. A deliberate `const PROOF: number = "not a number"` in
`server/live.ts` passed `npm run typecheck` cleanly — and vitest transpiles
without checking, so the 117 server tests could not catch it either. The only
type errors that would ever have surfaced were the ones that also happened to
break at run time.

`tsconfig.node.json` now covers `server` and `mcp`, and `npm run typecheck` runs
all three projects. Turning it on produced three real errors immediately: an
unused import, a `Diagnostic.msg` that has been `message` all along, and `mssql`
having no type declarations at all. The lesson is not about TypeScript — it is
that a check nobody has watched fail is not evidence of anything.

`npm run verify` is `turbo run typecheck test e2e verify`: every workspace that
defines one of those tasks runs it, across all fourteen — the authoring surface,
the registry, both MCP servers, the four chartroom packages, the studio, and the
Python agent's ruff/mypy/pytest gate.

That it is one command over a derived graph is the point, not a convenience.
The previous arrangement was a hand-written fan-out — `verify:chartroom` naming
six workspaces one by one — and the CI workflow ran three of its four legs while
its own header claimed it ran everything. Seven workspaces, 220 unit tests,
seven studio browser specs and the whole Python gate were checked by nothing on
the way in (ADR-49). A `turbo run test` job cannot drift that way: it covers a
workspace added tomorrow without anyone editing a list (ADR-50). Turborepo also
caches by input hash, so a second run with nothing changed is milliseconds, and
`--filter` scopes any leg to one package.

The agent's venv, previously a manual prerequisite that kept its gate off every
machine nobody had set up by hand, is `npm run setup:agent`.

## What a review pass caught that a green suite did not

Phase 9 shipped twelve widgets, twenty lint rules and a full-green
verification run — 603 engine tests, 89 browser checks, 177 chartroom tests,
27 Python tests, 21 studio checks. A review pass over the same diff then found
eleven defects, every one in a path the new tests exercised without asserting
on. Three are worth recording because of what they have in common.

**A gauge that guessed which way was safe.** `bullet@1` renders a value
against a limit and colours a breach. It judged every threshold as a floor —
`value < target` — so a *ceiling* limit read clean when breached and red when
compliant. The tests passed because the fixture was a coverage ratio, which
really is a floor. Nothing in the data distinguishes the two cases, so the
binding now declares it (`compare.limit: floor | ceiling`) and GAUGE-01
requires the declaration on a gauge. This is the exact failure mode the whole
codebase exists to prevent, and it shipped inside the widget whose entire job
is to show a limit.

**A docstring that claimed a property the arithmetic could not have.**
`waterfall@1`'s header — and ADR-44, written to explain it — said that an
unreconciled bridge would show its own discrepancy, because the closing bar is
drawn where the data puts it rather than where the steps end. It cannot. Both
totals are summed from the same rows as the steps, so the bridge reconciles by
construction and no residual can ever appear. The claim was plausible, it was
written down twice, and it was false. The ADR now records the correction
alongside the original decision, because an architecture note that quietly
edits away its own mistake is worth less than one that shows it.

**A rule whose exemption was exactly backwards.** WF-01 warns when a filtered
bridge presents subset sums as totals. Its check exempted `in` filters with a
single value — the *narrowest* filter possible — while warning on broader
ones, and a golden test locked the inverted behaviour in. The intent had been
"an `in` that lists everything excludes nothing", which is a real distinction
but one the contract can decide: the exemption now compares the list against
the dim's enumerated domain.

Two smaller ones make the same point about what tests measure. A stacked area
clamped negative bands to zero with `Math.max(0, v)`, silently drawing a total
larger than the real one — in a file whose own header said that a renderer
which dropped negative bands would be hiding what the reader needs to see; it
now refuses to draw instead. And `Heatmap.tsx` used a literal NUL byte as a
cell-key separator, which made git classify the file as binary: the only new
widget in the phase with no reviewable diff, in a codebase whose central claim
is that every artifact is reviewable.

The pattern is not "write more tests". Every one of these lives in code the
tests ran. It is that a test asserts the behaviour its author already had in
mind, and none of these authors had a ceiling limit, a negative band, or a
non-UTF-8 byte in mind. Review reads the code for what it *says* rather than
for what it was meant to do — which is why `npm run verify` being green is a
precondition for review, not a substitute for it.
