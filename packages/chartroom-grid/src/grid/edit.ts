/**
 * Editing as a capability the host grants (ADR-87). The grid is read-only
 * over a source until its host hands it an `EditPolicy`: which columns may
 * change and where a committed change goes. The dashboard never grants
 * one — a widget reads a governed number — and a portable host may: a
 * working book over an in-memory or SQL source with `update`.
 *
 * What a reader types is the stored value in the column's unit, read the
 * way the search grammar reads a number (`2.5bn`, `3.5%`, `(1,200)`), so a
 * notional typed as `2.5bn` is 2,500,000,000 dollars and a yield typed as
 * `3.5%` is 3.5. A pasted block lands cell by cell from the anchor over
 * the visible columns, skipping what cannot be edited — a group row, an
 * aggregate, a calculated or pivot column — rather than refusing the paste.
 */

import type { ColumnMeta } from './meta';
import { parseSearchNumber } from './search';

/** One committed change: the row, the column, the new stored value and the one it replaces. */
export interface CellEdit {
  rowId: string;
  columnId: string;
  value: string | number;
  previous: unknown;
}

export interface EditPolicy {
  /** The columns a reader may change: a list of ids, or a rule over the meta; every registry column by default. */
  columns?: readonly string[] | ((columnId: string, meta: ColumnMeta) => boolean);
  /** Every committed change reaches the host here; throwing (or rejecting) refuses it and the grid reverts the cells. */
  onCommit(edits: CellEdit[]): void | Promise<void>;
}

export type ParsedEdit = { ok: true; value: string | number } | { ok: false; reason: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What typed text means in a column: a number in the unit for a measure, text for a dimension, an ISO day for a date. */
export function parseEditText(text: string, meta: ColumnMeta): ParsedEdit {
  const trimmed = text.trim();
  if (meta.unit === 'date') {
    return ISO_DAY.test(trimmed) ? { ok: true, value: trimmed } : { ok: false, reason: 'a date reads as YYYY-MM-DD' };
  }
  if (meta.kind === 'dimension') return { ok: true, value: trimmed };
  if (trimmed === '') return { ok: false, reason: 'a measure needs a number' };
  // Accounting negatives and a currency sign are reading, not value.
  const parens = /^\((.*)\)$/.exec(trimmed);
  const body = (parens ? parens[1]! : trimmed).replace(/^[$€£¥]\s*/, '').replace(/^-\s*[$€£¥]\s*/, '-');
  const n = parseSearchNumber(body);
  if (n === undefined) return { ok: false, reason: `not a number: ${trimmed}` };
  return { ok: true, value: parens ? -n : n };
}

/** Whether a policy lets this column change: the meta rules out what has no stored value, the policy narrows the rest. */
export function canEditColumn(policy: EditPolicy | null | undefined, columnId: string, meta: ColumnMeta | undefined): boolean {
  if (!policy || !meta || meta.computed || meta.pivot) return false;
  const { columns } = policy;
  if (columns === undefined) return true;
  return typeof columns === 'function' ? columns(columnId, meta) : columns.includes(columnId);
}

/** The text a cell editor opens with: the stored value, as text. */
export function editText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value);
}

/** A clipboard's text as a block of cells: rows on newlines, cells on tabs; a trailing newline is not a row. */
export function parseClipboardBlock(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}

/** What the paste reads of a row and its visible cells — structural, as the copier's is. */
export interface PasteRow {
  id: string;
  /** A group row (client- or engine-made): nothing on it is a stored value. */
  grouped: boolean;
  cells: ReadonlyArray<{ columnId: string; meta?: ColumnMeta; value: unknown; /** False for a placeholder or an aggregate: nothing stored behind it. */ editable?: boolean }>;
}

export interface PasteOutcome {
  edits: CellEdit[];
  /** Cells the block covered that could not take a value, and why. */
  skipped: Array<{ rowId?: string; columnId?: string; reason: string }>;
}

/**
 * A block pasted at an anchor: cell `[r][c]` of the block lands on row
 * `anchorRow + r`, visible cell `anchorCell + c`. A value that does not
 * parse for its column, or a cell that cannot be edited, is skipped and
 * named; the rest become edits.
 */
export function pasteEdits(
  rows: ReadonlyArray<PasteRow>,
  anchor: { rowIndex: number; cellIndex: number },
  block: ReadonlyArray<ReadonlyArray<string>>,
  allowed: (rowId: string, columnId: string, meta: ColumnMeta) => boolean,
): PasteOutcome {
  const edits: CellEdit[] = [];
  const skipped: PasteOutcome['skipped'] = [];
  block.forEach((line, r) => {
    const row = rows[anchor.rowIndex + r];
    if (!row) { skipped.push({ reason: `row ${anchor.rowIndex + r + 1} is past the end` }); return; }
    if (row.grouped) { skipped.push({ rowId: row.id, reason: 'a group row has no stored values' }); return; }
    line.forEach((text, c) => {
      const cell = row.cells[anchor.cellIndex + c];
      if (!cell) { skipped.push({ rowId: row.id, reason: `column ${anchor.cellIndex + c + 1} is past the end` }); return; }
      if (!cell.meta || cell.editable === false || !allowed(row.id, cell.columnId, cell.meta)) { skipped.push({ rowId: row.id, columnId: cell.columnId, reason: 'not editable' }); return; }
      const parsed = parseEditText(text, cell.meta);
      if (!parsed.ok) { skipped.push({ rowId: row.id, columnId: cell.columnId, reason: parsed.reason }); return; }
      if (parsed.value === cell.value) return;
      edits.push({ rowId: row.id, columnId: cell.columnId, value: parsed.value, previous: cell.value });
    });
  });
  return { edits, skipped };
}

/** The key an edited cell is remembered by. */
export const editKey = (rowId: string, columnId: string): string => `${rowId}\u0000${columnId}`;

/** Rows with a set of edits laid over them: a row an edit names is copied with its new values, the rest are the same objects. */
export function applyEdits<R extends Record<string, unknown>>(rows: readonly R[], edits: ReadonlyArray<Pick<CellEdit, 'rowId' | 'columnId' | 'value'>>, rowId: string): R[] {
  if (edits.length === 0) return [...rows];
  const byRow = new Map<string, Record<string, unknown>>();
  for (const e of edits) {
    const patch = byRow.get(e.rowId) ?? {};
    patch[e.columnId] = e.value;
    byRow.set(e.rowId, patch);
  }
  return rows.map((r) => {
    const patch = byRow.get(String(r[rowId]));
    return patch ? { ...r, ...patch } : r;
  });
}
