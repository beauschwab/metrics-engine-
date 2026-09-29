/**
 * Calculated columns (ADR-79): a reader's own measure, derived from two the
 * registry already governs, through a closed vocabulary of operations —
 * not a formula string. The vocabulary is what lets the column say its
 * unit honestly (NUM-01): a delta of two dollar columns is dollars, a ratio
 * of two same-unit columns is a percent, and `mtm + yield` is refused
 * before it can be a number. A calculated column is a scratch figure, a
 * draft under GOV-02: the header marks it, the export marks it, and the
 * agent contract lists it as the view's, never as a metric.
 *
 * Each operation also says how it rolls up: a group's value is the
 * operation applied to the operands' *aggregates* over the group's rows —
 * a ratio of sums, never a sum of ratios (the lesson of ADR-67). The SQL
 * compiler emits the same composition, so the engine and the client agree.
 */

import { constructAggregationFn } from '@tanstack/table-core';
import { aggregatedNumber } from './aggregations';
import type { ColumnMeta, Unit } from './meta';

export type ComputedOp = 'ratio' | 'delta' | 'sum' | 'pct_change' | 'scaled';
export const COMPUTED_OPS: readonly ComputedOp[] = ['ratio', 'delta', 'sum', 'pct_change', 'scaled'];
export const COMPUTED_OP_LABELS: Record<ComputedOp, string> = {
  ratio: 'A ÷ B, as a percent',
  delta: 'A − B',
  sum: 'A + B',
  pct_change: '(A − B) ÷ |B|, as a percent',
  scaled: 'A × k',
};
/** How many operands each operation takes. */
export const COMPUTED_ARITY: Record<ComputedOp, 1 | 2> = { ratio: 2, delta: 2, sum: 2, pct_change: 2, scaled: 1 };

export interface ComputedColumn {
  /** `c:` followed by a slug: never a registry column's id. */
  id: string;
  label: string;
  op: ComputedOp;
  /** Operand column ids: registry measures, in the operation's order. */
  of: string[];
  /** The factor for `scaled`. */
  k?: number;
}

export const COMPUTED_PREFIX = 'c:';
export const MAX_COMPUTED = 8;
export const isComputedId = (id: string): boolean => id.startsWith(COMPUTED_PREFIX);

/** A slug for a label: `MTM share` → `c:mtm_share`. */
export function computedIdFor(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return COMPUTED_PREFIX + (slug || 'calc');
}

const dollars = (u: Unit | undefined) => u === 'ccy' || u === 'mm';
const sameUnit = (a: ColumnMeta, b: ColumnMeta) => a.unit === b.unit || (dollars(a.unit) && dollars(b.unit));

/**
 * The unit a computed column reads in, or the reason it cannot exist.
 * Two operands must share a unit for every two-operand operation; the
 * difference and the sum keep it, the ratio and the change read as a
 * percent of the second operand.
 */
export function computedUnit(op: ComputedOp, a: ColumnMeta, b?: ColumnMeta): { unit?: Unit; dp?: number } | { error: string } {
  if (a.kind !== 'measure' || a.unit === 'date') return { error: `${a.label} is not a measure` };
  if (op === 'scaled') return { unit: a.unit, dp: a.dp };
  if (!b) return { error: 'the operation needs two measures' };
  if (b.kind !== 'measure' || b.unit === 'date') return { error: `${b.label} is not a measure` };
  if (!sameUnit(a, b)) return { error: `${a.label} and ${b.label} are in different units (NUM-01)` };
  if (op === 'ratio' || op === 'pct_change') return { unit: 'pct', dp: 2 };
  return { unit: a.unit, dp: Math.max(a.dp ?? 0, b.dp ?? 0) || undefined };
}

/** The operation on two numbers; undefined where it has no answer. */
export function evaluateComputed(spec: Pick<ComputedColumn, 'op' | 'k'>, a: unknown, b?: unknown): number | undefined {
  const x = typeof a === 'number' && Number.isFinite(a) ? a : undefined;
  const y = typeof b === 'number' && Number.isFinite(b) ? b : undefined;
  if (x === undefined) return undefined;
  switch (spec.op) {
    case 'scaled': return typeof spec.k === 'number' && Number.isFinite(spec.k) ? x * spec.k : undefined;
    case 'delta': return y === undefined ? undefined : x - y;
    case 'sum': return y === undefined ? undefined : x + y;
    case 'ratio': return y === undefined || y === 0 ? undefined : (x / y) * 100;
    case 'pct_change': return y === undefined || y === 0 ? undefined : ((x - y) / Math.abs(y)) * 100;
    default: return undefined;
  }
}

/** The meta a computed column carries, from its operands' meta. */
export function computedMeta(spec: ComputedColumn, metaOf: (id: string) => ColumnMeta | undefined): ColumnMeta | undefined {
  const a = metaOf(spec.of[0] ?? '');
  const b = spec.of[1] !== undefined ? metaOf(spec.of[1]) : undefined;
  if (!a) return undefined;
  const unit = computedUnit(spec.op, a, b);
  if ('error' in unit) return undefined;
  return { label: spec.label, kind: 'measure', unit: unit.unit, dp: unit.dp, band: 'Calculated', computed: true, width: 96 };
}

/** Everything wrong with a computed column, or nothing. */
export function computedIssues(spec: ComputedColumn, metaOf: (id: string) => ColumnMeta | undefined, registryIds: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  if (!/^c:[a-z0-9_]{1,32}$/.test(spec.id)) issues.push(`id must be c: followed by a slug: ${spec.id}`);
  if (registryIds.has(spec.id.slice(COMPUTED_PREFIX.length))) issues.push(`id shadows a registry column: ${spec.id}`);
  if (spec.label.trim().length === 0 || spec.label.length > 40) issues.push('label must be 1 to 40 characters');
  if (!COMPUTED_OPS.includes(spec.op)) { issues.push(`unknown operation: ${String(spec.op)}`); return issues; }
  const arity = COMPUTED_ARITY[spec.op];
  if (spec.of.length !== arity) issues.push(`${spec.op} takes ${arity} operand${arity === 1 ? '' : 's'}`);
  for (const id of spec.of) {
    if (isComputedId(id)) issues.push(`an operand must be a registry measure, not another calculated column: ${id}`);
    else if (!registryIds.has(id)) issues.push(`unknown column: ${id}`);
    else if (metaOf(id)?.kind !== 'measure') issues.push(`${id} is not a measure`);
  }
  if (spec.op === 'scaled' && !(typeof spec.k === 'number' && Number.isFinite(spec.k))) issues.push('scaled needs a finite k');
  if (issues.length === 0) {
    const unit = computedUnit(spec.op, metaOf(spec.of[0]!)!, spec.of[1] !== undefined ? metaOf(spec.of[1]) : undefined);
    if ('error' in unit) issues.push(unit.error);
  }
  return issues;
}

/** The value for one leaf row. */
export function computedValue(spec: ComputedColumn, row: Record<string, unknown>): number | undefined {
  return evaluateComputed(spec, row[spec.of[0]!], spec.of[1] !== undefined ? row[spec.of[1]] : undefined);
}

/**
 * The roll-up: the operation over the operands' aggregates for the same
 * rows, so a group reads a ratio of sums. Each operand aggregates by its
 * own rule — a weighted average stays weighted.
 */
export const computedAggregation = (spec: ComputedColumn) =>
  constructAggregationFn<any, any, number | undefined, number | undefined>({
    aggregate: (ctx) => {
      const over = (id: string) => aggregatedNumber(ctx.table.getColumn(id)?.getAggregationValue({ rows: ctx.rows }));
      return evaluateComputed(spec, over(spec.of[0]!), spec.of[1] !== undefined ? over(spec.of[1]) : undefined);
    },
  });

/** Whether an id is one the schema declares. */
export const isRegistryId = (id: string, registryIds: ReadonlySet<string>): boolean => registryIds.has(id);
