/**
 * The view state is the contract (ADR-66): what it accepts, what it refuses
 * at the boundary, and that a view handed to a headless table drives it.
 */

import { describe, expect, it } from 'vitest';
import { constructTable, tableFeatures, type ColumnDef } from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import { COLUMN_ORDER, columns } from '../src/grid/columns';
import { features } from '../src/grid/features';
import {
  VIEW_VERSION, ViewStateSchema, defaultView, parseView, safeParseView, toTableState, type ViewState,
} from '../src/grid/viewState';
import { DESKS, generatePositions, type Position } from '../src/data/mock';

describe('the view state contract', () => {
  it('defaults to a view with nothing applied, at the current version', () => {
    const v = defaultView();
    expect(v.version).toBe(VIEW_VERSION);
    expect(v.grouping).toEqual([]);
    expect(v.sorting).toEqual([]);
    expect(v.columnFilters).toEqual([]);
    expect(v.globalFilter).toBe('');
    expect(v.expanded).toEqual({});
    expect(v.columnPinning).toEqual({ start: [], end: [] });
    expect(v.pagination).toEqual({ pageIndex: 0, pageSize: 100 });
  });

  it('round-trips through JSON unchanged', () => {
    const v: ViewState = {
      ...defaultView(),
      grouping: ['desk', 'currency'],
      sorting: [{ id: 'notional', desc: true }],
      columnFilters: [{ id: 'product', value: ['Bond', 'CDS'] }],
      columnVisibility: { asOf: false },
      columnSizing: { counterparty: 140 },
    };
    expect(parseView(JSON.parse(JSON.stringify(v)))).toEqual(v);
  });

  it('migrates a version-1 document and refuses any other version', () => {
    const v1 = parseView({ version: 1, grouping: ['desk'] });
    expect(v1.version).toBe(VIEW_VERSION);
    expect(v1.columnAggs).toEqual({});
    expect(v1.grouping).toEqual(['desk']);
    expect(() => parseView({ version: 3 })).toThrow();
    expect(() => parseView({ version: 0 })).toThrow();
  });

  it('accepts an aggregation a measure can take and refuses one it cannot', () => {
    const ok = parseView({ version: 2, columnAggs: { yield: 'mean', notional: 'median', wal: 'wavg' } });
    expect(ok.columnAggs).toEqual({ yield: 'mean', notional: 'median', wal: 'wavg' });
    for (const bad of [{ desk: 'sum' }, { yield: 'total' }, { pnl: 'sum' }, { mtm: 'wavg' }]) {
      const r = safeParseView({ version: 2, columnAggs: bad });
      expect(r.ok).toBe(false);
    }
  });

  it('refuses an unknown key and an unknown column', () => {
    expect(() => parseView({})).toThrow();
    expect(() => parseView({ version: 1, rowSelection: {} })).toThrow();
    const bad = safeParseView({ version: 1, sorting: [{ id: 'pnl', desc: false }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.join('\n')).toMatch(/unknown column: pnl/);
    const sized = safeParseView({ version: 1, columnSizing: { pnl: 100 } });
    expect(sized.ok).toBe(false);
  });

  it('refuses a grouping the meta does not allow — the boundary, not fifty thousand groups', () => {
    const r = safeParseView({ version: 1, grouping: ['tradeId'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join('\n')).toMatch(/not groupable: tradeId/);
    expect(parseView({ version: 1, grouping: ['desk', 'book'] }).grouping).toEqual(['desk', 'book']);
  });

  it('maps onto the registered slices and carries pagination without driving it', () => {
    const state = toTableState(defaultView());
    expect(Object.keys(state).sort()).toEqual([
      'columnFilters', 'columnOrder', 'columnPinning', 'columnSizing', 'columnVisibility',
      'expanded', 'globalFilter', 'grouping', 'sorting',
    ]);
    expect('pagination' in state).toBe(false);
    expect('columnAggs' in state).toBe(false);
    expect(Object.keys(ViewStateSchema.shape)).toContain('pagination');
  });
});

describe('a view drives a headless table', () => {
  // Same registry trick as grid.test.ts: `constructTable` needs a reactivity
  // slot the shared React registry must not carry.
  const headless = tableFeatures({ ...features, coreReactivityFeature: storeReactivityBindings() });
  type Headless = typeof headless;
  const data = generatePositions(400);
  const build = (view: ViewState) =>
    constructTable<Headless, Position>({
      features: headless,
      columns: columns as unknown as ColumnDef<Headless, Position, unknown>[],
      data,
      getRowId: (r) => r.tradeId,
      state: toTableState(view),
    });

  it('sorts as the view says', () => {
    const t = build(parseView({ version: 1, sorting: [{ id: 'notional', desc: true }] }));
    const notionals = t.getRowModel().rows.map((r) => r.original.notional);
    for (let i = 1; i < notionals.length; i++) expect(notionals[i - 1]).toBeGreaterThanOrEqual(notionals[i]!);
  });

  it('groups as the view says, collapsed until expanded', () => {
    const t = build(parseView({ version: 1, grouping: ['desk'] }));
    const rows = t.getRowModel().rows;
    expect(rows.length).toBe(DESKS.length);
    for (const r of rows) expect(r.getIsGrouped()).toBe(true);
    const open = build(parseView({ version: 1, grouping: ['desk'], expanded: true }));
    expect(open.getRowModel().rows.length).toBe(DESKS.length + data.length);
  });

  it('hides, orders and sizes columns as the view says', () => {
    const t = build(parseView({
      version: 1,
      columnVisibility: { asOf: false, tradeId: false },
      columnOrder: ['notional', 'desk'],
      columnSizing: { desk: 200 },
    }));
    const visible = t.getVisibleLeafColumns().map((c) => c.id);
    expect(visible).not.toContain('asOf');
    expect(visible.slice(0, 2)).toEqual(['notional', 'desk']);
    expect(visible.length).toBe(COLUMN_ORDER.length - 2);
    expect(t.getColumn('desk')!.getSize()).toBe(200);
  });

  it('pins as the view says, by logical direction', () => {
    const t = build(parseView({ version: 1, columnPinning: { start: ['tradeId'], end: ['mtm'] } }));
    expect(t.getColumn('tradeId')!.getIsPinned()).toBe('start');
    expect(t.getColumn('mtm')!.getIsPinned()).toBe('end');
    expect(t.getColumn('desk')!.getIsPinned()).toBe(false);
  });
});
