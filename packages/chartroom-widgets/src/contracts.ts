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
];

export const CATALOG_BY_REF: Map<string, WidgetContract> = new Map(
  CATALOG.map((c) => [`${c.widget}@${c.version}`, c]),
);
