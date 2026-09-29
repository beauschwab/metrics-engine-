/**
 * Calculated columns (ADR-79): a closed operation over registry measures,
 * with a unit the operation derives and a roll-up that is the operation
 * over the operands' aggregates — a ratio of sums, never a sum of ratios.
 */

import { describe, expect, it } from 'vitest';
import { headlessTable } from '../src/agent/headless';
import { generatePositions } from '../src/data/mock';
import { COLUMN_META } from '../src/grid/columns';
import { cellText } from '../src/grid/copy';
import { computedIdFor, computedUnit, evaluateComputed, type ComputedColumn } from '../src/grid/computed';
import { parseView } from '../src/grid/viewState';

const BOOK = generatePositions(1500);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('computedUnit', () => {
  it('keeps a shared unit for delta and sum, reads ratio and change as percent, scaled as the first, and refuses a mix', () => {
    expect(computedUnit('delta', COLUMN_META.mtm, COLUMN_META.notional)).toEqual({ unit: 'mm', dp: 2 });
    expect(computedUnit('sum', COLUMN_META.dv01, COLUMN_META.cs01)).toEqual({ unit: 'ccy', dp: undefined });
    expect(computedUnit('sum', COLUMN_META.dv01, COLUMN_META.mtm)).toEqual({ unit: 'ccy', dp: 2 });
    expect(computedUnit('ratio', COLUMN_META.mtm, COLUMN_META.notional)).toEqual({ unit: 'pct', dp: 2 });
    expect(computedUnit('pct_change', COLUMN_META.yield, COLUMN_META.yield)).toEqual({ unit: 'pct', dp: 2 });
    expect(computedUnit('scaled', COLUMN_META.wal)).toEqual({ unit: 'years', dp: undefined });
    expect(computedUnit('delta', COLUMN_META.mtm, COLUMN_META.yield)).toMatchObject({ error: expect.stringMatching(/different units \(NUM-01\)/) });
    expect(computedUnit('ratio', COLUMN_META.desk, COLUMN_META.mtm)).toMatchObject({ error: /not a measure/ });
    expect(computedUnit('delta', COLUMN_META.mtm)).toMatchObject({ error: /two measures/ });
  });
});

describe('evaluateComputed', () => {
  it('does the arithmetic and has no answer for a missing operand or a zero divisor', () => {
    expect(evaluateComputed({ op: 'ratio' }, 25, 200)).toBe(12.5);
    expect(evaluateComputed({ op: 'delta' }, 5, 8)).toBe(-3);
    expect(evaluateComputed({ op: 'sum' }, 5, 8)).toBe(13);
    expect(evaluateComputed({ op: 'pct_change' }, 110, -100)).toBe(210);
    expect(evaluateComputed({ op: 'scaled', k: 100 }, 1.5)).toBe(150);
    expect(evaluateComputed({ op: 'ratio' }, 25, 0)).toBeUndefined();
    expect(evaluateComputed({ op: 'delta' }, undefined, 8)).toBeUndefined();
    expect(evaluateComputed({ op: 'delta' }, 5, Number.NaN)).toBeUndefined();
    expect(evaluateComputed({ op: 'scaled' }, 5)).toBeUndefined();
    expect(computedIdFor('MTM share (%)')).toBe('c:mtm_share');
  });
});

describe('the table carries a calculated column', () => {
  const share: ComputedColumn = { id: 'c:mtm_share', label: 'MTM share', op: 'ratio', of: ['mtm', 'notional'] };
  const risk: ComputedColumn = { id: 'c:risk', label: 'Rate + credit', op: 'sum', of: ['dv01', 'cs01'] };
  const bp: ComputedColumn = { id: 'c:yield_bp', label: 'Yield in bp', op: 'scaled', of: ['yield'], k: 100 };

  it('a leaf cell is the arithmetic on the row, formatted in the derived unit', () => {
    const t = headlessTable(BOOK, parseView({ version: 4, computedColumns: [share, risk, bp] }));
    const row = t.getRowModel().rows[0]!;
    const p = row.original;
    expect(row.getValue('c:mtm_share')).toBeCloseTo((p.mtm / p.notional) * 100, 9);
    expect(row.getValue('c:risk')).toBe(p.dv01 + p.cs01);
    expect(row.getValue('c:yield_bp')).toBeCloseTo(p.yield * 100, 9);
    const cell = row.getAllCells().find((c) => c.column.id === 'c:mtm_share')!;
    expect(cellText(cell)).toMatch(/^-?\d+\.\d{2}%$/);
    expect(cell.column.columnDef.meta).toMatchObject({ label: 'MTM share', kind: 'measure', unit: 'pct', band: 'Calculated', computed: true });
  });

  it('a subtotal and the grand total are the operation over the operands\' aggregates, against brute force', () => {
    const t = headlessTable(BOOK, parseView({ version: 4, grouping: ['desk'], expanded: true, computedColumns: [share, risk], columnAggs: { dv01: 'mean' } }));
    const groups = t.getRowModel().rows.filter((r) => r.getIsGrouped());
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      const leaves = g.getLeafRows().filter((r) => !r.getIsGrouped()).map((r) => r.original);
      const expectedShare = (sum(leaves.map((p) => p.mtm)) / sum(leaves.map((p) => p.notional))) * 100;
      expect(g.getValue<number>('c:mtm_share')).toBeCloseTo(expectedShare, 6);
      // A mean of ratios would be a different, wrong number.
      const meanOfRatios = sum(leaves.map((p) => (p.mtm / p.notional) * 100)) / leaves.length;
      expect(g.getValue<number>('c:mtm_share')).not.toBeCloseTo(meanOfRatios, 4);
      // The operand's own aggregation is honoured: dv01 reads as a mean here.
      const expectedRisk = sum(leaves.map((p) => p.dv01)) / leaves.length + sum(leaves.map((p) => p.cs01));
      expect(g.getValue<number>('c:risk')).toBeCloseTo(expectedRisk, 6);
    }
    const total = t.getColumn('c:mtm_share')!.getAggregationValue();
    expect(total).toBeCloseTo((sum(BOOK.map((p) => p.mtm)) / sum(BOOK.map((p) => p.notional))) * 100, 6);
  });

  it('sorts and range-filters by a calculated column on the client', () => {
    const t = headlessTable(BOOK, parseView({
      version: 4, computedColumns: [share], sorting: [{ id: 'c:mtm_share', desc: true }], columnFilters: [{ id: 'c:mtm_share', value: [0, null] }],
    }));
    const rows = t.getRowModel().rows.map((r) => r.getValue<number>('c:mtm_share'));
    expect(rows.length).toBe(BOOK.filter((p) => p.mtm / p.notional >= 0).length);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!).toBeLessThanOrEqual(rows[i - 1]!);
  });
});
