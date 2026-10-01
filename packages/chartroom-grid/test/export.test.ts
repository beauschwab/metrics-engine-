/**
 * Phase 3's React-free parts (ADR-68): the Excel format each unit takes,
 * the workbook a table becomes, and the heat ramp a cell's background reads.
 */

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { constructTable, tableFeatures, type ColumnDef } from '@tanstack/table-core';
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings';
import { COLUMN_META, columns } from '../src/grid/columns';
import { features } from '../src/grid/features';
import { heatBackground, heatIntensity } from '../src/grid/heat';
import { parseView, type ViewState } from '../src/grid/viewState';
import { excelFormat } from '../src/export/formats';
import { buildWorkbook, workbookBytes } from '../src/export/xlsx';
import { headlessTable } from '../src/agent/headless';
import { DESKS, generatePositions, type Position } from '../src/data/mock';

const headless = tableFeatures({ ...features, coreReactivityFeature: storeReactivityBindings() });
type Headless = typeof headless;
const DATA = generatePositions(600);
const build = (view: ViewState) =>
  constructTable<Headless, Position>({
    features: headless,
    columns: columns as unknown as ColumnDef<Headless, Position, unknown>[],
    data: DATA,
    getRowId: (r) => r.tradeId,
    state: {
      grouping: view.grouping, columnFilters: view.columnFilters, globalFilter: view.globalFilter,
      sorting: view.sorting, expanded: view.expanded, columnVisibility: view.columnVisibility,
      columnOrder: view.columnOrder, columnPinning: view.columnPinning, columnSizing: view.columnSizing,
    },
  });

describe('highlight rules travel as conditional formats (ADR-78)', () => {
  it('writes one cellIs rule per highlight rule over the data rows, emphasis only', () => {
    const view = parseView({ version: 3, columnFormats: { notional: { rules: [{ op: '>', value: 1e9, emphasis: 'accent' }, { op: '<=', value: 1e6, emphasis: 'muted' }] } } });
    const RULE_BOOK = generatePositions(120);
    const wb = buildWorkbook(headlessTable(RULE_BOOK, view));
    const ws = wb.getWorksheet('Positions')!;
    const cfs = (ws as unknown as { conditionalFormattings: Array<{ ref: string; rules: Array<{ type: string; priority: number; style?: unknown }> }> }).conditionalFormattings;
    expect(cfs.length).toBe(1);
    const letter = ws.getColumn('notional').letter;
    expect(cfs[0]!.ref).toBe(`${letter}2:${letter}${RULE_BOOK.length + 1}`);
    expect(cfs[0]!.rules.map((r) => [r.type, (r as { operator?: string }).operator, r.priority])).toEqual([
      ['cellIs', 'greaterThan', 1], ['cellIs', 'lessThanOrEqual', 2],
    ]);
    const styles = cfs[0]!.rules.map((r) => JSON.stringify(r.style));
    expect(styles.join(' ')).not.toMatch(/FF0000|00FF00|red|green/i);
  });
});

describe('Excel formats from meta', () => {
  it('keeps percent units literal and scales millions in the format, not the cell', () => {
    expect(excelFormat(COLUMN_META.yield)).toBe('0.00"%"');
    expect(excelFormat(COLUMN_META.notional)).toBe('"$"#,##0.0,,"M";-"$"#,##0.0,,"M"');
    expect(excelFormat(COLUMN_META.mtm)).toBe('"$"#,##0.00,,"M";[Red]-"$"#,##0.00,,"M"');
    expect(excelFormat(COLUMN_META.dv01)).toBe('"$"#,##0;[Red]-"$"#,##0');
    expect(excelFormat(COLUMN_META.wal)).toBe('0.00"y"');
    expect(excelFormat({ label: 'x', kind: 'measure', unit: 'bps' })).toBe('0.0" bps"');
    expect(excelFormat(COLUMN_META.desk)).toBeUndefined();
    expect(excelFormat(COLUMN_META.asOf)).toBeUndefined();
  });

  it('a reader\'s scale is more commas, decimals more zeros, accounting negatives parentheses (ADR-74)', () => {
    expect(excelFormat({ ...COLUMN_META.notional, scale: 'bn', dp: 2 })).toBe('"$"#,##0.00,,,"B";-"$"#,##0.00,,,"B"');
    expect(excelFormat({ ...COLUMN_META.notional, scale: 'units' })).toBe('"$"#,##0;-"$"#,##0');
    expect(excelFormat({ ...COLUMN_META.dv01, scale: 'k', negatives: 'parens' })).toBe('"$"#,##0.0,"K";[Red]("$"#,##0.0,"K")');
    expect(excelFormat({ ...COLUMN_META.yield, dp: 3, negatives: 'parens' })).toBe('0.000"%";(0.000"%")');
  });
});

describe('the workbook', () => {
  it('has the visible columns as headers, raw values with formats, and a total row', async () => {
    const t = build(parseView({ version: 1, columnVisibility: { asOf: false }, sorting: [{ id: 'notional', desc: true }] }));
    const bytes = await workbookBytes(t, { title: 'test book' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes);
    const ws = wb.getWorksheet('Positions')!;
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(t.getVisibleLeafColumns().map((c) => c.columnDef.meta!.label));
    expect(headers).not.toContain('As of');
    expect(ws.rowCount).toBe(1 + DATA.length + 1);
    // The first data row is the largest notional, stored raw, formatted in millions.
    const notionalCol = headers.indexOf('Notional') + 1;
    const first = ws.getRow(2);
    expect(first.getCell(notionalCol).value).toBe(Math.max(...DATA.map((r) => r.notional)));
    expect(first.getCell(notionalCol).numFmt).toBe(excelFormat(COLUMN_META.notional));
    const yieldCol = headers.indexOf('Yield') + 1;
    expect(first.getCell(yieldCol).numFmt).toBe('0.00"%"');
    // The total row sums what the filter left and carries the row count.
    const total = ws.getRow(ws.rowCount);
    expect(String(total.getCell(1).value)).toMatch(/^Total · 600 rows$/);
    expect(total.getCell(notionalCol).value).toBeCloseTo(DATA.reduce((a, r) => a + r.notional, 0), 3);
    expect(total.font?.bold).toBe(true);
  });

  it('exports what the screen shows: collapsed groups as subtotal rows, indented by depth', async () => {
    const t = build(parseView({ version: 1, grouping: ['desk'] }));
    const wb = buildWorkbook(t);
    const ws = wb.getWorksheet('Positions')!;
    expect(ws.rowCount).toBe(1 + DESKS.length + 1);
    const deskCol = 1;
    const row2 = ws.getRow(2);
    expect(DESKS).toContain(row2.getCell(deskCol).value);
    expect(row2.font?.bold).toBe(true);
    const notionalCol = t.getVisibleLeafColumns().findIndex((c) => c.id === 'notional') + 1;
    const desk = String(row2.getCell(deskCol).value);
    expect(row2.getCell(notionalCol).value).toBeCloseTo(
      DATA.filter((r) => r.desk === desk).reduce((a, r) => a + r.notional, 0), 3);
    // A group's dimensions it does not group by are blank, never a leaf's value.
    const cpCol = t.getVisibleLeafColumns().findIndex((c) => c.id === 'counterparty') + 1;
    expect(row2.getCell(cpCol).value).toBeNull();
  });
});

describe('the heat ramp', () => {
  it('is logarithmic over a positive range and clamps to 0..1', () => {
    expect(heatIntensity(1e6, [1e6, 1e9])).toBe(0);
    expect(heatIntensity(1e9, [1e6, 1e9])).toBe(1);
    expect(heatIntensity(Math.sqrt(1e15), [1e6, 1e9])).toBeCloseTo(0.5, 9);
    expect(heatIntensity(5e9, [1e6, 1e9])).toBe(1);
    expect(heatIntensity(-5, [-10, 10])).toBeCloseTo(0.25, 9);
    expect(heatIntensity('x', [0, 1])).toBeUndefined();
    expect(heatIntensity(1, undefined)).toBeUndefined();
    expect(heatIntensity(1, [1, 1])).toBeUndefined();
  });

  it('paints only a data hue, mixed — never the accent, which is selection and focus', () => {
    expect(heatBackground(0)).toBeUndefined();
    expect(heatBackground(undefined)).toBeUndefined();
    expect(heatBackground(1)).toBe('color-mix(in oklab, var(--cr-s1) 38%, transparent)');
    expect(heatBackground(0.5)).toMatch(/^color-mix\(in oklab, var\(--cr-s1\) 19%, transparent\)$/);
  });
});
