/**
 * A block of cells as text a spreadsheet pastes (ADR-71): tab-separated
 * columns, newline-separated rows, one blank line between disjoint ranges.
 * Formatted by default — the number the reader sees — or raw on request,
 * the value the source holds. A group cell copies its value, an aggregate
 * its number, a placeholder nothing, exactly as the screen shows them.
 */

import { aggregatedNumber } from './aggregations';
import { formatValue, type ColumnMeta } from './meta';

/** What the copier reads of a cell — structural, as the export is. */
export interface CopyCell {
  column: { id: string; columnDef: { meta?: ColumnMeta } };
  row: { groupingValue?: unknown; original: unknown };
  getValue(): unknown;
  getIsGrouped(): boolean;
  getIsAggregated(): boolean;
  getIsPlaceholder(): boolean;
}

export interface CopyOptions {
  /** The screen's text (default) or the raw value. */
  formatted?: boolean;
  /** A first row of column labels per range. */
  headers?: boolean;
}

const raw = (v: unknown): string => {
  const n = aggregatedNumber(v);
  if (n !== undefined) return String(n);
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export function cellText(cell: CopyCell, formatted = true): string {
  const meta = cell.column.columnDef.meta;
  const node = cell.row.original as { __group?: { column: string; value: string } } | undefined;
  if (cell.getIsGrouped()) return String(cell.row.groupingValue ?? '');
  if (node?.__group && node.__group.column === cell.column.id) return node.__group.value;
  if (cell.getIsPlaceholder()) return '';
  const value = cell.getIsAggregated() ? aggregatedNumber(cell.getValue()) : cell.getValue();
  if (value === undefined) return '';
  if (!formatted || !meta) return raw(value);
  if (typeof value === 'string' && value === '') return '';
  return formatValue(value, meta);
}

/** What the copier reads of a table: the resolved selection and the rows it indexes. */
export interface CopyTable {
  getCellSelectionBounds(): ReadonlyArray<{ minRowIndex: number; maxRowIndex: number; minColumnIndex: number; maxColumnIndex: number }>;
  getRowModel(): { rows: ReadonlyArray<{ getVisibleCells(): ReadonlyArray<unknown> }> };
}

/**
 * The selected cells, `[range][row][column]`, in display order. The bounds
 * index the row model and each row's visible cells — pinned start, centre,
 * pinned end — which is the order the feature resolves its rectangles in.
 */
export function selectedCellRanges(table: CopyTable): CopyCell[][][] {
  const rows = table.getRowModel().rows;
  return table.getCellSelectionBounds().map((b) =>
    rows.slice(b.minRowIndex, b.maxRowIndex + 1).map((r) => r.getVisibleCells().slice(b.minColumnIndex, b.maxColumnIndex + 1) as CopyCell[]),
  );
}

/** Tab-separated text for `selectedCellRanges()`'s `[range][row][column]`. */
export function rangesToTsv(ranges: ReadonlyArray<ReadonlyArray<ReadonlyArray<unknown>>>, options: CopyOptions = {}): string {
  const formatted = options.formatted ?? true;
  const blocks: string[] = [];
  for (const range of ranges) {
    if (range.length === 0) continue;
    const lines: string[] = [];
    if (options.headers) {
      lines.push((range[0] as CopyCell[]).map((c) => c.column.columnDef.meta?.label ?? c.column.id).join('\t'));
    }
    for (const row of range) lines.push((row as CopyCell[]).map((c) => cellText(c, formatted)).join('\t'));
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}
