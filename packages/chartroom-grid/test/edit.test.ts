/**
 * Editing as a capability the host grants (ADR-87): what typed text means
 * in a column, which cells a policy lets change, how a pasted block lands,
 * and how a source takes committed edits back.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { inMemorySource } from '../src/data/inMemorySource';
import { generatePositions } from '../src/data/mock';
import { sqlSource } from '../src/data/sqlSource';
import { SQLITE } from '../src/data/compileSql';
import { TREASURY_META } from '../src/data/treasury';
import { applyEdits, canEditColumn, editText, parseClipboardBlock, parseEditText, pasteEdits, type PasteRow } from '../src/grid/edit';
import { parseView } from '../src/grid/viewState';
import { sqliteExecutor } from './sqliteExecutor';

const BOOK = generatePositions(200);

describe('what typed text means', () => {
  it('reads a measure as a number in the stored unit, with suffixes, percent, parentheses and a currency sign', () => {
    expect(parseEditText('2.5bn', TREASURY_META.notional)).toEqual({ ok: true, value: 2.5e9 });
    expect(parseEditText('$1,200,000', TREASURY_META.notional)).toEqual({ ok: true, value: 1_200_000 });
    expect(parseEditText('(1,200)', TREASURY_META.mtm)).toEqual({ ok: true, value: -1200 });
    expect(parseEditText('3.5%', TREASURY_META.yield)).toEqual({ ok: true, value: 3.5 });
    expect(parseEditText('  -7 ', TREASURY_META.dv01)).toEqual({ ok: true, value: -7 });
    expect(parseEditText('', TREASURY_META.notional)).toMatchObject({ ok: false, reason: /needs a number/ });
    expect(parseEditText('abc', TREASURY_META.notional)).toMatchObject({ ok: false, reason: /not a number/ });
  });

  it('reads a dimension as text and a date as an ISO day', () => {
    expect(parseEditText('  Credit ', TREASURY_META.desk)).toEqual({ ok: true, value: 'Credit' });
    expect(parseEditText('2026-10-01', TREASURY_META.asOf)).toEqual({ ok: true, value: '2026-10-01' });
    expect(parseEditText('1 Oct', TREASURY_META.asOf)).toMatchObject({ ok: false, reason: /YYYY-MM-DD/ });
    expect(editText(1.5)).toBe('1.5');
    expect(editText(Number.NaN)).toBe('');
    expect(editText(null)).toBe('');
  });
});

describe('which cells a policy lets change', () => {
  it('is every registry column by default, never a calculated or pivot column, and what the policy names', () => {
    const any = { onCommit() {} };
    expect(canEditColumn(any, 'notional', TREASURY_META.notional)).toBe(true);
    expect(canEditColumn(any, 'desk', TREASURY_META.desk)).toBe(true);
    expect(canEditColumn(any, 'c:x', { ...TREASURY_META.notional, computed: true })).toBe(false);
    expect(canEditColumn(any, 'p:notional:EUR', { ...TREASURY_META.notional, pivot: true })).toBe(false);
    expect(canEditColumn(null, 'notional', TREASURY_META.notional)).toBe(false);
    expect(canEditColumn({ onCommit() {}, columns: ['mtm'] }, 'notional', TREASURY_META.notional)).toBe(false);
    expect(canEditColumn({ onCommit() {}, columns: ['mtm'] }, 'mtm', TREASURY_META.mtm)).toBe(true);
    expect(canEditColumn({ onCommit() {}, columns: (_id, m) => m.kind === 'measure' }, 'desk', TREASURY_META.desk)).toBe(false);
  });
});

describe('a pasted block', () => {
  it('splits on newlines and tabs and drops a trailing newline', () => {
    expect(parseClipboardBlock('1\t2\n3\t4\n')).toEqual([['1', '2'], ['3', '4']]);
    expect(parseClipboardBlock('a\r\nb')).toEqual([['a'], ['b']]);
    expect(parseClipboardBlock('x')).toEqual([['x']]);
  });

  it('lands from the anchor over the visible cells, skips what cannot change, and names why', () => {
    const t = headlessTable(BOOK, parseView({ version: 6, sorting: [{ id: 'tradeId', desc: false }] }));
    const rows: PasteRow[] = t.getRowModel().rows.map((r) => ({
      id: r.id,
      grouped: r.getIsGrouped(),
      cells: r.getVisibleCells().map((c) => ({ columnId: c.column.id, meta: c.column.columnDef.meta, value: c.getValue(), editable: c.column.id !== 'select' })),
    }));
    const cellIndex = rows[0]!.cells.findIndex((c) => c.columnId === 'notional');
    const anchor = { rowIndex: 1, cellIndex };
    const out = pasteEdits(rows, anchor, [['1bn', '(5)'], ['2bn', 'x']], (_r, id) => id !== 'dv01');
    expect(out.edits).toEqual([
      { rowId: 'T000002', columnId: 'notional', value: 1e9, previous: BOOK[1]!.notional },
      { rowId: 'T000002', columnId: 'mtm', value: -5, previous: BOOK[1]!.mtm },
      { rowId: 'T000003', columnId: 'notional', value: 2e9, previous: BOOK[2]!.notional },
    ]);
    expect(out.skipped).toEqual([{ rowId: 'T000003', columnId: 'mtm', reason: 'not a number: x' }]);
    const grouped = headlessTable(BOOK, parseView({ version: 6, grouping: ['desk'], expanded: true }));
    const gRows: PasteRow[] = grouped.getRowModel().rows.slice(0, 2).map((r) => ({
      id: r.id, grouped: r.getIsGrouped(),
      cells: r.getVisibleCells().map((c) => ({ columnId: c.column.id, meta: c.column.columnDef.meta, value: c.getValue(), editable: !c.getIsPlaceholder() && !c.getIsAggregated() })),
    }));
    // The first visible data cell is the grouped desk: a group row above, a placeholder on its leaf.
    const deskIndex = gRows[0]!.cells.findIndex((c) => c.columnId === 'desk');
    const g = pasteEdits(gRows, { rowIndex: 0, cellIndex: deskIndex }, [['Rates'], ['Rates']], () => true);
    expect(g.edits).toEqual([]);
    expect(g.skipped.map((s) => s.reason)).toEqual(['a group row has no stored values', 'not editable']);
    expect(pasteEdits(rows, { rowIndex: 199, cellIndex }, [['1'], ['2']], () => true).skipped).toEqual([{ reason: 'row 201 is past the end' }]);
  });

  it('lays edits over rows without touching the rows it does not name', () => {
    const rows = BOOK.slice(0, 3);
    const out = applyEdits(rows, [{ rowId: 'T000002', columnId: 'notional', value: 1 }, { rowId: 'T000002', columnId: 'desk', value: 'X' }], 'tradeId');
    expect(out[0]).toBe(rows[0]);
    expect(out[1]).toMatchObject({ tradeId: 'T000002', notional: 1, desk: 'X' });
    expect(out[1]).not.toBe(rows[1]);
    expect(rows[1]!.notional).not.toBe(1);
  });
});

describe('a source takes committed edits back', () => {
  it('in memory: the next answer is a new array carrying the values, the old one untouched', async () => {
    const book = generatePositions(50);
    const source = inMemorySource(book, 'book');
    const before = (await source.query(parseView({ version: 6 }))).rows;
    await source.update!([{ rowId: 'T000004', columnId: 'notional', value: 42, previous: book[3]!.notional }]);
    const after = (await source.query(parseView({ version: 6 }))).rows;
    expect(after).not.toBe(before);
    expect(after[3]!.notional).toBe(42);
    expect(before[3]!.notional).toBe(book[3]!.notional);
    expect((await source.describe()).rowCount).toBe(50);
    await expect(source.update!([{ rowId: 'T000001', columnId: 'pnl', value: 1, previous: 0 }])).rejects.toThrow(/unknown column/);
  });

  it('over SQL: one UPDATE by the row id, read back by the next query', async () => {
    const book = generatePositions(50);
    const source = sqlSource({ executor: sqliteExecutor(book), table: 'positions', dialect: SQLITE });
    await source.update!([
      { rowId: 'T000004', columnId: 'notional', value: 42, previous: book[3]!.notional },
      { rowId: 'T000005', columnId: 'desk', value: "O'Neil", previous: book[4]!.desk },
    ]);
    const rows = (await source.query(parseView({ version: 6, columnFilters: [{ id: 'tradeId', value: ['T000004', 'T000005'] }], sorting: [{ id: 'tradeId', desc: false }] }))).rows;
    expect(rows.map((r) => [r.tradeId, r.notional, r.desk])).toEqual([['T000004', 42, book[3]!.desk], ['T000005', book[4]!.notional, "O'Neil"]]);
    const totals = await source.query(parseView({ version: 6 }), { totals: true });
    expect(totals.totals!.notional).toBeCloseTo(book.reduce((a, b) => a + b.notional, 0) - book[3]!.notional + 42, 3);
  });
});

describe('a batch over SQL lands whole or not at all', () => {
  it('rolls the earlier statements back when a later one fails, and refuses the row id', async () => {
    const book = generatePositions(20);
    const inner = sqliteExecutor(book);
    let updates = 0;
    const executor = {
      async run(sql: string, params: ReadonlyArray<string | number>) {
        if (sql.startsWith('UPDATE') && ++updates === 2) throw new Error('the engine refused the second write');
        return inner.run(sql, params);
      },
    };
    const source = sqlSource({ executor, table: 'positions', dialect: SQLITE });
    await expect(source.update!([
      { rowId: 'T000001', columnId: 'notional', value: 1, previous: book[0]!.notional },
      { rowId: 'T000002', columnId: 'notional', value: 2, previous: book[1]!.notional },
    ])).rejects.toThrow(/refused the second write/);
    const rows = (await source.query(parseView({ version: 6, sorting: [{ id: 'tradeId', desc: false }] }))).rows;
    expect(rows[0]!.notional).toBe(book[0]!.notional);
    expect(rows[1]!.notional).toBe(book[1]!.notional);
    await expect(source.update!([{ rowId: 'T000001', columnId: 'tradeId', value: 'X', previous: 'T000001' }])).rejects.toThrow(/row id/);
  });
});
