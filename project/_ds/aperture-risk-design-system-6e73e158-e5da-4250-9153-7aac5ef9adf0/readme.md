# Aperture Risk — Design System

**Aperture Risk** is the design system for an institutional **trading risk &
portfolio-management terminal** — the kind of cockpit a buy-side risk officer,
portfolio manager, or trader lives in all day. Think *BlackRock Aladdin* meets
*Bloomberg Terminal*, rebuilt for the modern web with **embedded AI** (a risk
copilot) woven directly into the data surfaces.

It is **dark-first**, dense, and numeric. Components live on the
`window.ApertureRiskDesignSystem_6e73e1` namespace (aliased **`Aperture`** in this guide
for brevity — destructure it from that window key in your own pages). Every pixel is in service of helping a
professional read enormous amounts of live market and portfolio data, spot risk
breaches fast, and act with confidence.

> **Provenance.** This system was authored from a written brief, not an existing
> codebase or Figma file. There were no source repos or design links to import.
> If/when real product source becomes available, reconcile tokens and components
> against it and note the source links here.

---

## The vibe in one paragraph

Bloomberg's amber-on-black heritage, modernized with Supabase-grade craft. Surfaces
are layered near-black greys; the single brand accent is a **deep golden yellow**
used sparingly for focus, primary actions, live indicators, and the AI copilot's
highlights. Gains are green, losses are red — never decorative, always semantic.
Typography is **Inter only**, tight and small, with **tabular figures everywhere**
so columns of numbers lock into clean vertical rails. The feeling is *calm,
precise, and serious* — a professional instrument, not a consumer app.

---

## CONTENT FUNDAMENTALS

How copy is written across the product.

- **Voice:** terse, precise, expert. We assume a sophisticated finance audience.
  No hand-holding, no marketing fluff inside the product.
- **Person:** address the user as **"you"** in guidance and AI responses
  ("Your VaR is up 12% since open"). The system refers to itself in the third
  person or simply acts ("Aperture flagged 3 limit breaches"). The AI copilot
  speaks in first person sparingly ("I re-ran the stress test").
- **Casing:** **Sentence case** for everything — buttons, headers, menus, table
  headers. The only ALL-CAPS usage is micro-labels / eyebrows with wide tracking
  (e.g. `EXPOSURE`, `VAR (95%)`, `INTRADAY P&L`).
- **Numbers are the content.** Lead with the number, qualify after. Always show
  units, currency, and sign. Use `+`/`−` explicitly on deltas. Percentages to
  appropriate precision (bps for rates, 2dp for returns). Large values abbreviate:
  `$1.24B`, `$486.2M`, `12.4K`.
- **Tone of alerts:** factual and actionable, never alarmist. "Limit breach:
  EM equity exposure 4.2% over cap" — not "⚠️ Warning!!!". Severity is carried by
  color and a small status dot, not exclamation marks.
- **Brevity:** labels are 1–2 words. Tooltips are one sentence. Empty states tell
  you what will appear and how to populate it.
- **No emoji.** Ever, in product chrome. Status is communicated with color, dots,
  arrows (▲▼), and iconography.
- **Examples:**
  - Button: `Run stress test`, `Add to watchlist`, `Acknowledge breach`
  - Header: `Portfolio risk`, `Intraday P&L`, `Scenario analysis`
  - Eyebrow: `NET EXPOSURE`, `TRACKING ERROR`, `BETA (SPX)`
  - AI prompt placeholder: `Ask about your portfolio…`
  - Toast: `Stress test complete — 4 scenarios, 1 breach`

---

## VISUAL FOUNDATIONS

**Color.** Dark-first. The canvas is near-black neutral grey (`--bg-canvas
#121316`); surfaces step up in luminance — base → card → raised → active — so depth
reads through subtle value shifts, not heavy shadow. The **single brand accent is a
deep golden yellow** (`--yellow-500 #F2B300`). Yellow is precious: primary buttons,
focus rings, live ticks, selected rows, the AI copilot's glow. Surfaces sit on a
**softened** dark neutral scale (lifted a notch from pure black), layered base → card →
raised, with a **third, lighter elevated level** (`--surface-3`) reserved for
visualization surfaces — chart plot areas, flow-graph nodes, popovers. Finance semantics are
fixed and non-negotiable — **green = up/long/positive**, **red = down/short/negative**
— and have dedicated soft-tint backgrounds for cells and pills. Warning is a distinct
**orange** (deliberately separated from brand yellow so caution never collides with
the accent), danger is red, info is a muted blue, and the **AI accent is a soft violet**
used only on copilot surfaces. Imagery, where present, is cool and low-saturation —
charts and data, not photography. For **data visualization** there is a dedicated
**sky-blue** hue (`--sky-500 #45B6F0`) for line overlays, target lines and second series;
the `--viz-1/2/3` aliases (yellow → sky → violet) give a consistent multi-series order.

**Type.** Inter, exclusively, with **optical sizing** and a few refinements for an
elegant read: a subtle global negative tracking (`-0.006em`), tighter display tracking
on hero metrics (`--tracking-display -0.028em`), and Inter's single-story *a* (`cv11`).
The scale is small and tight (13px default body, 11–12px for dense tables) — a
professional tool, not a landing page. Headings use weight, not size, for hierarchy.
**Tabular figures (`font-variant-numeric: tabular-nums`) are mandatory on all numeric
data** so digits align column-to-column. Eyebrows/labels are 10–11px uppercase with
wide letter-spacing.

**Spacing.** A strict **4px grid**, skewed dense. Data rows are ~28px tall; panels pad
to 24px; gaps between panels are 16px. Density is a feature — fit more signal on screen.

**Backgrounds.** Flat dark greys. **No gradients** as decoration (the one exception:
a faint radial yellow/violet glow behind hero KPIs and AI surfaces). No photographic
backgrounds, no illustrations, no textures. The data *is* the texture. Occasional
1px grid lines or faint dotted rules organize chart areas.

**Borders.** Hairline 1px borders carry most of the structure (`--border-subtle`
`#24262B` for internal dividers, `--border-default` for inputs/cards). Borders do more
work than shadows in this system. Focus borders turn yellow.

**Shadows.** Subtle, tight, dark — elevation is communicated mostly by surface value
plus a low `--shadow-md` on overlays/popovers/modals. No big soft glows except the
intentional **focus ring** (3px yellow at 28% alpha) and **AI glow** (violet).

**Corner radii.** Sharp and instrument-crisp — near-square. Inputs/badges 1px,
buttons/small cards 2px, panels 3px, modals 5px. Only true circles (status dots,
gauges, the avatar) are round; status pills, chips, and bars are squared, not
rounded. Nothing is soft — this is an instrument, not a toy.

**Cards & panels.** A panel is `--surface-1` with a 1px `--border-default`, 8px radius,
24px padding, and an optional header row with an eyebrow label + actions. No drop
shadow at rest; shadow appears only when raised (menus, dialogs). A subtle top inset
highlight (`--inset-top-light`) can add a hair of dimension.

**Data visualization — IBCS conventions.** Charts follow **IBCS** (International
Business Communication Standards), the language used by tools like Zebra BI. Data
type is encoded by *fill notation*, consistently: **solid** = actual, **muted solid**
= previous period, **hollow outline** = plan/budget, **diagonal hatch** = forecast.
Variance is shown explicitly as an **IBCS plus/minus element** — a bar from a centered
zero axis, green for favorable / red for unfavorable, with `invert` for metrics where
an increase is bad (cost, VaR, drawdown). KPI cards (`ScorecardKPI`) always pair the
actual with its variance-to-reference, not a bare number. No chart junk: minimal
gridlines, tabular figures, right-aligned numerics, scaling kept consistent across
small multiples. Charts support a **sky-blue line overlay** (target / plan / second
series) and **hover detail disclosure** — sparklines, the line chart, column charts,
limit bars, gauges and flow nodes reveal a value tooltip / detail popover on hover, and
**click pins** it open (a yellow border marks the pinned state). The full line chart
(`LineChart`) carries **circle markers at every point and elegant muted axes** (value
ticks + category labels); it measures its container so geometry never stretches.
**`ForecastChart`** extends this to IBCS forecasting: a solid actual line splits at a
"current month" divider into a three-scenario fan (optimistic / average / pessimistic)
with dashed forecast notation, a faint band, end markers, and a scenario tooltip.
`DataGrid`
also supports **hierarchical tree data with expand/collapse drilldown** (e.g. a 4-level
balance-sheet asset/liability product hierarchy). A dense visual stays glanceable but is
queryable on demand.

**Tables & grids.** Light lists use `DataTable`; heavy analytical blotters use
`DataGrid` (ag-Grid lineage) — sortable headers with carets, a frozen/pinned first
column, in-cell data bars and IBCS variance cells, optional zebra rows, and a sticky
aggregation footer. **Node-graphs** (`DriverFlow`, React Flow / ValQ lineage) render
driver and decision trees over a faint dotted canvas with smooth bezier connectors;
the critical path is highlighted yellow. Used for balance-sheet forecasting and
factor attribution.

**Motion.** Restrained and fast. Transitions are 90–150ms on `--ease-out`. Hover and
press feel instant. **No bounces, no springy easing, no decorative looping animation**
on data. Live data updates flash the changed cell briefly (up=green / down=red wash,
~240ms fade). Number tickers may roll. Respect `prefers-reduced-motion`.

**Hover states.** Surfaces lighten one step (`--surface-1` → `--surface-2`). Text/icon
buttons increase opacity/brightness. Rows highlight with `--surface-2` + a 2px left
yellow rail when selected. Links brighten to `--yellow-400`.

**Press states.** Surfaces deepen to `--surface-active` (darker, not lighter) and may
nudge translateY(0.5px). Primary buttons go to `--accent-press`. No scale-bounce.

**Transparency & blur.** Used sparingly: popover/menu backgrounds are `--surface-overlay`
with a subtle backdrop-blur; soft semantic tints (`--up-soft`, `--down-soft`,
`--yellow-soft`) fill status pills and highlighted cells. Modals dim the canvas with a
60–70% black scrim.

**Layout rules.** App shell is a fixed left icon-rail + optional secondary nav, a fixed
top command bar (global search / ticker / clock / AI launcher), and a scrollable
content grid of panels. The AI copilot docks as a right-hand panel or a command-bar
overlay. Dense tables get sticky headers and a sticky first column.

---

## ICONOGRAPHY

- **System:** **Lucide** (https://lucide.dev) — clean 1.5px-stroke line icons that match
  the crisp, technical feel. Loaded from CDN (`lucide@latest`) in cards and kits; in
  production, install the `lucide-react` package. This is a **substitution** chosen to
  fit the aesthetic — there was no source icon set to import. *Flagged for the user:
  if the real product uses a different icon set, swap here.*
- **Default size** 16px in dense UI, 14px inside table cells, 18–20px in the nav rail.
  Stroke stays 1.5px; icons inherit `currentColor` and sit at `--text-tertiary` until
  hovered/active.
- **Directional glyphs:** plain Unicode triangles `▲ ▼` (and `+`/`−`) are used inline
  for up/down deltas in numeric contexts — colored by semantic, never iconographic SVGs
  for these.
- **No emoji** anywhere in product chrome.
- **Brand mark:** a geometric "aperture" glyph (camera-iris blades forming an A) in
  brand yellow — see `assets/`. Used as the app launcher and login lockup.

---

## INDEX / MANIFEST

Root files:
- `styles.css` — global entry point (link this). `@import`s everything below.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`,
  `radii.css`, `base.css`.
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skill wrapper for downloadable use.

Foundations (Design System tab cards): under `guidelines/` — brand logo, primary &
neutral & semantic colours, type scale, tabular figures, labels, spacing, radii/shadow.

Assets: `assets/` — `logo.svg` (lockup), `mark.svg` (aperture iris app icon).

Components (`window.ApertureRiskDesignSystem_6e73e1.<Name>`):
- `components/core/` — **Button, IconButton, Badge, Input, Select, Switch, Panel, Tabs**
- `components/forms/` — **Slider** (single + range), **Checkbox, RadioGroup, NumberStepper**
- `components/data/` — **StatTile, Sparkline, LineChart, ForecastChart, LimitBar, DonutGauge,
  DataTable, Tracker**, plus the IBCS analytics set: **ScorecardKPI, ColumnChart, VarianceBar**
- `components/grid/` — **DataGrid** (ag-Grid-style: sortable headers, pinned column,
  in-cell bars, IBCS variance cells, sparkline cells, sticky totals footer)
- `components/flow/` — **DriverFlow** (React Flow / ValQ-style node-graph for
  driver / decision trees — balance-sheet forecasting, factor attribution)
- `components/ai/` — **AIInsight, AIPromptBar**

UI kits: `ui_kits/risk-terminal/` — the flagship interactive terminal (Overview,
Holdings, Scenarios, Alerts + the AI copilot rail). Open its `index.html`.

Templates (starting points for consuming projects): `templates/risk-dashboard/` —
a single-file dark portfolio-risk dashboard composed from the components.

---

## Using the system

Link the stylesheet and use the bundle:

```html
<link rel="stylesheet" href="styles.css" />
<script src="_ds_bundle.js"></script>
<script>
  const Aperture = window.ApertureRiskDesignSystem_6e73e1;
  const { Button, StatTile, DataTable } = Aperture;
</script>
```

Reference colour/space/type via the CSS custom properties — never hard-code hex.
Numbers always get `.tnum` (or `font-variant-numeric: tabular-nums`).
