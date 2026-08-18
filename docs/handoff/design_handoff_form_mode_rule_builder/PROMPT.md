# Handoff prompt — paste this into Claude Code

Copy everything below the line into Claude Code as your opening message, from the
root of the target repository.

---

I'm adding a second authoring mode to our Metrics Definition Layer: a structured
**Form mode** for less technical business users, alongside the existing YAML
editor. Both modes edit the same document — the form writes the same YAML the
text editor shows — so validation, evaluation, the derivation trace, and blast
radius all run off one engine and never diverge.

Read `design_handoff_form_mode_rule_builder/README.md` first. It is the spec:
layout, exact tokens, every field, the diagnostic-to-field routing table, and the
interaction rules. Then look at the two design references in the same folder:

- `example-form-mode.html` — a small self-contained, runnable reference. Open it
  in a browser. It implements the form, the condition builder, the formula chip
  strip, inline validation, and the live YAML round-trip for two seeded measures.
  This is the piece I want you to port.
- `Metrics Definition Layer.dc.html` — the full prototype the form lives inside
  (registry rail, YAML editor with inline reference pills, value/trace/blast
  panel). Reference only, for context on where Form mode sits in the surface.

Both are **design references written in HTML**, not production code. Recreate
them in this codebase's existing environment using its established component
library, state management, and styling patterns. Do not port my markup or my
inline styles verbatim; do match the layout, the copy, and the behavior exactly.

## What I need built

1. A `Form | YAML` mode toggle on the editor surface. Form is the default.
2. Form mode renders the selected measure as three numbered sections — *01 What
   it is*, *02 How it is calculated*, *03 Shown and governed* — with a
   plain-English sentence at the top that restates the rule and its current
   value, and rewrites itself on every edit.
3. Every fixed-choice field is a real select with plain-language hints, never a
   free-text box: kind of measure, aggregation, format (previewed with this
   measure's own live value), oversight level, window calculation, window length.
4. A **condition builder** for filters: `column → comparison → value` rows with
   `and`/`or` between them. The value dropdown must offer the distinct values
   actually present in the bound fixture, so a user cannot write a predicate
   that matches zero rows. A hand-written filter too complex to round-trip
   (parentheses, `in`, `is null`) renders read-only with a note pointing at YAML
   — never silently rewritten.
5. A **formula builder** for derived measures: draggable chips for measures,
   arithmetic, `case/when/then/else/end`, and functions. Click a chip to remove
   it. Dropping a measure also adds it to the dependency list.
6. **Validation appears inline, attached to the field it belongs to** — not in a
   banner at the top. Use the routing table in the README. Each note carries the
   severity color as a left rail plus a one-click fix button where a fix exists.
   Anything unroutable falls to a short list at the bottom of the card.
7. Round-trip guarantee: switching to YAML shows exactly what the form produced,
   comments and field order preserved.

## Constraints that matter

- **Renaming a measure must rewrite every reference to it** in other measures'
  dependency lists and formulas, in the same transaction. Renaming without this
  silently orphans downstream measures.
- The name field commits on blur or Enter, not per keystroke. Per-keystroke
  rewrites re-resolve the whole graph on every character and flash transient
  "unknown name" errors.
- When writing a line back, preserve the **entire** line prefix including any
  YAML list marker (`  - name:`). Dropping the `- ` deletes the measure and
  spills its fields into the preceding one. This was a real bug I hit; the README
  has the regex.
- Validation severity is coupled to governance tier: a missing description is
  informational on an exploratory metric and blocking at oversight level 1–2.
- No emoji. Numbers use tabular figures. Colors, spacing, and radii come from
  design tokens — never hardcoded hex.

Start by proposing where this lives in the codebase and what you'd reuse before
writing any code.
