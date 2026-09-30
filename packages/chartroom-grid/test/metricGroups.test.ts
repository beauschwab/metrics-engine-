/**
 * A registry metric's groups as a grid (ADR-83): the schema the binding's
 * dims and the contract's format make, and the records the interpreter's
 * rows become.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { GROUP_KEY, dimLabel, metricGroupRows, metricGroupsSchema, metricUnit } from '../src/data/metricGroups';
import { cellText } from '../src/grid/copy';
import { parseView } from '../src/grid/viewState';

const OUTFLOWS = {
  measure: 'weighted_outflows_30d', unit: 'USD', format: 'currency_usd', precision: 0,
  dims: [{ name: 'entity_id' }, { name: 'maturity_bucket' }, { name: 'product_id' }], allowed_aggregations: ['sum'],
};
const ROWS = [
  { key: { entity_id: 'WF-US', maturity_bucket: 'O/N' }, value: 4.1e8, prior: 3.9e8 },
  { key: { entity_id: 'WF-US', maturity_bucket: '2-7D' }, value: 2.7e8, prior: 2.9e8 },
  { key: { entity_id: 'WF-EMEA', maturity_bucket: 'O/N' }, value: 1.3e8, prior: 1.1e8 },
];

describe('metricGroupsSchema', () => {
  it('makes the binding\'s dims groupable dimensions, three measures in the contract\'s unit, and a key column', () => {
    const s = metricGroupsSchema(OUTFLOWS, ['entity_id', 'maturity_bucket']);
    expect(s.order).toEqual(['entity_id', 'maturity_bucket', 'value', 'prior', 'delta', GROUP_KEY]);
    expect(s.rowId).toBe(GROUP_KEY);
    expect(s.columns.entity_id).toMatchObject({ label: 'Entity id', kind: 'dimension', groupable: true });
    expect(s.columns.value).toMatchObject({ label: 'weighted_outflows_30d', kind: 'measure', unit: 'ccy', dp: 0, agg: 'sum' });
    expect(s.columns.delta).toMatchObject({ label: 'Move', negativeRed: true, agg: 'sum' });
  });

  it('a measure that does not re-aggregate by sum gets no aggregation, so its subtotal stays blank', () => {
    const s = metricGroupsSchema({ ...OUTFLOWS, measure: 'lcr_pct', unit: 'percent', format: 'percent_1dp', allowed_aggregations: [] }, ['entity_id']);
    expect(s.columns.value).toMatchObject({ unit: 'pct', dp: 1 });
    expect(s.columns.value!.agg).toBeUndefined();
  });

  it('maps the catalog\'s formats to the grid\'s units', () => {
    expect(metricUnit({ unit: 'USD', format: 'currency_usd_mm' })).toEqual({ unit: 'mm' });
    expect(metricUnit({ unit: 'USD', format: 'currency_usd' })).toEqual({ unit: 'ccy', dp: 0 });
    expect(metricUnit({ unit: 'percent', format: 'percent_2dp' })).toEqual({ unit: 'pct', dp: 2 });
    expect(metricUnit({ unit: 'number', format: 'bps' })).toEqual({ unit: 'bps', dp: 1 });
    expect(metricUnit({ unit: 'count', format: 'number' })).toEqual({ dp: 0 });
    expect(metricUnit({ unit: 'number', format: 'number', precision: 2 })).toEqual({ dp: 2 });
    expect(dimLabel('maturity_bucket')).toBe('Maturity bucket');
  });
});

describe('metricGroupRows and the table over them', () => {
  it('spreads the key into dim columns, derives the move, and keys the row by its group', () => {
    const rows = metricGroupRows(ROWS, ['entity_id', 'maturity_bucket']);
    expect(rows[0]).toEqual({ entity_id: 'WF-US', maturity_bucket: 'O/N', value: 4.1e8, prior: 3.9e8, delta: 2e7, [GROUP_KEY]: 'WF-US · O/N' });
    const schema = metricGroupsSchema(OUTFLOWS, ['entity_id', 'maturity_bucket']);
    const t = headlessTable(rows, parseView({ version: 5, grouping: ['entity_id'], expanded: true }, schema), schema);
    const us = t.getRowModel().rows.find((r) => r.getIsGrouped() && r.groupingValue === 'WF-US')!;
    expect(Number(us.getValue('value'))).toBe(6.8e8);
    expect(Number(us.getValue('delta'))).toBeCloseTo(0, 6);
    const cell = us.getAllCells().find((c) => c.column.id === 'value')!;
    expect(cellText(cell)).toBe('$680,000,000');
    expect(t.getRowModel().rows.find((r) => !r.getIsGrouped())!.id).toBe('WF-US · O/N');
  });
});
