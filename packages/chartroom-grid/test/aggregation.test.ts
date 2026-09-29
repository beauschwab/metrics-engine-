/**
 * Phase 2's tests, written before its UI (ADR-67): the weighted average
 * matches brute force at every level of a nested grouping, every subtotal
 * is the sum of its children and the grand total the sum of the subtotals,
 * and a filter changes the subtotals to match the rows that remain.
 */

import { describe, expect, it } from 'vitest';
import { constructTable, tableFeatures, type ColumnDef, type Row } from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import { aggregatedNumber, weightedAverage, Wavg } from '../src/grid/aggregations';
import { COLUMN_META, columns } from '../src/grid/columns';
import { features } from '../src/grid/features';
import { parseView, type ViewState } from '../src/grid/viewState';
import { generatePositions, type Position } from '../src/data/mock';

const headless = tableFeatures({ ...features, coreReactivityFeature: storeReactivityBindings() });
type Headless = typeof headless;
type R = Row<Headless, Position>;

const DATA = generatePositions(3000);
const build = (view: ViewState, data = DATA) =>
  constructTable<Headless, Position>({
    features: headless,
    columns: columns as unknown as ColumnDef<Headless, Position, unknown>[],
    data,
    getRowId: (r) => r.tradeId,
    state: {
      grouping: view.grouping, columnFilters: view.columnFilters, globalFilter: view.globalFilter,
      sorting: view.sorting, expanded: view.expanded, columnVisibility: view.columnVisibility,
      columnOrder: view.columnOrder, columnPinning: view.columnPinning, columnSizing: view.columnSizing,
    },
  });

const leaves = (row: R): Position[] => row.getLeafRows().filter((r) => !r.getIsGrouped()).map((r) => r.original);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const groupRows = (rows: R[]): R[] => rows.flatMap((r) => (r.getIsGrouped() ? [r, ...groupRows(r.subRows)] : []));

const SUM_COLS = ['notional', 'mtm', 'dv01', 'cs01'] as const;
const WAVG_COLS = ['yield', 'wal'] as const;

describe('the weighted average (wavg)', () => {
  it('is registered for every measure whose meta names it, weighted by the meta’s column', () => {
    const t = build(parseView({ version: 1 }));
    for (const id of WAVG_COLS) {
      expect(COLUMN_META[id].agg).toBe('wavg');
      expect(COLUMN_META[id].weightBy).toBe('notional');
      const fns = t.getColumn(id)!.getAggregationFns();
      expect(fns.length).toBe(1);
      expect(fns[0]!.aggregationFn).toBeDefined();
    }
  });

  it('matches brute force at every level of a three-deep grouping', () => {
    const t = build(parseView({ version: 1, grouping: ['desk', 'currency', 'product'], expanded: true }));
    const groups = groupRows(t.getRowModel().rows.filter((r) => r.depth === 0) as R[]);
    expect(groups.length).toBeGreaterThan(50);
    const depths = new Set(groups.map((g) => g.depth));
    expect([...depths].sort()).toEqual([0, 1, 2]);
    for (const g of groups) {
      const rows = leaves(g);
      for (const id of WAVG_COLS) {
        const got = g.getValue(id);
        expect(got).toBeInstanceOf(Wavg);
        const expected = weightedAverage(rows.map((r) => r[id]), rows.map((r) => r.notional));
        expect(aggregatedNumber(got)).toBeCloseTo(expected!, 9);
        // Not the mean of the sub-group means — the classic wrong number.
        if (g.subRows.length > 1 && g.subRows[0]!.getIsGrouped()) {
          const meanOfMeans = sum(g.subRows.map((s) => aggregatedNumber(s.getValue(id))!)) / g.subRows.length;
          expect(Math.abs(meanOfMeans - expected!)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('decomposes: a parent’s parts are the sum of its children’s parts', () => {
    const t = build(parseView({ version: 1, grouping: ['desk', 'currency'], expanded: true }));
    for (const g of (t.getRowModel().rows as R[]).filter((g) => g.getIsGrouped() && g.depth === 0)) {
      const parent = g.getValue('yield') as Wavg;
      const kids = g.subRows.map((s) => s.getValue('yield') as Wavg);
      expect(parent.sumW).toBeCloseTo(sum(kids.map((k) => k.sumW)), 6);
      expect(parent.sumXW).toBeCloseTo(sum(kids.map((k) => k.sumXW)), 6);
    }
  });

  it('is the grand total over the whole book too, and blank with no weight', () => {
    const t = build(parseView({ version: 1 }));
    const all = t.getPreGroupedRowModel().rows.map((r) => r.original);
    const total = t.getColumn('yield')!.getAggregationValue();
    expect(aggregatedNumber(total)).toBeCloseTo(weightedAverage(all.map((r) => r.yield), all.map((r) => r.notional))!, 9);
    expect(weightedAverage([1, 2], [0, 0])).toBeUndefined();
    expect(aggregatedNumber(new Wavg({ sumXW: 0, sumW: 0 }))).toBeUndefined();
  });
});

describe('subtotals and totals', () => {
  it('every subtotal is the sum of its children and the grand total the sum of the top level', () => {
    const t = build(parseView({ version: 1, grouping: ['desk', 'product'], expanded: true }));
    // `expanded: true` flattens every level into the row model; the top
    // level is depth 0, and `groupRows` walks the rest through `subRows`.
    const top = t.getRowModel().rows.filter((r) => r.getIsGrouped() && r.depth === 0) as R[];
    for (const id of SUM_COLS) {
      for (const g of groupRows(top)) {
        const own = g.getValue<number>(id);
        expect(own).toBeCloseTo(sum(leaves(g).map((r) => r[id])), 6);
        if (g.subRows[0]?.getIsGrouped()) {
          expect(own).toBeCloseTo(sum(g.subRows.map((s) => s.getValue<number>(id))), 6);
        }
      }
      const grand = t.getColumn(id)!.getAggregationValue<number>();
      expect(grand).toBeCloseTo(sum(top.map((g) => g.getValue<number>(id))), 6);
      expect(grand).toBeCloseTo(sum(DATA.map((r) => r[id])), 6);
    }
  });

  it('a group row carries its leaf count and grouping value', () => {
    const t = build(parseView({ version: 1, grouping: ['desk'] }));
    const rows = t.getRowModel().rows as R[];
    const byDesk = new Map<string, number>();
    for (const r of DATA) byDesk.set(r.desk, (byDesk.get(r.desk) ?? 0) + 1);
    for (const g of rows) {
      expect(g.getIsGrouped()).toBe(true);
      expect(g.groupingColumnId).toBe('desk');
      expect(leaves(g).length).toBe(byDesk.get(g.groupingValue as string));
    }
  });
});

describe('filtering updates subtotals', () => {
  it('a set filter on a dimension changes every subtotal to the rows that remain', () => {
    const view = parseView({
      version: 1,
      grouping: ['desk'],
      expanded: true,
      columnFilters: [{ id: 'product', value: ['Bond', 'CDS'] }],
    });
    const t = build(view);
    const kept = DATA.filter((r) => r.product === 'Bond' || r.product === 'CDS');
    expect(t.getFilteredRowModel().rows.length).toBe(kept.length);
    for (const g of t.getRowModel().rows.filter((r) => r.getIsGrouped()) as R[]) {
      const mine = kept.filter((r) => r.desk === g.groupingValue);
      expect(g.getValue<number>('notional')).toBeCloseTo(sum(mine.map((r) => r.notional)), 6);
      expect(aggregatedNumber(g.getValue('yield'))).toBeCloseTo(
        weightedAverage(mine.map((r) => r.yield), mine.map((r) => r.notional))!, 9);
    }
    expect(t.getColumn('notional')!.getAggregationValue<number>()).toBeCloseTo(sum(kept.map((r) => r.notional)), 6);
  });

  it('a number range on a measure, with an open end, does the same', () => {
    const t = build(parseView({
      version: 1, grouping: ['currency'], expanded: true,
      columnFilters: [{ id: 'notional', value: [1e9, null] }],
    }));
    const kept = DATA.filter((r) => r.notional >= 1e9);
    expect(kept.length).toBeGreaterThan(0);
    expect(t.getFilteredRowModel().rows.length).toBe(kept.length);
    for (const g of t.getRowModel().rows.filter((r) => r.getIsGrouped()) as R[]) {
      const mine = kept.filter((r) => r.currency === g.groupingValue);
      expect(g.getValue<number>('dv01')).toBeCloseTo(sum(mine.map((r) => r.dv01)), 6);
    }
  });

  it('a quick filter narrows the book the same way', () => {
    const t = build(parseView({ version: 1, grouping: ['desk'], expanded: true, globalFilter: 'CP-0100' }));
    const kept = DATA.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes('cp-0100')));
    expect(kept.length).toBeGreaterThan(0);
    expect(t.getFilteredRowModel().rows.length).toBe(kept.length);
  });
});
