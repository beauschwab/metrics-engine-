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
];

export const CATALOG_BY_REF: Map<string, WidgetContract> = new Map(
  CATALOG.map((c) => [`${c.widget}@${c.version}`, c]),
);
