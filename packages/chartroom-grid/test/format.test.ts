/**
 * A reader's formatting (ADR-74): decimals, the scale dollars are read at,
 * accounting negatives and the colourings — every one a reading of the same
 * stored number, never a change of its unit (NUM-01). The column's meta
 * carries the choice, so a cell, a footer, a copy and an export agree.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { generatePositions } from '../src/data/mock';
import { COLUMN_META, allowedFormatKeys, buildColumns, effectiveMeta } from '../src/grid/columns';
import { cellText } from '../src/grid/copy';
import { formatValue } from '../src/grid/meta';
import { parseView } from '../src/grid/viewState';

describe('formatValue with a reader\'s format', () => {
  it('scales dollars at thousands, millions and billions, with the decimals chosen', () => {
    const notional = COLUMN_META.notional;
    expect(formatValue(1_234_567_890, notional)).toBe('$1234.6M');
    expect(formatValue(1_234_567_890, { ...notional, scale: 'bn', dp: 2 })).toBe('$1.23B');
    expect(formatValue(1_234_567_890, { ...notional, scale: 'k', dp: 0 })).toBe('$1,234,568K');
    expect(formatValue(1_234_567_890, { ...notional, scale: 'units' })).toBe('$1,234,567,890');
    expect(formatValue(1_234_567_890, { ...notional, scale: 'units', dp: 2 })).toBe('$1,234,567,890.00');
    expect(formatValue(-2_500_000, { ...COLUMN_META.dv01, scale: 'm', dp: 1 })).toBe('-$2.5M');
  });

  it('writes accounting negatives in parentheses, in every unit', () => {
    expect(formatValue(-2_500_000, { ...COLUMN_META.notional, negatives: 'parens' })).toBe('($2.5M)');
    expect(formatValue(-3.456, { ...COLUMN_META.yield, negatives: 'parens', dp: 1 })).toBe('(3.5%)');
    expect(formatValue(-12.3, { label: 'x', kind: 'measure', unit: 'bps', negatives: 'parens' })).toBe('(12.3 bps)');
    expect(formatValue(2_500_000, { ...COLUMN_META.notional, negatives: 'parens' })).toBe('$2.5M');
  });

  it('a percent stays a percent: decimals change, the unit does not', () => {
    expect(formatValue(3.456, { ...COLUMN_META.yield, dp: 0 })).toBe('3%');
    expect(formatValue(3.456, { ...COLUMN_META.yield, dp: 4 })).toBe('3.4560%');
    expect(allowedFormatKeys('yield')).toEqual(['dp', 'negatives', 'negativeRed', 'heatmap']);
    expect(allowedFormatKeys('notional')).toEqual(['dp', 'scale', 'negatives', 'negativeRed', 'heatmap']);
    expect(allowedFormatKeys('desk')).toEqual([]);
  });
});

describe('the column carries the view\'s format', () => {
  const BOOK = generatePositions(200);

  it('effectiveMeta lays the format over the declared meta and ignores keys the column cannot take', () => {
    expect(effectiveMeta('notional')).toBe(COLUMN_META.notional);
    expect(effectiveMeta('notional', { notional: { scale: 'bn', dp: 2 } })).toMatchObject({ ...COLUMN_META.notional, scale: 'bn', dp: 2 });
    expect(effectiveMeta('yield', { yield: { scale: 'bn', dp: 1 } })).toMatchObject({ ...COLUMN_META.yield, dp: 1 });
    expect(effectiveMeta('yield', { yield: { scale: 'bn', dp: 1 } }).scale).toBeUndefined();
    expect(effectiveMeta('desk', { desk: { dp: 1 } })).toBe(COLUMN_META.desk);
  });

  it('a cell, a subtotal, the grand total and a copy all read the chosen format', () => {
    const view = parseView({ version: 3, grouping: ['desk'], expanded: true, columnFormats: { notional: { scale: 'bn', dp: 3 }, mtm: { negatives: 'parens', dp: 0, scale: 'units' } } });
    const t = headlessTable(BOOK, view);
    const notional = t.getColumn('notional')!;
    expect(notional.columnDef.meta).toMatchObject({ scale: 'bn', dp: 3 });
    const rows = t.getRowModel().rows;
    const group = rows.find((r) => r.getIsGrouped())!;
    const leaf = rows.find((r) => !r.getIsGrouped())!;
    const groupCell = group.getAllCells().find((c) => c.column.id === 'notional')!;
    const leafCell = leaf.getAllCells().find((c) => c.column.id === 'notional')!;
    expect(cellText(leafCell)).toMatch(/^\$\d+\.\d{3}B$/);
    expect(cellText(groupCell)).toMatch(/^\$\d+\.\d{3}B$/);
    const negative = rows.find((r) => !r.getIsGrouped() && r.original.mtm < 0)!;
    const mtmCell = negative.getAllCells().find((c) => c.column.id === 'mtm')!;
    expect(cellText(mtmCell)).toMatch(/^\(\$[\d,]+\)$/);
    expect(cellText(mtmCell, false)).toBe(String(negative.original.mtm));
    const total = notional.getAggregationValue();
    expect(formatValue(typeof total === 'number' ? total : Number(total), notional.columnDef.meta!)).toMatch(/^\$\d+\.\d{3}B$/);
    // The same columns without a format read as declared.
    expect(buildColumns()[9]!.meta).toBe(COLUMN_META.notional);
  });
});
