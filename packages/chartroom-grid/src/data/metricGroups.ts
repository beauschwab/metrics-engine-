/**
 * A registry metric's groups as a grid (ADR-83): the dashboard interpreter
 * answers a widget's binding with one row per group — the dims' values as
 * the key, the measure's value and its prior — and this module turns that
 * answer into what the grid reads: a schema whose dimensions are the
 * binding's dims and whose measures are the value, the prior and the
 * move, with the unit the contract's `format` names (NUM-01: the unit is
 * the function's, never the widget's), and records keyed by the group.
 *
 * A measure aggregates by sum only where the contract says it may — a
 * ratio's subtotal stays blank rather than a sum of ratios (ADR-67), and
 * AGG-01 keeps such a metric off a grid in the first place.
 */

import type { ColumnMeta, Unit } from '../grid/meta';
import { schemaFromColumns, type GridRecord, type GridSchema } from '../grid/schema';

/** What the grid needs to know about the metric — the studio's contract summary has it. */
export interface MetricShape {
  measure: string;
  unit: string;
  format: string;
  precision?: number;
  /** A dim with `ordinal` and its `values` reads in that order (ADR-84). */
  dims: ReadonlyArray<{ name: string; ordinal?: boolean; values?: readonly string[] }>;
  allowed_aggregations?: readonly string[];
}

/** The unit and decimals a metric's format reads in, in the grid's vocabulary. */
export function metricUnit(shape: Pick<MetricShape, 'unit' | 'format' | 'precision'>): { unit?: Unit; dp?: number } {
  if (shape.format === 'currency_usd_mm') return { unit: 'mm' };
  if (shape.format === 'currency_usd' || shape.unit === 'USD') return { unit: 'ccy', dp: 0 };
  const pct = /^percent_(\d)dp$/.exec(shape.format);
  if (pct) return { unit: 'pct', dp: Number(pct[1]) };
  if (shape.unit === 'percent') return { unit: 'pct', dp: shape.precision ?? 2 };
  if (shape.format === 'bps') return { unit: 'bps', dp: shape.precision ?? 1 };
  if (shape.unit === 'count') return { dp: 0 };
  return { dp: shape.precision ?? 0 };
}

/** A dim's label: `entity_id` reads as "Entity id". */
export const dimLabel = (name: string): string => {
  const words = name.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The key column that identifies a group row. */
export const GROUP_KEY = 'key';

/** The grid schema for a metric's groups over the binding's dims. */
export function metricGroupsSchema(shape: MetricShape, dims: readonly string[]): GridSchema {
  const { unit, dp } = metricUnit(shape);
  const sums = !shape.allowed_aggregations || shape.allowed_aggregations.includes('sum');
  const measure = (id: string, label: string, extra: Partial<ColumnMeta> = {}): { id: string; meta: ColumnMeta } => ({
    id, meta: { label, kind: 'measure', unit, dp, agg: sums ? 'sum' : undefined, band: shape.measure, width: 110, ...extra },
  });
  const columns = [
    ...dims.map((d) => {
      const contract = shape.dims.find((x) => x.name === d);
      const order = contract?.ordinal && contract.values?.length ? [...contract.values] : undefined;
      return { id: d, meta: { label: dimLabel(d), kind: 'dimension', groupable: true, order, band: 'Group', width: 110 } as ColumnMeta };
    }),
    measure('value', shape.measure),
    measure('prior', 'Prior'),
    measure('delta', 'Move', { negativeRed: true }),
    { id: GROUP_KEY, meta: { label: 'Group', kind: 'dimension', band: 'Group', width: 160 } as ColumnMeta },
  ];
  return schemaFromColumns(columns, GROUP_KEY);
}

/** The interpreter's group rows as grid records: the key's dims spread into columns, the move derived. */
export function metricGroupRows(rows: ReadonlyArray<{ key: Record<string, string>; value: number; prior: number }>, dims: readonly string[]): GridRecord[] {
  return rows.map((r) => ({
    ...Object.fromEntries(dims.map((d) => [d, r.key[d] ?? ''])),
    value: r.value,
    prior: r.prior,
    delta: r.value - r.prior,
    [GROUP_KEY]: dims.map((d) => r.key[d] ?? '').join(' · '),
  }));
}
