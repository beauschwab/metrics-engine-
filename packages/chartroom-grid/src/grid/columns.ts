/**
 * The treasury columns — each one a field plus its meta, nothing else.
 *
 * Every behaviour the grid grows later (grouping, aggregation, heatmaps, the
 * xlsx number format) is a reading of the meta declared here. A column with
 * no `groupable` never appears in the group-by drop zone; a measure with no
 * `agg` shows blank on a subtotal row rather than a sum that means nothing.
 */

import { createColumnHelper } from '@tanstack/table-core';
import type { Features } from './features';
import { AGGS, FORMAT_KEYS, isScalable, type Agg, type ColumnFormat, type ColumnMeta } from './meta';
import type { Position } from '../data/mock';

const helper = createColumnHelper<Features, Position>();

/** The meta by column id — the registry `describe_view()` reports in Phase 4. */
export const COLUMN_META: Record<keyof Position, ColumnMeta> = {
  tradeId: { label: 'Trade', kind: 'dimension', band: 'Trade', width: 84 },
  asOf: { label: 'As of', kind: 'dimension', unit: 'date', band: 'Trade', width: 96 },
  desk: { label: 'Desk', kind: 'dimension', groupable: true, band: 'Book', width: 92 },
  legalEntity: { label: 'Entity', kind: 'dimension', groupable: true, band: 'Book', width: 84 },
  currency: { label: 'Ccy', kind: 'dimension', groupable: true, band: 'Instrument', width: 60 },
  product: { label: 'Product', kind: 'dimension', groupable: true, band: 'Instrument', width: 80 },
  tenorBucket: { label: 'Tenor', kind: 'dimension', groupable: true, band: 'Instrument', width: 64 },
  counterparty: { label: 'Counterparty', kind: 'dimension', groupable: true, band: 'Instrument', width: 104 },
  book: { label: 'Book', kind: 'dimension', groupable: true, band: 'Book', width: 68 },
  notional: { label: 'Notional', kind: 'measure', unit: 'mm', agg: 'sum', heatmap: true, band: 'Exposure', width: 104 },
  mtm: { label: 'MTM', kind: 'measure', unit: 'mm', dp: 2, agg: 'sum', negativeRed: true, band: 'Exposure', width: 96 },
  dv01: { label: 'DV01', kind: 'measure', unit: 'ccy', agg: 'sum', negativeRed: true, band: 'Risk', width: 104 },
  cs01: { label: 'CS01', kind: 'measure', unit: 'ccy', agg: 'sum', negativeRed: true, band: 'Risk', width: 104 },
  yield: { label: 'Yield', kind: 'measure', unit: 'pct', dp: 2, agg: 'wavg', weightBy: 'notional', band: 'Return', width: 76 },
  wal: { label: 'WAL', kind: 'measure', unit: 'years', agg: 'wavg', weightBy: 'notional', band: 'Return', width: 72 },
};

/** Display order: the dimensions a reader scans by, then the measures. */
export const COLUMN_ORDER: Array<keyof Position> = [
  'desk', 'legalEntity', 'book', 'currency', 'product', 'tenorBucket', 'counterparty',
  'tradeId', 'asOf', 'notional', 'mtm', 'dv01', 'cs01', 'yield', 'wal',
];

/**
 * The selection column: structural, not a field, so it lives beside the
 * data columns rather than in `COLUMN_META` — the view never names it (it
 * cannot be hidden, ordered, grouped, pinned or sized), and the hook pins
 * it at the start (ADR-68). Its cell is the checkbox `GridTable` renders.
 */
export const SELECT_ID = 'select';
export const selectColumn = helper.display({
  id: SELECT_ID,
  header: '',
  size: 32,
  enableSorting: false,
  enableGrouping: false,
  enableHiding: false,
  enableResizing: false,
  enablePinning: false,
});

/** A view's per-column aggregation overrides (ADR-72). */
export type ColumnAggs = Partial<Record<keyof Position, Agg>>;

/** The aggregation a measure takes: the view's choice, else the meta's. */
export function effectiveAgg(id: keyof Position, aggs?: ColumnAggs): Agg | undefined {
  const meta = COLUMN_META[id];
  if (meta.kind !== 'measure') return undefined;
  return aggs?.[id] ?? meta.agg;
}

/** The aggregations a measure may take: `wavg` only where the meta names a weight. */
export function allowedAggs(id: keyof Position): Agg[] {
  const meta = COLUMN_META[id];
  if (meta.kind !== 'measure') return [];
  return AGGS.filter((a) => a !== 'wavg' || !!meta.weightBy);
}

export type ColumnFormats = Partial<Record<keyof Position, ColumnFormat>>;

/** The format keys a column can take: a measure's readings, a dollar column's scale (ADR-74). */
export function allowedFormatKeys(id: keyof Position): readonly (keyof ColumnFormat)[] {
  const meta = COLUMN_META[id];
  if (meta.kind !== 'measure') return [];
  return FORMAT_KEYS.filter((k) => k !== 'scale' || isScalable(meta));
}

/**
 * The meta a column carries for a view: the declared meta with the view's
 * format on top, so every reader — cell, footer, copy, export — formats
 * through the same object and never asks who chose what.
 */
export function effectiveMeta(id: keyof Position, formats?: ColumnFormats): ColumnMeta {
  const meta = COLUMN_META[id];
  const format = formats?.[id];
  if (!format) return meta;
  const keys = allowedFormatKeys(id).filter((k) => format[k] !== undefined);
  if (keys.length === 0) return meta;
  const out: ColumnMeta = { ...meta };
  for (const k of keys) (out as unknown as Record<string, unknown>)[k] = format[k];
  return out;
}

/** The column definitions for a view: the same columns, the view's aggregations and formats. */
export function buildColumns(aggs: ColumnAggs = {}, formats: ColumnFormats = {}) {
  return helper.columns(
    COLUMN_ORDER.map((id) => {
      const meta = effectiveMeta(id, formats);
      return helper.accessor(id, {
        header: meta.label,
        meta,
        size: meta.width,
        enableGrouping: meta.kind === 'dimension' && !!meta.groupable,
        // Every aggregation the meta or the view names is registered (`wavg`
        // since Phase 2, ADR-67); a measure without one leaves a subtotal
        // blank — ADR-44.
        aggregationFn: effectiveAgg(id, aggs),
        // A dimension filters as a set ("value is one of these"); a measure as
        // an inclusive range with open ends. Both read the meta's kind, not a
        // per-feature list — the set filter and the number filter (Phase 3)
        // are the UI over these.
        filterFn: meta.kind === 'dimension' ? 'arrHas' : 'inNumberRange',
        // Measures sort numerically — a grouped row's aggregate is a Number
        // object (ADR-67), which `basic` compares by value.
        sortFn: meta.kind === 'measure' ? 'basic' : 'alphanumeric',
      });
    }),
  );
}

/** The columns with the meta's own aggregations. */
export const columns = buildColumns();
