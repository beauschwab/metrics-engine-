/**
 * The treasury columns — each one a field plus its meta, nothing else.
 *
 * Every behaviour the grid grows later (grouping, aggregation, heatmaps, the
 * xlsx number format) is a reading of the meta declared here. A column with
 * no `groupable` never appears in the group-by drop zone; a measure with no
 * `agg` shows blank on a subtotal row rather than a sum that means nothing.
 */

import { createColumnHelper } from '@tanstack/react-table';
import type { Features } from './features';
import type { ColumnMeta } from './meta';
import type { Position } from '../data/mock';

const helper = createColumnHelper<Features, Position>();

/** The meta by column id — the registry `describe_view()` reports in Phase 4. */
export const COLUMN_META: Record<keyof Position, ColumnMeta> = {
  tradeId: { label: 'Trade', kind: 'dimension' },
  asOf: { label: 'As of', kind: 'dimension', unit: 'date' },
  desk: { label: 'Desk', kind: 'dimension', groupable: true },
  legalEntity: { label: 'Entity', kind: 'dimension', groupable: true },
  currency: { label: 'Ccy', kind: 'dimension', groupable: true },
  product: { label: 'Product', kind: 'dimension', groupable: true },
  tenorBucket: { label: 'Tenor', kind: 'dimension', groupable: true },
  counterparty: { label: 'Counterparty', kind: 'dimension', groupable: true },
  book: { label: 'Book', kind: 'dimension', groupable: true },
  notional: { label: 'Notional', kind: 'measure', unit: 'mm', agg: 'sum', heatmap: true },
  mtm: { label: 'MTM', kind: 'measure', unit: 'mm', dp: 2, agg: 'sum', negativeRed: true },
  dv01: { label: 'DV01', kind: 'measure', unit: 'ccy', agg: 'sum', negativeRed: true },
  cs01: { label: 'CS01', kind: 'measure', unit: 'ccy', agg: 'sum', negativeRed: true },
  yield: { label: 'Yield', kind: 'measure', unit: 'pct', dp: 2, agg: 'wavg', weightBy: 'notional' },
  wal: { label: 'WAL', kind: 'measure', unit: 'years', agg: 'wavg', weightBy: 'notional' },
};

/** Display order: the dimensions a reader scans by, then the measures. */
export const COLUMN_ORDER: Array<keyof Position> = [
  'desk', 'legalEntity', 'currency', 'product', 'tenorBucket', 'counterparty', 'book',
  'tradeId', 'asOf', 'notional', 'mtm', 'dv01', 'cs01', 'yield', 'wal',
];

export const columns = helper.columns(
  COLUMN_ORDER.map((id) => {
    const meta = COLUMN_META[id];
    return helper.accessor(id, {
      header: meta.label,
      meta,
      enableGrouping: meta.kind === 'dimension' && !!meta.groupable,
      // `wavg` is registered in Phase 2; until then a weighted column has no
      // aggregation and a subtotal row leaves it blank — honest, per ADR-44.
      aggregationFn: meta.agg && meta.agg !== 'wavg' ? meta.agg : undefined,
    });
  }),
);
