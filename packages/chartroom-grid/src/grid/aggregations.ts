/**
 * The aggregations the meta can name that v9 does not ship — one so far.
 *
 * `wavg` is a weighted average that decomposes: a group carries Σ(x·w) and
 * Σ(w), and a parent merges its children's pairs rather than re-reading the
 * leaves, so the number at every level of a nested grouping is the same
 * number a brute-force pass over the leaves would give — the tests hold it
 * to that. A mean of the sub-group means would be wrong the moment two
 * sub-groups differ in size, which in a treasury book is always (ADR-67).
 *
 * The weight column is read from meta (`weightBy`), never from a per-feature
 * list. A row with a non-finite value or weight, or a zero total weight,
 * contributes nothing — the cell renders the missing dash (ADR-44).
 */

import { constructAggregationFn, type AggregationContext, type Row } from '@tanstack/table-core';
import type { ColumnMeta } from './meta';

/** The decomposable pair a `wavg` group carries. */
export interface WavgParts {
  sumXW: number;
  sumW: number;
}

/** Brute force over any rows: the reference the decomposed path must equal. */
export function weightedAverage(xs: readonly number[], ws: readonly number[]): number | undefined {
  let sumXW = 0;
  let sumW = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const w = ws[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(w)) continue;
    sumXW += x * w;
    sumW += w;
  }
  return sumW === 0 ? undefined : sumXW / sumW;
}

const weightOf = (ctx: AggregationContext<any, any, unknown>): string => {
  const meta = ctx.column.columnDef.meta as ColumnMeta | undefined;
  const weightBy = meta?.weightBy;
  if (!weightBy) throw new Error(`wavg on ${ctx.columnId} needs meta.weightBy`);
  return weightBy;
};

const partsOf = (rows: ReadonlyArray<Row<any, any>>, columnId: string, weightBy: string): WavgParts => {
  let sumXW = 0;
  let sumW = 0;
  for (const row of rows) {
    const x = row.getValue<number>(columnId);
    const w = row.getValue<number>(weightBy);
    if (!Number.isFinite(x) || !Number.isFinite(w)) continue;
    sumXW += x * w;
    sumW += w;
  }
  return { sumXW, sumW };
};

/**
 * The registered result is the average, so a cell reads one number; the
 * parts ride along on the result object so `merge` can combine children
 * without touching a leaf. `valueOf` lets a numeric read (a sort, a format)
 * see the average alone.
 */
export class Wavg extends Number implements WavgParts {
  readonly sumXW: number;
  readonly sumW: number;
  constructor(parts: WavgParts) {
    super(parts.sumW === 0 ? Number.NaN : parts.sumXW / parts.sumW);
    this.sumXW = parts.sumXW;
    this.sumW = parts.sumW;
  }
  get value(): number | undefined {
    return this.sumW === 0 ? undefined : this.sumXW / this.sumW;
  }
}

export const wavg = constructAggregationFn<any, any, unknown, Wavg>({
  aggregate: (ctx) => new Wavg(partsOf(ctx.rows, ctx.columnId, weightOf(ctx))),
  merge: ({ subRowResults }) =>
    new Wavg(
      subRowResults.reduce<WavgParts>(
        (acc, r) => ({ sumXW: acc.sumXW + r.sumXW, sumW: acc.sumW + r.sumW }),
        { sumXW: 0, sumW: 0 },
      ),
    ),
});

/** What a cell shows for an aggregated value: the number, or nothing to show. */
export function aggregatedNumber(value: unknown): number | undefined {
  if (value instanceof Wavg) return value.value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return undefined;
}
