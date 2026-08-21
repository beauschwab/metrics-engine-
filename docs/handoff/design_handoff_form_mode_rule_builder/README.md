# Handoff: Form mode — structured rule builder for the Metrics Definition Layer

## Overview

The Metrics Definition Layer is the authoring surface where an analyst writes,
reads, validates, and trusts a metric definition. Until now its only input
medium was YAML text. This enhancement adds a second authoring mode — **Form
mode** — a structured, drag-assisted surface aimed at business users who need to
define and adjust metric rules without writing YAML.

The governing constraint: **both modes edit the same document.** Form mode does
not maintain a parallel model. Every control writes back into the same YAML
lines, so validation, evaluation, the derivation trace, and the blast-radius
panel all run off one engine and can never disagree with each other. A user can
build a rule in the form, flip to YAML, and see exactly what they produced.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes
showing intended look and behavior, not production code to copy directly. The
task is to **recreate these designs in the target codebase's existing
environment** (React, Vue, SwiftUI, native, etc.) using its established
patterns, component library, and styling conventions. If no environment exists
yet, choose the most appropriate framework for the project and implement there.

Do not port the inline styles or markup structure verbatim. Do match layout,
copy, spacing relationships, and behavior precisely.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, and interactions.
Recreate the UI faithfully using the codebase's existing libraries. Every hex
value, size, and string in this document is the intended final value.

Colors are expressed as design tokens from the Aperture Risk design system
(`--surface-1`, `--text-primary`, `--accent`…). Resolved hex values are given in
the Design Tokens section for reference. Use your codebase's token equivalents;
do not hardcode hex.

---

## Screens / Views

### 1. Editor surface — mode toggle

**Purpose:** let the user choose between the structured form and raw YAML for the
same document.

**Layout:** the toggle sits in the editor column's 44px header bar, in the
right-hand control cluster, immediately left of the "Test data" fixture select.
Two segmented buttons, 4px gap.

**Components:**
- Segment button — `padding: 3px 10px`, `font-size: 11px`, `border-radius: 1px`,
  `1px solid var(--border-default)`, text `var(--text-secondary)`, transparent
  background.
- Selected segment — border `rgba(242,179,0,.5)`, text `var(--accent)`,
  background `rgba(242,179,0,.1)`.
- Labels: `Form`, `YAML`. **Form is the default mode.**

Switching modes must unmount the other mode entirely (no hidden DOM), and must
clear any in-flight line edit.

---

### 2. Form mode — measure card

**Purpose:** define or adjust one measure's rule without writing YAML.

**Layout:** fills the editor column, vertically scrollable, `min-height: 0` on the
scroll container so it doesn't push the problems strip off-screen. Content column
capped at `max-width: 740px`, `padding: 4px 24px 32px 24px`.

The left registry rail and the right value/trace/blast panel are unchanged and
remain visible — the form is not a modal or a separate route. Selecting a
different measure in the rail swaps the card.

#### 2a. Card header

Background `var(--surface-1)`, `padding: 18px 24px 16px 24px`, bottom border
`1px solid var(--border-default)`.

Top row, flex, 10px gap, `align-items: center`:
- Measure name — monospace, `17px`, `var(--sky-500)`, wrapped in angle brackets:
  `⟨hqla_total⟩`
- Kind badge — the design system's `Badge` component, `tone="info"`, `size="md"`.
  Text is one of: `Reads a column`, `Combines measures`, `Looks across dates`.
- Spacer, then a clean-state indicator when the measure has no diagnostics:
  `✓ Nothing to fix`, `11px`, `var(--up-500)`.

Below, the **plain-English sentence** — `13px`, `var(--text-secondary)`,
`line-height: 20px`, `text-wrap: pretty`, `max-width: 620px`, `margin-top: 8px`.
It restates the rule in prose and rewrites itself on every edit. Generation rules:

| Kind | Sentence |
|---|---|
| Reads a column | `<verb> <column>, counting only rows where <filter>. Shown as <formatted value>.` — when there is no filter, `, across every row` replaces the filter clause |
| Looks across dates | `Takes the <calculation help text> of ⟨<input measure>⟩, over the trailing <window>. Currently <formatted value>.` |
| Combines measures | `Combines N other measures — currently <formatted value>.` (singular "measure" when N is 1) |

Aggregation verbs: `sum → Adds up`, `avg → Averages`, `last → Takes the latest`,
`first → Takes the earliest`, `max → Takes the largest`, `min → Takes the
smallest`, `count → Counts the rows of`.

The sentence is prose — it must not carry the pill glyphs used in the editor
(no leading `·` on column names).

#### 2b. Sections

Three sections, each `padding: 20px 0 22px 0`, separated by
`border-bottom: 1px solid var(--border-subtle)`. Fields stack with 16px gaps.

Section header row, `align-items: baseline`, 10px gap:
- Index — monospace, `11px`, `var(--accent)`: `01`, `02`, `03`
- Title — `14px`, `var(--text-primary)`
- Blurb — `11.5px`, `var(--text-tertiary)`

| # | Title | Blurb |
|---|---|---|
| 01 | What it is | How this measure is named and explained. |
| 02 | How it is calculated | The rule itself. Everything here changes the number. |
| 03 | Shown and governed | Presentation, and how much scrutiny this carries. |

#### 2c. Field anatomy

Each field is a 7px-gap vertical stack:
1. **Label row** — `align-items: baseline`, 8px gap, wraps. Label is sentence
   case at `12.5px`, `var(--text-primary)`; it turns `#F2A0A3` when the field has
   an error. Hint text follows at `11.5px`, `var(--text-tertiary)`.
2. **Control** (see field table below).
3. **Inline validation notes**, zero or more (see Validation).

Labels are deliberately *not* uppercase eyebrows here — this surface reads as
prose-and-controls rather than a dense data form.

#### 2d. Fields

Section 01:

| Label | Hint | Control |
|---|---|---|
| Name | lowercase, with underscores · renaming updates every reference | `Input`, `size="lg"`, full width. Draft state: commits on blur or Enter, reverts on Escape |
| Display name | what people see on a report | `Input`, `size="lg"` |
| Description | required once this is under oversight | `Input`, `size="lg"` |

Section 02 — always present:

| Label | Hint | Control |
|---|---|---|
| What kind of measure | this decides which options appear below | Three side-by-side choice cards, `flex: 1` each, 8px gap, `padding: 8px 10px`, `border-radius: 2px`. Unselected: `1px solid var(--border-default)`, transparent. Selected: `1px solid rgba(242,179,0,.55)`, `background: rgba(242,179,0,.10)`, title in `var(--accent)`. Each card is a title at `12px` plus help at `11px var(--text-tertiary)` |

Choice cards: `Read a column` / *reads one column*, `Combine measures` /
*combines other measures*, `Look across dates` / *looks across dates*. These map
to YAML `type: simple | derived | windowed`.

Section 02 — when kind is **Read a column**:

| Label | Hint | Control |
|---|---|---|
| How rows are combined | — | `Select`, `size="lg"`, options `sum, avg, last, first, max, min, count`, each with a plain hint: *adds every row*, *averages rows*, *latest row*, *earliest row*, *largest row*, *smallest row*, *counts rows* |
| Column to read | drag a column in, or pick one | Drop zone + `Select` fallback beneath it (`size="sm"`) |
| Only include rows where | each line narrows the rows | Condition builder |

Section 02 — when kind is **Look across dates**:

| Label | Hint | Control |
|---|---|---|
| Measure to look across | drag a measure in | Drop zone + `Select` fallback |
| Calculation | — | `Select`: `delta` *change since the earlier day*, `pct_change` *percent change since the earlier day*, `stddev` *volatility across the window*, `variance` *squared volatility across the window*, `avg` *average across the window*, `sum` *total across the window*, `min` *lowest in the window*, `max` *highest in the window* |
| How far back | — | `Select`: `1d` *compares with the day before*, `7d` *trailing week*, `30d` *trailing month*, `90d` *trailing quarter* |

Section 02 — when kind is **Combine measures**:

| Label | Hint | Control |
|---|---|---|
| Formula | drag pieces in from below · click a piece to remove it | Formula chip strip + palette |
| Measures used | kept in step with the formula | Removable measure chips; `None yet` in `var(--text-tertiary)` when empty |

Section 03:

| Label | Hint | Control |
|---|---|---|
| How the number is shown | previewed with this measure's own value | `Select`. **Each option's hint is this measure's own current value rendered in that format** — `$284,120,000` beside `currency_usd`, `$284.1M` beside `currency_usd_mm`, `284,120,000` beside `number`, `118.4%` beside `percent_1dp` |
| Oversight level | levels 1 and 2 need a description and a rule reference | `Select`: blank (`—`), `1` *top oversight*, `2` *reviewed*, `3` *exploratory* |
| Rule it comes from | — | `Input`. **Only rendered when oversight level ≥ 1** |

#### 2e. Drop zones

`min-height: 36px`, `padding: 6px 10px`, `border-radius: 2px`, flex row with 8px
gap. Empty: `1px dashed rgba(242,179,0,.45)` on `rgba(242,179,0,.04)`, with
placeholder text at `12px var(--text-tertiary)` (`Drop a column here` /
`Drop a measure here`). Filled: `1px dashed var(--border-default)` on
`var(--surface-1)`, holding one reference chip.

A `Select` sits directly beneath every drop zone as the keyboard-accessible
equivalent. Drag is an accelerator, never the only path.

#### 2f. Condition builder

A vertical 6px-gap stack of condition rows, then an `+ Add a condition` button
(`Button`, `size="sm"`, `variant="ghost"`, left-aligned).

Each row is a flex line, 6px gap, `align-items: center`:
1. **Join select** — only on rows after the first. 72px fixed. Options `and`, `or`.
2. **Column select** — `flex: 1`, `min-width: 0`. Options are the columns of the
   bound source model.
3. **Comparison select** — 68px fixed. Options `=`, `!=`, `>`, `<`, `>=`, `<=`.
4. **Value control** — `flex: 1`. A `Select` when the chosen column has
   enumerable values in the bound fixture, listing **the distinct values actually
   present in the data**; otherwise a text `Input`.
5. **Remove** — `IconButton`, `size="md"`, glyph `✕`,
   `aria-label="Remove condition"`.

Changing the column resets the value to the first distinct value of the new
column.

Offering observed values is the point of this control: it eliminates the most
common silent error in metric authoring, a filter predicate that matches nothing.

**Advanced-filter escape hatch.** A `where` clause containing parentheses,
`not`, `in`, or `is null` cannot be round-tripped into rows. In that case render
the raw clause read-only — monospace `12px`, `padding: 7px 9px`,
`1px solid var(--border-default)` on `var(--bg-canvas)` — and change the field
hint to *"written by hand — switch to YAML to change it"*. Never rewrite or drop
a filter the form cannot represent.

#### 2g. Formula builder

**Chip strip** — the drop target. Flex-wrap, 5px gap, `min-height: 44px`,
`padding: 9px 10px`, `1px dashed var(--gray-600)` on `var(--bg-canvas)`,
`border-radius: 2px`. When empty, placeholder: *"Drag measures and operators here
to build the formula"*.

Chips render by token class, all monospace `12px`, `border-radius: 4px`,
`padding: 1px 6px`:

| Token class | Treatment |
|---|---|
| Measure reference | Sky-blue reference pill, displayed `⟨name⟩` |
| Function | Violet reference pill, displayed `ƒname` |
| Keyword (`case when then else end and or not`) | `1px solid rgba(242,179,0,.4)` on `rgba(242,179,0,.10)`, text `var(--accent)` |
| Operator / literal | No border, `var(--text-secondary)`, `padding: 1px 5px` |

Clicking any chip removes that token. There is no separate delete affordance.

**Palette** — three labelled rows beneath the strip, 8px gap. Row label is a
76px fixed column, `10px` uppercase, `letter-spacing: 0.08em`,
`var(--text-tertiary)`. Items are draggable and also insert on click.

| Row | Items |
|---|---|
| Arithmetic | `+` `-` `*` `/` `(` `)` `,` |
| Conditions | `case` `when` `then` `else` `end` `>` `<` `=` |
| Functions | `greatest` `least` `nullif` `coalesce` `abs` |

Dropping a measure into the strip **also appends it to the dependency list** in
the same transaction, so the "used in the formula but missing from its dependency
list" error cannot occur by construction.

#### 2h. Global palette footer

At the bottom of the card, `padding-top: 16px`, 10px gap. Heading
*"Drag these in"* — `10px` uppercase, `letter-spacing: 0.1em`,
`var(--text-secondary)`, `font-weight: 600`. Two labelled rows, `Columns` and
`Measures`, matching the palette row layout above. Column chips are neutral
reference pills prefixed `·`; measure chips are sky-blue `⟨name⟩`.
`cursor: grab` on every chip.

The registry rail on the left is also a valid drag source into these targets.

---

## Interactions & behavior

**Mode switching.** Form ⇄ YAML. Unmount the inactive mode; clear any active line
edit. Persist the choice per user.

**Selecting a measure.** Clicking a measure in the registry rail swaps the card
and clears the name draft.

**Field commits.**
- Selects, choice cards, condition rows, chips: commit immediately on change.
- **Name: draft state.** Commits on blur or Enter; Escape reverts. Never commit
  per keystroke — each intermediate value would rewrite the document, re-resolve
  every dependent, and flash transient "unknown name" errors (`lcr_p`, `lcr_pc`…).
- All other text fields commit on change; an empty value removes the YAML key
  rather than writing an empty string.

**Renaming.** A rename is one transaction that (a) rewrites the measure's `name`
line, and (b) rewrites every occurrence of the old name in every *other*
measure's dependency list and formula block. Renaming without step (b) silently
orphans downstream measures. Move selection to the new name.

**Drag and drop.** HTML5 drag with a payload of `{kind: 'column' | 'measure' |
'token', name}`. Drop zones accept only their matching kind. `preventDefault` on
dragover. Sources: palette chips, registry rail rows.

**Writing YAML back.** Preserve the whole line prefix, including any list marker:

```
match /^(\s*(?:-\s*)?)/   — NOT /^(\s*)/
```

Capturing only leading whitespace drops the `- ` on `  - name: lcr_pct`, which
deletes the measure from the parsed document and causes its remaining fields to
be absorbed by the preceding measure. New keys are inserted after the measure's
last existing field line, at 4-space indent.

**Formula and expression blocks.** `expression` is a YAML block scalar
(`expression: >` with the body on following indented lines). Replacing it means
replacing the header line plus all continuation lines. Comments elsewhere in the
document must round-trip untouched — a quick-fix that strips a comment explaining
a regulatory carve-out is a serious defect in this domain.

**Live recompute.** Every commit re-parses, re-resolves, re-evaluates, and
repaints the value, sparkline, derivation trace, blast radius, and inline
validation. Budget: under 400ms p95 keystroke-to-value; validation should repaint
independently of evaluation and never wait on it.

---

## Validation

Validation is a persistent property of the document, never a toast or a modal.

**Placement: inline, attached to the field it belongs to** — not a banner at the
top of the card. Route each diagnostic by code:

| Code | Field | Message shape |
|---|---|---|
| KEEL001 | Formula | Unknown measure `{name}`. Did you mean `{suggestion}`? |
| KEEL002 | Measures used | Circular dependency |
| KEEL004 | Column to read | Column `{name}` not found on source `{model}` |
| KEEL005 | Formula | `{name}` is used in the formula but missing from requires, its dependency list |
| KEEL006 | Measures used | `{name}` is listed in requires but never used in the formula |
| KEEL007 | Formula | Unknown function |
| KEEL021 | Formula | `{backend}` can't run `{op}`, so this measure won't work there |
| KEEL025 | Calculation | `{name}` looks across dates, so it needs a calculation |
| KEEL026 | How far back | Must be a number of days, like `30d` |
| KEEL027 | Measure to look across | Must reference exactly one measure |
| KEEL030 | Description | `{name}` is under oversight level `{n}`, so it needs a description |
| KEEL031 | Rule it comes from | `{name}` is under oversight level `{n}`, so it needs the rule it comes from |
| KEEL035 | Formula | `{name}` is being retired — move off it before this goes for review |
| KEEL041 | Name | `{name}` should be lowercase_with_underscores |
| KEEL042 | How the number is shown | `{name}` has no format, so the number will display raw |
| KEEL044 | *the field it was raised on* | `"{value}" is not a valid {field label}. Choose one of: …` |
| KEEL050 | Only include rows where | The filter uses `{col}`, which is not a column on `{model}` |
| KEEL051 | Only include rows where | The filter on `{name}` matches no rows in this test data, so the answer is empty |
| KEEL052 | Only include rows where | This filter can't be read — `{reason}` |

Fallback for anything unmapped: match the diagnostic's source line against the
measure's field-to-line map. Anything still unrouted renders in a short list at
the **bottom** of the card, not the top.

**Note treatment.** `padding: 5px 9px`, `border-radius: 2px`, `font-size: 11.5px`,
flex row with 8px gap, and a 2px left rail in the severity hue:

| Severity | Rail | Background | Text |
|---|---|---|---|
| Error | `var(--down-500)` | `rgba(229,72,77,.09)` | `#F2A0A3` |
| Warning | `var(--warning-500)` | `rgba(224,140,46,.08)` | `#E8B87A` |
| Info | `var(--sky-500)` | `rgba(69,182,240,.07)` | `#A6D8F5` |

Where a fix exists, a right-aligned `Button` (`size="sm"`, `variant="ghost"`)
labelled with the specific action — `Insert stub`, `Add to requires`, `Remove`,
`Use <suggestion>` — not a generic "Fix". Every fix must be a pure text
transformation the user could have made by hand; no silent rewrites.

**Severity is coupled to governance tier.** The same rule carries different
consequence depending on what the artifact is for: a missing description is
informational on an exploratory metric and blocking at oversight level 1–2. Read
the measure's tier and escalate accordingly.

**Field-level invalid state.** A field with an error passes `invalid` to its
`Input` / `Select` (danger border) and turns its label `#F2A0A3`.

---

## State management

| State | Shape | Notes |
|---|---|---|
| `docs` | `{ [fileName]: string[] }` | The YAML document as lines. **Single source of truth for both modes.** |
| `file` | string | Active view file |
| `mode` | `'form' \| 'yaml'` | Default `'form'` |
| `active` | string | Selected measure name; drives both the form card and the value/trace panel |
| `nameDraft` | `string \| null` | Uncommitted name edit; `null` means "show the committed name" |
| `fixture` | `'nominal' \| 'edge' \| 'stress'` | Which seeded dataset evaluates; also sources the observed values in the condition builder |
| `baseline` | `{ [measure]: number }` | Values as of the previous commit — drives the blast-radius before/after |

Derived on every render, never stored: parsed document, diagnostics, values,
trace, blast radius, the prose sentence, and the field list. Memoize the parse
and the evaluation against a cheap document identity — do not rebuild the whole
document string inside a per-measure lookup, which turns one paint into hundreds
of full-document joins.

**Data fetching.** None in the form itself. Evaluation runs against a seeded,
deterministic, versioned fixture (~10k rows) held locally; the prototype uses an
in-memory table, production intent is DuckDB-WASM in the browser. The condition
builder's observed-value lists come from the same fixture.

---

## Design tokens

Aperture Risk design system. Use token names; hex values are for reference.

**Surfaces**

| Token | Hex | Use |
|---|---|---|
| `--bg-canvas` | `#17191D` | Card background, control interiors |
| `--surface-1` | `#22252A` | Card header, filled drop zones |
| `--surface-2` | `#2A2D33` | Popovers, hover |
| `--border-subtle` | `#2B2E34` | Section dividers |
| `--border-default` | `#3C4047` | Control borders, header rules |
| `--border-strong` | `#474C54` | Card borders |

**Text**

| Token | Hex | Use |
|---|---|---|
| `--text-primary` | `#E8EAED` | Field labels, values, section titles |
| `--text-secondary` | `#939AA2` | Prose sentence, palette chip text |
| `--text-tertiary` | `#757A82` | Hints, blurbs, placeholders |

**Semantic**

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#F2B300` | Selected state, section index, keyword chips, focus |
| `--sky-500` | `#45B6F0` | Measure references |
| `--up-500` | `#2ED389` | Clean state, positive delta |
| `--down-500` | `#FF5C6C` | Errors |
| `--warning-500` | `#F58A3C` | Warnings |
| AI violet | `#8B7CF0` | Function references |
| Neutral | `#8A8F98` | Column references — deliberately quiet |

Reference-pill construction: hue at 14% alpha fill, hue at 32% alpha border, hue
at 100% text, `border-radius: 4px`, `padding: 1px 6px`. Each class also carries a
distinct leading glyph (`⟨⟩` measure, `▤` grouping, `ƒ` function, `·` column) so
the taxonomy survives deuteranopia — color is never the only channel.

**Spacing** — 4px grid: 2 / 4 / 6 / 8 / 10 / 16 / 18 / 20 / 22 / 24 / 32.

**Type** — Inter for all chrome and prose; a monospace face for code, values, and
references. Scale: 10 / 11 / 11.5 / 12 / 12.5 / 13 / 14 / 17. Global tracking
`-0.006em`. **Tabular figures mandatory on every number.**

**Radii** — 1px inputs and badges, 2px buttons and cards, 4px reference pills.

**Motion** — 90–150ms, ease-out. No bounce, no springy easing, no looping
animation on data. Respect `prefers-reduced-motion`.

---

## Accessibility

- Every control is reachable and operable by keyboard; drag is always an
  accelerator with a `Select` equivalent beside it.
- Reference chips expose an accessible name of the form *"measure hqla_total,
  oversight level 1, recognized, currently $284,120,000"*.
- The remove-condition control has `aria-label="Remove condition"`.
- Validation notes announce via a polite live region, coalesced to one
  announcement per settled edit rather than per keystroke.
- Pill text meets 4.5:1 against its fill; fills meet 3:1 against the ground.
- Focus is always visible: 2px accent ring with a 1px offset shift, never
  removed, never color alone.

---

## Copy rules

Plain language throughout — this mode exists for users who do not read YAML.
Terms that were rewritten from the engine's vocabulary, use these:

| Internal term | User-facing |
|---|---|
| fixture | test data |
| nominal / edge / stress | Typical / Tricky rows / Stressed |
| resolved | recognized |
| unresolved | unknown name |
| circular | loops back on itself |
| deprecated | being retired |
| restricted | hidden from you |
| stale | recalculating |
| registry | measures |
| derivation | how this is calculated |
| blast radius | if you change this, N measures move |
| grain | shape |
| citation | rule |
| backend conformance | database support (works / not supported) |

Sentence case everywhere except 10–11px micro-labels, which are uppercase with
wide tracking. No emoji. Alerts are factual, never alarmist.

---

## Assets

None. No images or icon files. The glyphs used (`⟨⟩ ▤ ƒ · ✓ ✕ ⚠ ▲ ▼ ↻ ⊘ ⊠`) are
Unicode characters. If your codebase has an icon set, substitute the remove
control's `✕` with its equivalent.

---

## Files in this bundle

| File | What it is |
|---|---|
| `PROMPT.md` | The handoff prompt to paste into Claude Code |
| `example-form-mode.html` | **Runnable reference.** Self-contained single file — the form, condition builder, formula strip, inline validation, and a live YAML round-trip pane for two seeded measures. Open in a browser. This is the piece to port. |
| `Metrics Definition Layer.dc.html` | The full prototype the form lives in — registry rail, YAML editor with inline reference pills, value / derivation trace / blast-radius panel, problems strip. Context only. Requires the design-system bundle to render. |
| `README.md` | This document |

`example-form-mode.html` deliberately omits the surrounding surface so the form
itself is legible in isolation. Read the YAML pane on its right while you edit —
that round-trip is the feature's central guarantee.
