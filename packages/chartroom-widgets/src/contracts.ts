/**
 * The widget catalog — versioned contracts, as data.
 *
 * This module is importable by the server (for lint context and the catalog
 * API) without dragging React along: contracts are the part of a widget that
 * is *governed*, and governance code must not depend on rendering code. The
 * components live next door and are only ever imported by the studio.
 *
 * A contract is validated by Zod in this package's tests, so a malformed
 * catalog entry fails CI rather than failing a lint run at 6pm.
 */

import type { WidgetContract } from 'chartroom-spec';

export const CATALOG: WidgetContract[] = [
  {
    widget: 'kpi-tile', version: 1, family: 'kpi',
    accepts: { supports: ['compare', 'filters'] },
    guide_rules: ['KPI-02', 'NUM-01'],
    description: 'One number, judged: the as-of value with its comparison — '
      + 'a limit, the prior period — and the delta said in words.',
  },
  {
    widget: 'timeseries', version: 1, family: 'timeseries',
    accepts: {
      requires_time_dim: true, max_series: 8,
      categorical_dims: { min: 0, max: 1 },
      supports: ['bands', 'compare', 'window', 'filters'],
    },
    guide_rules: ['TS-01', 'TS-02'],
    description: 'A line over the daily series, optionally split by one '
      + 'categorical dim and banded by a reference metric.',
  },
  {
    widget: 'bar', version: 1, family: 'bar',
    accepts: { categorical_dims: { min: 1, max: 1 }, supports: ['sort', 'filters'] },
    guide_rules: ['BAR-02'],
    description: 'The as-of value split by one dimension. Sorted by value '
      + 'unless the dimension is ordinal — the guide decides, not the author.',
  },
  {
    widget: 'delta-table', version: 1, family: 'table',
    accepts: { categorical_dims: { min: 1, max: 2 }, supports: ['filters'] },
    guide_rules: ['NUM-01'],
    description: 'Value, prior value, and the day-over-day move per group — '
      + 'the variance monitor’s reading habit, as a widget.',
  },
  {
    // Host-rendered (ADR-83): the treasury grid draws this one in the
    // studio; the widgets package carries the contract, never the renderer.
    widget: 'grid', version: 1, family: 'grid', renderer: 'host',
    // `window` gives the value a history to draw as a trend, and a threshold
    // `compare` the limit its band draws against (ADR-89).
    accepts: { categorical_dims: { min: 1, max: 4 }, supports: ['max_cells', 'filters', 'sort', 'window', 'compare'] },
    guide_rules: ['GRID-01', 'AGG-01', 'NUM-01'],
    description: 'The metric’s groups as a working table: group, sort, filter, '
      + 'pivot and format the rows, calculate a column, copy a block, draw '
      + 'each group’s trend over the window — the reader’s arrangement kept '
      + 'in the widget’s state. Totals sum, so AGG-01 keeps a ratio out of it.',
  },
  {
    widget: 'perspective-grid', version: 1, family: 'grid',
    accepts: { categorical_dims: { min: 1, max: 4 }, supports: ['max_cells', 'filters'] },
    guide_rules: ['GRID-01'],
    description: 'A pivot over up to four dims, aggregates only, with a '
      + 'mandatory cell ceiling. (Native renderer in Phase 1 — ADR-9.)',
  },

  // ---- Phase 9 (E9.1) ------------------------------------------------------

  {
    // part_to_whole, not timeseries: PIE-01 was written for exactly this
    // widget ("the part-to-whole family that *will* ship"), and its
    // slice-count judgment applies to bands over time as much as to slices.
    widget: 'stacked-area', version: 1, family: 'part_to_whole',
    accepts: {
      requires_time_dim: true, max_series: 8,
      categorical_dims: { min: 1, max: 1 },
      supports: ['window', 'filters'],
    },
    guide_rules: ['AREA-01', 'PIE-01', 'TS-01'],
    description: 'Part-to-whole over time: one band per category, stacked to '
      + 'the total. Only for nonnegative additive measures — AREA-01 blocks '
      + 'the rest, because a stack of ratios totals to nothing meaningful.',
  },
  {
    widget: 'waterfall', version: 1, family: 'waterfall',
    accepts: { categorical_dims: { min: 1, max: 1 }, supports: ['filters'] },
    guide_rules: ['WF-01', 'NUM-01'],
    description: 'The bridge from prior to current: each category’s move as a '
      + 'floating bar between two totals. WF-01 holds the arithmetic — the '
      + 'contributions must actually sum to the change they claim to explain.',
  },
  {
    widget: 'small-multiples', version: 1, family: 'timeseries',
    accepts: {
      requires_time_dim: true, max_series: 12,
      categorical_dims: { min: 1, max: 1 },
      supports: ['window', 'filters'],
    },
    guide_rules: ['SM-01', 'TS-01'],
    description: 'One small chart per category, on a shared scale so the '
      + 'panels compare by eye. SM-01 is the shared scale as a rule: '
      + 'per-panel scaling makes a flat line and a cliff look alike.',
  },
  {
    widget: 'heatmap', version: 1, family: 'heatmap',
    accepts: { categorical_dims: { min: 2, max: 2 }, supports: ['max_cells', 'filters'] },
    guide_rules: ['GRID-01', 'COL-03'],
    description: 'Two dims crossed, value as intensity — for spotting where '
      + 'in a matrix something concentrates, before asking what it is.',
  },
  {
    widget: 'distribution', version: 1, family: 'bar',
    accepts: { categorical_dims: { min: 1, max: 1 }, supports: ['filters'] },
    guide_rules: ['NUM-01'],
    description: 'How the groups are spread: value-ordered bins with the '
      + 'median marked. The shape question — is this one outlier or a tail? — '
      + 'that a sorted bar chart answers only by counting.',
  },
  {
    widget: 'bullet', version: 1, family: 'kpi',
    accepts: { supports: ['compare', 'filters'] },
    guide_rules: ['GAUGE-01', 'KPI-02', 'NUM-01'],
    description: 'One measure against its limit: the value as a bar, the '
      + 'threshold as a marker. GAUGE-01 requires the threshold be a registry '
      + 'metric ref — a hardcoded number is a limit nobody governs.',
  },
  {
    widget: 'annotation', version: 1, family: 'annotation',
    accepts: { supports: ['filters'] },
    guide_rules: ['NUM-01'],
    description: 'Author commentary beside the number it is about. The note '
      + 'binds a metric, so when that metric’s revision moves the upgrade '
      + 'notice names the stale commentary too.',
  },

  // ---- Sparklines (ADR-89) -------------------------------------------------
  // One number and its window, four questions. `timeseries` because they are
  // lines (or columns) over days: TS-01 holds the time dim and TS-02 the one
  // series a card can carry. The style is the type, so a rule can hold each
  // card to its question — GAUGE-01 to the band's limit.

  {
    widget: 'spark-line', version: 1, family: 'timeseries',
    accepts: {
      requires_time_dim: true, max_series: 1,
      categorical_dims: { min: 0, max: 0 },
      supports: ['window', 'filters'],
    },
    guide_rules: ['TS-01', 'TS-02', 'NUM-01'],
    description: 'The latest value with the line that led to it: where the '
      + 'number is heading, the move since the window opened said in words, '
      + 'and any day read off the line by pointer or arrow key.',
  },
  {
    widget: 'spark-band', version: 1, family: 'timeseries',
    accepts: {
      requires_time_dim: true, max_series: 1,
      categorical_dims: { min: 0, max: 0 },
      supports: ['compare', 'window', 'filters'],
    },
    guide_rules: ['GAUGE-01', 'TS-01', 'TS-02', 'NUM-01'],
    description: 'The line against its limit: the breach side shaded, each '
      + 'breaching day marked and named. GAUGE-01 holds the limit to a governed '
      + 'registry metric with a declared safe side.',
  },
  {
    widget: 'spark-column', version: 1, family: 'timeseries',
    accepts: {
      requires_time_dim: true, max_series: 1,
      categorical_dims: { min: 0, max: 0 },
      supports: ['window', 'filters'],
    },
    guide_rules: ['TS-01', 'TS-02', 'NUM-01'],
    description: 'One column per day from zero, so each day reads as a length '
      + '— the right shape for a daily move, where the sign is the story.',
  },
  {
    widget: 'spark-range', version: 1, family: 'timeseries',
    accepts: {
      requires_time_dim: true, max_series: 1,
      categorical_dims: { min: 0, max: 0 },
      supports: ['window', 'filters'],
    },
    guide_rules: ['TS-01', 'TS-02', 'NUM-01'],
    description: 'Where today sits in its own history: every day of the window '
      + 'as a tick from its low to its high, today emphasised and placed in words.',
  },

  // ---- Evil Charts (ADR-92) -------------------------------------------------
  // Charts a reader adds to the board from a grid selection, drawn by the
  // landed Evil Charts source in `chartroom-charts` — host-rendered, like the
  // grid: this package carries the contracts, never the renderers. A family
  // is the claim the linter keys off, so each sits where its judgment lives:
  // a bar by a dimension is a `bar` (BAR-02 orders it), lines over the window
  // are `timeseries` (TS-01/TS-02), and anything that adds parts into a whole —
  // a stack, a pie, a flow — is `part_to_whole`, where AREA-01 holds the
  // measure to sum and PIE-01 the parts to five. Appearance (fill, curve,
  // stroke, arc) is renderer-owned state; meaning is never an option.

  {
    widget: 'evil-bar', version: 1, family: 'bar', renderer: 'host',
    accepts: { categorical_dims: { min: 1, max: 2 }, max_series: 8, supports: ['sort', 'filters'] },
    guide_rules: ['BAR-02', 'NUM-01'],
    description: 'The value per group as bars — upright or across, six fills — '
      + 'or grouped side by side by a second dimension. Biggest first unless '
      + 'the dimension is ordinal.',
  },
  {
    widget: 'evil-stacked-bar', version: 1, family: 'part_to_whole', renderer: 'host',
    // The parts lead the dims — PIE-01 counts the first categorical one — and the axis follows.
    accepts: { categorical_dims: { min: 2, max: 2 }, max_series: 5, supports: ['sort', 'filters'] },
    guide_rules: ['AREA-01', 'PIE-01', 'NUM-01'],
    description: 'Each bar the sum of its parts, or every bar to 100% with the '
      + 'parts as shares. dims: [the parts, the axis].',
  },
  {
    widget: 'evil-composed', version: 1, family: 'bar', renderer: 'host',
    accepts: { categorical_dims: { min: 1, max: 1 }, supports: ['sort', 'filters'] },
    guide_rules: ['BAR-02', 'NUM-01'],
    description: 'The as-of value per group as bars with the prior close drawn '
      + 'over them as a line — the move per group on one axis.',
  },
  {
    widget: 'evil-line', version: 1, family: 'timeseries', renderer: 'host',
    accepts: {
      requires_time_dim: true, max_series: 8,
      categorical_dims: { min: 0, max: 1 },
      supports: ['window', 'filters'],
    },
    guide_rules: ['TS-01', 'TS-02', 'NUM-01'],
    description: 'Each group as a line over the window: four curves, three '
      + 'strokes, point markers and glow.',
  },
  {
    widget: 'evil-area', version: 1, family: 'timeseries', renderer: 'host',
    accepts: {
      requires_time_dim: true, max_series: 8,
      categorical_dims: { min: 0, max: 1 },
      supports: ['window', 'filters'],
    },
    guide_rules: ['TS-01', 'TS-02', 'NUM-01'],
    description: 'Each group as a filled line over the window, overlapping and '
      + 'never summed — six fills.',
  },
  {
    widget: 'evil-stacked-area', version: 1, family: 'part_to_whole', renderer: 'host',
    accepts: {
      requires_time_dim: true, max_series: 5,
      categorical_dims: { min: 1, max: 1 },
      supports: ['window', 'filters'],
    },
    guide_rules: ['AREA-01', 'PIE-01', 'TS-01', 'NUM-01'],
    description: 'The groups stacked over the window, the top edge their total '
      + '— or every day to 100%.',
  },
  {
    widget: 'evil-pie', version: 1, family: 'part_to_whole', renderer: 'host',
    accepts: { categorical_dims: { min: 1, max: 1 }, max_series: 5, supports: ['sort', 'filters'] },
    guide_rules: ['AREA-01', 'PIE-01', 'NUM-01'],
    description: 'Each group’s share of the whole, as a pie or a donut — five '
      + 'parts at most, and only of a measure that sums.',
  },
  {
    widget: 'evil-radial', version: 1, family: 'bar', renderer: 'host',
    accepts: { categorical_dims: { min: 1, max: 1 }, supports: ['sort', 'filters'] },
    guide_rules: ['BAR-02', 'NUM-01'],
    description: 'The value per group as rings, the biggest the full sweep — a '
      + 'full circle or a half.',
  },
  {
    widget: 'evil-radar', version: 1, family: 'bar', renderer: 'host',
    accepts: { categorical_dims: { min: 1, max: 2 }, max_series: 8, supports: ['sort', 'filters'] },
    guide_rules: ['BAR-02', 'NUM-01'],
    description: 'The groups as spokes, the value as the reach — a profile’s '
      + 'shape; a second dimension overlays one shape per value. Three spokes or more.',
  },
  {
    widget: 'evil-sankey', version: 1, family: 'part_to_whole', renderer: 'host',
    accepts: { categorical_dims: { min: 2, max: 2 }, supports: ['filters'] },
    guide_rules: ['AREA-01', 'PIE-01', 'NUM-01'],
    description: 'From one dimension’s values to another’s, each link as wide '
      + 'as its value — the flow of a measure that sums.',
  },
];

export const CATALOG_BY_REF: Map<string, WidgetContract> = new Map(
  CATALOG.map((c) => [`${c.widget}@${c.version}`, c]),
);
