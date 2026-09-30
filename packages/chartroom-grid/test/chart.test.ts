/**
 * A chart from a range (ADR-81): the grid describes a widget — category,
 * series, resolved data in the widgets' shape — and refuses a block it
 * cannot chart honestly.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { generatePositions } from '../src/data/mock';
import { chartFromRange, widgetFormat } from '../src/grid/chart';
import { COLUMN_META } from '../src/grid/columns';
import { parseView } from '../src/grid/viewState';

const BOOK = generatePositions(400);

describe('chartFromRange', () => {
  it('takes the first dimension as the category and each measure as a series, rows in screen order', () => {
    const t = headlessTable(BOOK, parseView({ version: 5, sorting: [{ id: 'notional', desc: true }] }));
    const rows = t.getRowModel().rows;
    t.selectCellRange({ anchorRowId: rows[0]!.id, anchorColumnId: 'desk', focusRowId: rows[4]!.id, focusColumnId: 'notional' });
    const out = chartFromRange(t, '2026-09-28');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.request;
    expect(r.type).toBe('bar@1');
    expect(r.category).toEqual({ columnId: 'desk', label: 'Desk' });
    expect(r.series.map((s) => s.columnId)).toEqual(['notional']);
    expect(r.series[0]!.data).toMatchObject({ unit: 'USD', format: 'currency_usd_mm', asOf: '2026-09-28', ordinalDim: true });
    expect(r.series[0]!.data.rows.length).toBe(5);
    expect(r.series[0]!.data.rows.map((x) => x.value)).toEqual(rows.slice(0, 5).map((x) => x.original.notional));
    expect(r.series[0]!.data.rows[0]!.key.desk).toBe(rows[0]!.original.desk);
    expect(r.title).toBe('Notional by Desk');
    const desks = rows.slice(0, 5).map((x) => x.original.desk);
    const dup = desks.find((d, i) => desks.indexOf(d) !== i);
    if (dup) expect(r.series[0]!.data.rows.some((x) => x.key.desk === `${dup} (2)`)).toBe(true);
  });

  it('charts group rows by their subtotal, with the group column as the category', () => {
    const t = headlessTable(BOOK, parseView({ version: 5, grouping: ['desk'] }));
    const groups = t.getRowModel().rows;
    t.selectCellRange({ anchorRowId: groups[0]!.id, anchorColumnId: 'desk', focusRowId: groups[groups.length - 1]!.id, focusColumnId: 'yield' });
    const out = chartFromRange(t);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/mixes units/);
    t.selectCellRange({ anchorRowId: groups[0]!.id, anchorColumnId: 'desk', focusRowId: groups[groups.length - 1]!.id, focusColumnId: 'mtm' });
    const ok = chartFromRange(t);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.request.category.columnId).toBe('desk');
    expect(ok.request.series.map((s) => s.columnId)).toEqual(['notional', 'mtm']);
    const notional = ok.request.series[0]!;
    expect(notional.data.rows.map((r) => r.key.desk)).toEqual(groups.map((g) => String(g.groupingValue)));
    expect(notional.data.rows[0]!.value).toBeCloseTo(Number(groups[0]!.getValue('notional')), 6);
  });

  it('refuses a block with two units, without a category, or without a measure', () => {
    const t = headlessTable(BOOK, parseView({ version: 5 }));
    const rows = t.getRowModel().rows;
    t.selectCellRange({ anchorRowId: rows[0]!.id, anchorColumnId: 'desk', focusRowId: rows[2]!.id, focusColumnId: 'yield' });
    const mixed = chartFromRange(t);
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.reason).toMatch(/mixes units.*NUM-01/);
    t.selectCellRange({ anchorRowId: rows[0]!.id, anchorColumnId: 'notional', focusRowId: rows[2]!.id, focusColumnId: 'mtm' });
    const noCategory = chartFromRange(t);
    expect(noCategory.ok).toBe(false);
    if (!noCategory.ok) expect(noCategory.reason).toMatch(/dimension column/);
    t.selectCellRange({ anchorRowId: rows[0]!.id, anchorColumnId: 'desk', focusRowId: rows[2]!.id, focusColumnId: 'book' });
    const noMeasure = chartFromRange(t);
    expect(noMeasure.ok).toBe(false);
    if (!noMeasure.ok) expect(noMeasure.reason).toMatch(/measure column/);
    t.resetCellSelection(true);
    expect(chartFromRange(t)).toMatchObject({ ok: false, reason: /select a block/ });
  });

  it('maps a measure\'s meta to the widget catalog\'s format', () => {
    expect(widgetFormat(COLUMN_META.dv01)).toEqual({ unit: 'USD', format: 'currency_usd' });
    expect(widgetFormat(COLUMN_META.yield)).toEqual({ unit: '%', format: 'percent_2dp' });
    expect(widgetFormat(COLUMN_META.wal)).toEqual({ unit: 'years', format: 'number' });
  });
});
