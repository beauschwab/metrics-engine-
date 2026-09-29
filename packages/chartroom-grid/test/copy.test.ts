/**
 * Range copy (ADR-71): a selected block becomes the text a spreadsheet
 * pastes — the screen's numbers by default, the raw ones on request, with
 * labels when asked, and a group row's cells as the screen shows them.
 */

import { describe, expect, it } from 'vitest';
import { cellText, rangesToTsv, selectedCellRanges } from '../src/grid/copy';
import { formatValue } from '../src/grid/meta';
import { COLUMN_META } from '../src/grid/columns';
import { parseView } from '../src/grid/viewState';
import { headlessTable } from '../src/agent/headless';
import { generatePositions } from '../src/data/mock';

const BOOK = generatePositions(40);

describe('range copy', () => {
  it('copies a block as tab-separated text, formatted or raw, with optional headers', () => {
    const t = headlessTable(BOOK, parseView({ version: 1, sorting: [{ id: 'tradeId', desc: false }] }));
    t.selectCellRange({ anchorRowId: 'T000001', anchorColumnId: 'desk', focusRowId: 'T000003', focusColumnId: 'notional' });
    expect(t.getSelectedCellCount()).toBe(3 * 10);
    const ranges = selectedCellRanges(t);
    const tsv = rangesToTsv(ranges);
    const lines = tsv.split('\n');
    expect(lines.length).toBe(3);
    const first = lines[0]!.split('\t');
    expect(first.length).toBe(10);
    expect(first[0]).toBe(BOOK[0]!.desk);
    expect(first[9]).toBe(formatValue(BOOK[0]!.notional, COLUMN_META.notional));
    const rawTsv = rangesToTsv(ranges, { formatted: false });
    expect(rawTsv.split('\n')[0]!.split('\t')[9]).toBe(String(BOOK[0]!.notional));
    const withHeaders = rangesToTsv(ranges, { headers: true });
    expect(withHeaders.split('\n')[0]).toBe('Desk\tEntity\tBook\tCcy\tProduct\tTenor\tCounterparty\tTrade\tAs of\tNotional');
    expect(withHeaders.split('\n').length).toBe(4);
  });

  it('copies a group row as the screen shows it and separates disjoint ranges', () => {
    const t = headlessTable(BOOK, parseView({ version: 1, grouping: ['desk'] }));
    const groups = t.getRowModel().rows;
    const g = groups[0]!;
    t.selectCellRange({ anchorRowId: g.id, anchorColumnId: 'desk', focusRowId: g.id, focusColumnId: 'notional' });
    t.selectCellRange({ anchorRowId: groups[1]!.id, anchorColumnId: 'yield', focusRowId: groups[1]!.id, focusColumnId: 'yield' }, { mode: 'include' });
    const tsv = rangesToTsv(selectedCellRanges(t));
    const [block1, block2] = tsv.split('\n\n');
    const cells = block1!.split('\t');
    expect(cells[0]).toBe(String(g.groupingValue));
    expect(cells[1]).toBe('');
    expect(cells.at(-1)).toBe(formatValue(g.getValue<number>('notional'), COLUMN_META.notional));
    expect(block2).toMatch(/^\d+\.\d\d%$/);
    const cell = g.getAllCells().find((c) => c.column.id === 'counterparty')!;
    expect(cellText(cell)).toBe('');
  });
});
