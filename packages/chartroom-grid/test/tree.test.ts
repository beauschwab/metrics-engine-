/**
 * Tree mode (ADR-93): the grouping as one indented column. The view carries
 * it (v7, migrated from v6 as columns); the grouped dimensions leave the
 * screen without the view forgetting how the reader had them; the header
 * sorts every level together; and what reads a cell — copy, the chart, the
 * export — reads the tree's levels where the grouped columns used to be.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { generatePositions } from '../src/data/mock';
import { buildWorkbook } from '../src/export/xlsx';
import { chartFromRange } from '../src/grid/chart';
import { rangesToTsv, selectedCellRanges } from '../src/grid/copy';
import {
  TREE_ID, toggleTreeSort, treeKey, treeShown, treeSortDirection, treeVisibility, untreeVisibility,
} from '../src/grid/tree';
import { VIEW_VERSION, migrateView, parseView, safeParseView, type ViewState } from '../src/grid/viewState';

const BOOK = generatePositions(400);
const view = (over: Partial<ViewState> & Record<string, unknown> = {}) => parseView({ version: VIEW_VERSION, ...over });

describe('the view carries the display', () => {
  it('defaults to columns, migrates a v6 view to columns, and refuses anything but columns or tree', () => {
    expect(VIEW_VERSION).toBe(7);
    expect(view().groupDisplay).toBe('columns');
    expect(migrateView({ version: 6, grouping: ['desk'] })).toMatchObject({ version: 7, groupDisplay: 'columns' });
    expect(parseView({ version: 6, grouping: ['desk'] }).groupDisplay).toBe('columns');
    expect(view({ groupDisplay: 'tree' }).groupDisplay).toBe('tree');
    expect(safeParseView({ version: VIEW_VERSION, groupDisplay: 'nested' }).ok).toBe(false);
  });

  it('shows a tree only when there is a grouping to nest', () => {
    expect(treeShown(view({ groupDisplay: 'tree' }))).toBe(false);
    expect(treeShown(view({ groupDisplay: 'tree', grouping: ['desk'] }))).toBe(true);
    expect(treeShown(view({ grouping: ['desk'] }))).toBe(false);
  });
});

describe('the grouped columns leave the screen, and the view keeps how the reader had them', () => {
  it('hides each grouped column over the view’s visibility, and writes none of it back', () => {
    const v = view({ groupDisplay: 'tree', grouping: ['desk', 'book'], columnVisibility: { book: true, yield: false } });
    expect(treeVisibility(v)).toEqual({ book: false, yield: false, desk: false });
    // The table writes back what it holds plus the reader's change: only the change survives.
    const next = untreeVisibility({ ...treeVisibility(v), mtm: false, [TREE_ID]: true }, v);
    expect(next).toEqual({ book: true, yield: false, mtm: false });
    // Columns mode: the view's visibility, untouched.
    const c = view({ grouping: ['desk'], columnVisibility: { yield: false } });
    expect(treeVisibility(c)).toBe(c.columnVisibility);
  });

  it('puts one tree column first and takes the grouped dimensions off the screen', () => {
    const t = headlessTable(BOOK, view({ groupDisplay: 'tree', grouping: ['desk', 'book'] }), undefined, undefined, { display: true });
    const ids = t.getVisibleLeafColumns().map((c) => c.id);
    expect(ids[0]).toBe(TREE_ID);
    expect(ids).not.toContain('desk');
    expect(ids).not.toContain('book');
    // An agent's table is the data's: the same view draws no tree there.
    const agent = headlessTable(BOOK, view({ groupDisplay: 'tree', grouping: ['desk'] }));
    expect(agent.getVisibleLeafColumns().map((c) => c.id)).toContain('desk');
    expect(agent.getVisibleLeafColumns().map((c) => c.id)).not.toContain(TREE_ID);
  });
});

describe('the tree header sorts every level together', () => {
  it('cycles ascending, descending, off — ahead of a measure sort, which keeps its place', () => {
    const grouping = ['desk', 'book'];
    const measure = [{ id: 'notional', desc: true }];
    const asc = toggleTreeSort(measure, grouping);
    expect(asc).toEqual([{ id: 'desk', desc: false }, { id: 'book', desc: false }, { id: 'notional', desc: true }]);
    expect(treeSortDirection(asc, grouping)).toBe('asc');
    const desc = toggleTreeSort(asc, grouping);
    expect(treeSortDirection(desc, grouping)).toBe('desc');
    expect(toggleTreeSort(desc, grouping)).toEqual(measure);
    // One level sorted is not the tree sorted.
    expect(treeSortDirection([{ id: 'desk', desc: false }], grouping)).toBe(false);
  });
});

describe('what reads a cell reads the tree', () => {
  const grouped = () => {
    const t = headlessTable(BOOK, view({ groupDisplay: 'tree', grouping: ['desk', 'currency'], expanded: true }), undefined, undefined, { display: true });
    return { t, rows: t.getRowModel().rows };
  };

  it('names a group at its own level, and a leaf as nothing', () => {
    const { rows } = grouped();
    const desk = rows.find((r) => r.depth === 0)!;
    const ccy = rows.find((r) => r.depth === 1 && r.getIsGrouped())!;
    const leaf = rows.find((r) => !r.getIsGrouped())!;
    expect(treeKey(desk)).toEqual({ column: 'desk', value: String(desk.groupingValue) });
    expect(treeKey(ccy)).toEqual({ column: 'currency', value: String(ccy.groupingValue) });
    expect(treeKey(leaf)).toBeUndefined();
    // A group the source made reads the same way.
    expect(treeKey({ original: { __group: { column: 'desk', value: 'Rates', count: 3 } } })).toEqual({ column: 'desk', value: 'Rates' });
  });

  it('copies the tree column as each row’s group, a leaf blank', () => {
    const { t, rows } = grouped();
    t.selectCellRange({ anchorRowId: rows[0]!.id, anchorColumnId: TREE_ID, focusRowId: rows[2]!.id, focusColumnId: 'notional' });
    const lines = rangesToTsv(selectedCellRanges(t)).split('\n').map((l) => l.split('\t')[0]);
    expect(lines).toEqual(rows.slice(0, 3).map((r) => treeKey(r)?.value ?? ''));
  });

  it('reports each dimension the tree holds to the chart, with its own label and values', () => {
    const { t, rows } = grouped();
    const deskRows = rows.filter((r) => r.depth === 0);
    // A block over the first desk and its currencies.
    const lastOfFirst = rows.findIndex((r, i) => i > 0 && r.depth === 0) - 1;
    t.selectCellRange({ anchorRowId: rows[0]!.id, anchorColumnId: TREE_ID, focusRowId: rows[lastOfFirst]!.id, focusColumnId: 'notional' });
    const out = chartFromRange(t);
    const dims = out.selection!.dims;
    // The tree's levels lead, as themselves; the block's other dimension columns follow.
    expect(dims.map((d) => d.id).slice(0, 2)).toEqual(['desk', 'currency']);
    expect(dims.map((d) => d.id)).not.toContain(TREE_ID);
    expect(dims[0]).toMatchObject({ label: 'Desk', values: [String(deskRows[0]!.groupingValue)] });
    expect(dims[1]!.values.length).toBeGreaterThan(0);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.request.category.label).toBe('Group');
  });

  it('exports the tree as a Group column, each group indented by its depth', () => {
    const { t, rows } = grouped();
    const ws = buildWorkbook(t).worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe('Group');
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers).not.toContain('Desk');
    const second = rows.findIndex((r) => r.depth === 1);
    expect(ws.getRow(2).getCell(1).value).toBe(String(rows[0]!.groupingValue));
    expect(ws.getRow(second + 2).getCell(1).value).toBe(String(rows[second]!.groupingValue));
    expect(ws.getRow(second + 2).getCell(1).alignment?.indent).toBe(1);
  });
});
