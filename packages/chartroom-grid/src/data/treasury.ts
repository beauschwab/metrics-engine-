/**
 * The treasury book's schema — the one the harness, the mock generator and
 * the SQL sources serve by default (ADR-64, ADR-82). Every behaviour the grid
 * has is a reading of the meta declared here: a column with no `groupable`
 * never appears in the group-by zone; a measure with no `agg` shows blank on
 * a subtotal rather than a sum that means nothing.
 */

import type { ColumnMeta } from '../grid/meta';
import type { GridSchema } from '../grid/schema';
import { DV01_LIMIT, TENORS, type Position } from './mock';

export const TREASURY_META: Record<keyof Position, ColumnMeta> = {
  tradeId: { label: 'Trade', kind: 'dimension', band: 'Trade', width: 84 },
  asOf: { label: 'As of', kind: 'dimension', unit: 'date', band: 'Trade', width: 96 },
  desk: { label: 'Desk', kind: 'dimension', groupable: true, band: 'Book', width: 92 },
  legalEntity: { label: 'Entity', kind: 'dimension', groupable: true, band: 'Book', width: 84 },
  currency: { label: 'Ccy', kind: 'dimension', groupable: true, band: 'Instrument', width: 60 },
  product: { label: 'Product', kind: 'dimension', groupable: true, band: 'Instrument', width: 80 },
  tenorBucket: { label: 'Tenor', kind: 'dimension', groupable: true, order: TENORS, band: 'Instrument', width: 64 },
  counterparty: { label: 'Counterparty', kind: 'dimension', groupable: true, band: 'Instrument', width: 104 },
  book: { label: 'Book', kind: 'dimension', groupable: true, band: 'Book', width: 68 },
  notional: { label: 'Notional', kind: 'measure', unit: 'mm', agg: 'sum', heatmap: true, band: 'Exposure', width: 104 },
  // MTM and DV01 carry a history the harness supplies (ADR-89); DV01's trend
  // can be read against the per-trade sensitivity limit the book governs.
  mtm: { label: 'MTM', kind: 'measure', unit: 'mm', dp: 2, agg: 'sum', negativeRed: true, band: 'Exposure', width: 96, history: true },
  dv01: {
    label: 'DV01', kind: 'measure', unit: 'ccy', agg: 'sum', negativeRed: true, band: 'Risk', width: 104,
    history: true, limit: { value: DV01_LIMIT, side: 'ceiling', label: 'trade DV01 limit' },
  },
  cs01: { label: 'CS01', kind: 'measure', unit: 'ccy', agg: 'sum', negativeRed: true, band: 'Risk', width: 104 },
  yield: { label: 'Yield', kind: 'measure', unit: 'pct', dp: 2, agg: 'wavg', weightBy: 'notional', band: 'Return', width: 76 },
  wal: { label: 'WAL', kind: 'measure', unit: 'years', agg: 'wavg', weightBy: 'notional', band: 'Return', width: 72 },
};

/** Display order: the dimensions a reader scans by, then the measures. */
export const TREASURY_ORDER: Array<keyof Position> = [
  'desk', 'legalEntity', 'book', 'currency', 'product', 'tenorBucket', 'counterparty',
  'tradeId', 'asOf', 'notional', 'mtm', 'dv01', 'cs01', 'yield', 'wal',
];

export const TREASURY_SCHEMA: GridSchema = { columns: TREASURY_META, order: [...TREASURY_ORDER], rowId: 'tradeId' };
