/**
 * The xlsx export: what the screen shows, as a sheet. The rows are the
 * table's current row model — a collapsed group exports as its subtotal
 * row, an expanded one as the subtotal and its leaves, each group indented
 * by depth — followed by the grand total. Every number keeps its raw value
 * and takes an Excel format derived from the same meta the cell used
 * (ADR-29), so the sheet reads as the grid does and still sums.
 *
 * React-free and fetch-free (the boundaries test holds `src/export` to
 * that). exceljs is imported here, and the component that triggers a
 * download imports this module lazily so the bundle carries exceljs only
 * when a reader asks for a sheet.
 */

import ExcelJS from 'exceljs';
import { aggregatedNumber } from '../grid/aggregations';
import type { ColumnMeta } from '../grid/meta';
import { excelFormat, excelRules } from './formats';

/**
 * What the export reads of a table — structurally, because v9's `Table`
 * type is invariant in its feature registry and the React table and the
 * headless test table are two registries. Anything with these methods
 * exports; nothing else is touched.
 */
export interface ExportCell {
  column: { id: string };
  getIsGrouped(): boolean;
  getIsAggregated(): boolean;
  getIsPlaceholder(): boolean;
  getValue(): unknown;
}
export interface ExportRow {
  depth: number;
  groupingColumnId?: string;
  groupingValue?: unknown;
  getIsGrouped(): boolean;
  getAllCells(): ExportCell[];
}
export interface ExportColumn {
  id: string;
  columnDef: { meta?: ColumnMeta; aggregationFn?: unknown };
  getSize(): number;
  getAggregationValue(): unknown;
}
export interface ExportTable {
  getVisibleLeafColumns(): ExportColumn[];
  getRowModel(): { rows: ExportRow[] };
  getFilteredRowModel(): { rows: unknown[] };
}

export interface ExportOptions {
  sheetName?: string;
  /** The source's name and as-of, for the sheet's title row. */
  title?: string;
}

const isCount = (c: ExportColumn) => c.columnDef.aggregationFn === 'count' || c.columnDef.aggregationFn === 'uniqueCount';

export function buildWorkbook(table: ExportTable, options: ExportOptions = {}): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'chartroom-grid';
  const ws = wb.addWorksheet(options.sheetName ?? 'Positions', { views: [{ state: 'frozen', ySplit: 1 }] });

  const columns = table.getVisibleLeafColumns().filter((c) => c.columnDef.meta);
  ws.columns = columns.map((c) => {
    const meta = c.columnDef.meta as ColumnMeta;
    // A calculated column is a draft (ADR-79): the sheet says so.
    return { header: meta.computed ? `${meta.label} (calculated)` : meta.label, key: c.id, width: Math.max(10, Math.round(c.getSize() / 7)) };
  });
  ws.getRow(1).font = { bold: true };
  for (const c of columns) {
    const fmt = excelFormat(c.columnDef.meta as ColumnMeta);
    if (fmt) ws.getColumn(c.id).numFmt = fmt;
    if ((c.columnDef.meta as ColumnMeta).kind === 'measure') ws.getColumn(c.id).alignment = { horizontal: 'right' };
  }

  for (const row of table.getRowModel().rows) {
    const values: Record<string, unknown> = {};
    for (const c of columns) {
      const cell = row.getAllCells().find((x) => x.column.id === c.id);
      if (!cell) continue;
      if (cell.getIsGrouped()) values[c.id] = String(row.groupingValue ?? '');
      else if (cell.getIsAggregated()) values[c.id] = aggregatedNumber(cell.getValue());
      else if (cell.getIsPlaceholder() || row.getIsGrouped()) values[c.id] = undefined;
      else values[c.id] = cell.getValue();
    }
    const added = ws.addRow(values);
    if (row.getIsGrouped()) {
      added.font = { bold: true };
      // A count aggregate is a number of rows: it reads as a plain integer, not in the column's unit.
      for (const c of columns) if (isCount(c)) added.getCell(c.id).numFmt = '#,##0';
      const groupCell = added.getCell(String(row.groupingColumnId));
      groupCell.alignment = { indent: row.depth };
    }
  }

  const total: Record<string, unknown> = {};
  const first = columns[0];
  if (first) total[first.id] = `Total · ${table.getFilteredRowModel().rows.length.toLocaleString('en-US')} rows`;
  for (const c of columns) {
    const meta = c.columnDef.meta as ColumnMeta;
    if (meta.kind === 'measure' && c.columnDef.aggregationFn) total[c.id] = aggregatedNumber(c.getAggregationValue());
  }
  const totalRow = ws.addRow(total);
  for (const c of columns) if (isCount(c)) totalRow.getCell(c.id).numFmt = '#,##0';
  // A reader's highlight rules travel as conditional formats over the data rows.
  for (const c of columns) {
    const rules = excelRules((c.columnDef.meta as ColumnMeta).rules);
    if (rules.length === 0 || totalRow.number < 3) continue;
    const letter = ws.getColumn(c.id).letter;
    ws.addConditionalFormatting({ ref: `${letter}2:${letter}${totalRow.number - 1}`, rules });
  }
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: 'thin' } };

  if (options.title) {
    ws.headerFooter.oddHeader = options.title;
  }
  return wb;
}

/** The bytes of the sheet, for a download or a test. */
export async function workbookBytes(table: ExportTable, options?: ExportOptions): Promise<ArrayBuffer> {
  const buffer = await buildWorkbook(table, options).xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
