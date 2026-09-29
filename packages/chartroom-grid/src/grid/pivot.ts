/**
 * Pivot mode (ADR-80): one dimension across the top, the measures under
 * each of its values. Desk down the side and currency across is the view
 * a treasury desk builds in a spreadsheet every morning; here it is one
 * more slice of the view — the pivot column and the measures it spreads —
 * and everything else follows: a pivot column is a real column with an
 * accessor that reads the measure only for rows in its bucket, a meta
 * that is the measure's with the bucket's value as its band (so the
 * header bands of ADR-75 draw the value row for free), and an aggregation
 * that is the measure's own rule over the rows of the bucket — a weighted
 * average stays weighted, a count counts the bucket.
 *
 * The values across the top are the column's distinct values over the
 * whole source, not over the filtered rows, so a filter narrows the cells
 * and never makes a column vanish under the reader's eye. The pivoted
 * measures keep their own column after the buckets, under a Total band.
 */

import { constructAggregationFn, type Row } from '@tanstack/table-core';
import type { GridRecord } from './schema';
import { isGroupNode } from '../data/groupNode';
import { Wavg, type WavgParts } from './aggregations';
import type { Agg, ColumnMeta } from './meta';

export interface PivotState {
  /** The dimension across the top, or null when not pivoting. */
  column: string | null;
  /** The measures spread under each value; empty means every visible measure. */
  values: string[];
}

export const PIVOT_PREFIX = 'p:';
export const isPivotId = (id: string): boolean => id.startsWith(PIVOT_PREFIX);

/** `p:<measure>:<value>` — the measure first so a bucket's columns sort together by band. */
export const pivotId = (measure: string, value: string): string => `${PIVOT_PREFIX}${measure}:${value}`;

/** The parts of a pivot id, or undefined. */
export function parsePivotId(id: string): { measure: string; value: string } | undefined {
  if (!isPivotId(id)) return undefined;
  const rest = id.slice(PIVOT_PREFIX.length);
  const i = rest.indexOf(':');
  if (i <= 0) return undefined;
  return { measure: rest.slice(0, i), value: rest.slice(i + 1) };
}

/** The distinct values of a column over leaf rows, in reading order. */
export function distinctValues(rows: readonly GridRecord[], column: string): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (isGroupNode(r)) continue;
    const v = r[column];
    if (v !== undefined && v !== null && v !== '') seen.add(String(v));
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** The meta a pivot column carries: the measure's, banded by the bucket's value. */
export function pivotMeta(measureMeta: ColumnMeta, value: string): ColumnMeta {
  return { ...measureMeta, band: value, pivot: true };
}

/**
 * A leaf row's value for the bucket: the measure where the row is in it,
 * nothing otherwise. An engine-made group node carries the bucketed
 * aggregate under the pivot id itself (ADR-70, ADR-80).
 */
export function pivotValue(row: GridRecord, pivotColumn: string, measure: string, value: string): unknown {
  const r = row;
  if (isGroupNode(row)) return r[pivotId(measure, value)];
  return String(r[pivotColumn] ?? '') === value ? r[measure] : undefined;
}

const inBucket = (row: Row<any, any>, pivotColumn: string, value: string): boolean => {
  const o = row.original as GridRecord;
  if (isGroupNode(o)) return true;
  return String(o[pivotColumn] ?? '') === value;
};

const numbers = (rows: ReadonlyArray<Row<any, any>>, id: string, pivotColumn: string, value: string): number[] => {
  const out: number[] = [];
  for (const r of rows) {
    if (!inBucket(r, pivotColumn, value)) continue;
    const v = r.getValue<unknown>(id);
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
};

/**
 * The measure's own aggregation over the rows of the bucket. Registry
 * aggregations count every row a group holds; a bucket is a subset, so
 * each rule is restated here over the bucket's rows — the same arithmetic,
 * narrowed — and a weighted average keeps its parts for a merge.
 */
export function pivotAggregation(agg: Agg, measure: string, weightBy: string | undefined, pivotColumn: string, value: string) {
  const id = pivotId(measure, value);
  return constructAggregationFn<any, any, unknown, unknown>({
    aggregate: (ctx) => {
      const rows = ctx.rows;
      // An engine-made level: the nodes already carry the bucket's aggregate; merge them.
      const nodes = rows.filter((r) => isGroupNode(r.original));
      if (nodes.length > 0 && nodes.length === rows.length) {
        const xs = numbers(rows, id, pivotColumn, value);
        if (agg === 'wavg') {
          let sumXW = 0; let sumW = 0;
          for (const r of rows) {
            const o = r.original as GridRecord;
            const xw = o[`${id}__xw`]; const w = o[`${id}__w`];
            if (typeof xw === 'number' && typeof w === 'number') { sumXW += xw; sumW += w; }
          }
          return new Wavg({ sumXW, sumW });
        }
        return combine(agg, xs);
      }
      if (agg === 'wavg') {
        const parts: WavgParts = { sumXW: 0, sumW: 0 };
        for (const r of rows) {
          if (!inBucket(r, pivotColumn, value)) continue;
          const x = r.getValue<number>(measure);
          const w = weightBy ? r.getValue<number>(weightBy) : Number.NaN;
          if (!Number.isFinite(x) || !Number.isFinite(w)) continue;
          parts.sumXW += x * w; parts.sumW += w;
        }
        return new Wavg(parts);
      }
      const xs = numbers(rows, measure, pivotColumn, value);
      if (agg === 'count') return rows.filter((r) => inBucket(r, pivotColumn, value)).length;
      return combine(agg, xs);
    },
  });
}

function combine(agg: Agg, xs: number[]): unknown {
  switch (agg) {
    case 'sum': return xs.reduce((a, b) => a + b, 0);
    case 'min': return xs.length ? Math.min(...xs) : undefined;
    case 'max': return xs.length ? Math.max(...xs) : undefined;
    case 'mean': return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
    case 'median': {
      if (!xs.length) return undefined;
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1]! + s[m]!) / 2;
    }
    case 'count': return xs.length;
    case 'uniqueCount': return new Set(xs).size;
    default: return undefined;
  }
}
