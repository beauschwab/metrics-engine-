/**
 * Pivot mode (ADR-80): one dimension across the top, each measure under each
 * of its values, aggregating as the measure does within the bucket.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { generatePositions, type Position } from '../src/data/mock';
import { weightedAverage } from '../src/grid/aggregations';
import { buildColumns, pivotMeasures } from '../src/grid/columns';
import { distinctValues, parsePivotId, pivotBuckets, pivotId, pivotValue } from '../src/grid/pivot';
import { parseView } from '../src/grid/viewState';

const BOOK = generatePositions(2000);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

describe('pivot ids and values', () => {
  it('names a column by measure and value, reads the distinct values in order, and buckets a row', () => {
    expect(pivotId('notional', 'EUR')).toBe('p:notional:EUR');
    expect(parsePivotId('p:notional:EUR')).toEqual({ measure: 'notional', value: 'EUR' });
    expect(parsePivotId('p:x')).toBeUndefined();
    expect(parsePivotId('notional')).toBeUndefined();
    const ccys = distinctValues(BOOK, 'currency');
    expect(ccys.length).toBeGreaterThan(3);
    expect([...ccys].sort()).toEqual(ccys);
    const row = BOOK[0]!;
    expect(pivotValue(row, 'currency', 'notional', row.currency)).toBe(row.notional);
    expect(pivotValue(row, 'currency', 'notional', 'no-such-ccy')).toBeUndefined();
    expect(pivotMeasures({ column: 'currency', values: [] })).toEqual(['notional', 'mtm', 'dv01', 'cs01', 'yield', 'wal']);
    expect(pivotMeasures({ column: 'currency', values: ['yield', 'notional'] })).toEqual(['notional', 'yield']);
    expect(pivotMeasures({ column: null, values: ['yield'] })).toEqual([]);
  });

  it('builds one column per value per measure, banded by the value, with the pivoted measures under Total', () => {
    const cols = buildColumns({}, {}, [], { column: 'currency', values: ['notional', 'yield'], distinct: ['EUR', 'USD'] });
    const idOf = (c: unknown) => { const x = c as { id?: string; accessorKey?: string }; return x.id ?? x.accessorKey; };
    const ids = cols.map(idOf);
    expect(ids.slice(0, 9)).toEqual(['desk', 'legalEntity', 'book', 'currency', 'product', 'tenorBucket', 'counterparty', 'tradeId', 'asOf']);
    expect(ids).toContain('p:notional:EUR');
    expect(ids).toContain('p:yield:USD');
    expect(ids.indexOf('p:notional:EUR')).toBeLessThan(ids.indexOf('p:notional:USD'));
    expect(ids.indexOf('p:yield:USD')).toBeLessThan(ids.indexOf('notional'));
    const eur = cols.find((c) => idOf(c) === 'p:yield:EUR')!;
    expect(eur.meta).toMatchObject({ label: 'Yield', unit: 'pct', band: 'EUR', pivot: true, weightBy: 'notional' });
    expect(cols.find((c) => idOf(c) === 'notional')!.meta?.band).toBe('Total');
    expect(cols.find((c) => idOf(c) === 'mtm')!.meta?.band).toBe('Exposure');
  });
});

describe('a pivot column aggregates as its measure does, within the bucket', () => {
  const view = parseView({ version: 5, grouping: ['desk'], expanded: true, pivot: { column: 'currency', values: ['notional', 'yield', 'mtm'] }, columnAggs: { mtm: 'count' } });

  it('subtotals and the grand total equal brute force: a sum, a weighted average, a count', () => {
    const t = headlessTable(BOOK, view);
    const groups = t.getRowModel().rows.filter((r) => r.getIsGrouped());
    const ccys = distinctValues(BOOK, 'currency');
    expect(t.getColumn(pivotId('notional', ccys[0]!))).toBeDefined();
    for (const g of groups.slice(0, 3)) {
      const leaves = g.getLeafRows().filter((r) => !r.getIsGrouped()).map((r) => r.original as Position);
      for (const ccy of ccys.slice(0, 3)) {
        const bucket = leaves.filter((p) => p.currency === ccy);
        expect(num(g.getValue(pivotId('notional', ccy)))).toBeCloseTo(sum(bucket.map((p) => p.notional)), 6);
        const expectedYield = weightedAverage(bucket.map((p) => p.yield), bucket.map((p) => p.notional));
        const gotYield = g.getValue(pivotId('yield', ccy));
        if (expectedYield === undefined) expect(Number.isNaN(num(gotYield)) || gotYield === undefined).toBe(true);
        else expect(num(gotYield)).toBeCloseTo(expectedYield, 9);
        expect(num(g.getValue(pivotId('mtm', ccy)))).toBe(bucket.length);
      }
    }
    const ccy = ccys[1]!;
    const all = BOOK.filter((p) => p.currency === ccy);
    expect(num(t.getColumn(pivotId('notional', ccy))!.getAggregationValue())).toBeCloseTo(sum(all.map((p) => p.notional)), 6);
    expect(num(t.getColumn(pivotId('yield', ccy))!.getAggregationValue())).toBeCloseTo(weightedAverage(all.map((p) => p.yield), all.map((p) => p.notional))!, 9);
  });

  it('a leaf row shows the measure only in its own bucket, and sorts by a bucket', () => {
    const t = headlessTable(BOOK, parseView({ version: 5, pivot: { column: 'currency', values: ['notional'] }, sorting: [{ id: 'p:notional:EUR', desc: true }] }));
    const first = t.getRowModel().rows[0]!.original as Position;
    expect(first.currency).toBe('EUR');
    const row = t.getRowModel().rows.find((r) => (r.original as Position).currency !== 'EUR')!;
    expect(row.getValue('p:notional:EUR')).toBeUndefined();
    expect(row.getValue(pivotId('notional', (row.original as Position).currency))).toBe((row.original as Position).notional);
  });
});

describe('the buckets a pivot lays across the top (ADR-86)', () => {
  it('are the chosen values, else every value, in the dimension\'s order', () => {
    expect(pivotBuckets({ column: 'currency', values: [], buckets: [] }, ['USD', 'EUR'])).toEqual(['USD', 'EUR']);
    expect(pivotBuckets({ column: 'currency', values: [], buckets: ['EUR'] }, ['USD', 'EUR'])).toEqual(['EUR']);
    expect(pivotBuckets({ column: 'tenorBucket', values: [], buckets: ['10Y+', 'O/N'] }, ['1M'], ['O/N', '1M', '10Y+'])).toEqual(['O/N', '10Y+']);
  });

  it('restrict the table to those columns and leave the totals under the Total band', () => {
    const t = headlessTable(BOOK, parseView({ version: 6, pivot: { column: 'currency', values: ['notional'], buckets: ['GBP', 'EUR'] } }));
    const ids = t.getAllLeafColumns().map((c) => c.id).filter((id) => id.startsWith('p:'));
    expect(ids).toEqual(['p:notional:GBP', 'p:notional:EUR']);
    expect(t.getColumn('notional')!.columnDef.meta?.band).toBe('Total');
  });
});
