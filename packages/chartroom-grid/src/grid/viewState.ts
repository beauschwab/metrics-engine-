/**
 * The view state — the contract every consumer of the grid speaks.
 *
 * One JSON shape, versioned and zod-validated, that the UI edits, a saved
 * view stores, the URL carries, the query compiler reads and an agent is
 * handed (ADR-66). It is the table's state, slice for slice, with two
 * differences a plain `TableState` would not have: column ids are checked
 * against the columns that exist, and a grouping is checked against
 * `meta.groupable` — an agent that asks to group by trade id is refused at
 * the boundary, not rendered as fifty thousand groups.
 *
 * `pagination` is carried but not driven: the paginated row model is not
 * registered (ADR-64), so the slice waits for the server-side modes of
 * Phase 5 — TODO(grid-phase-5).
 */

import { z } from 'zod';
import type { ColumnFiltersState, TableState } from '@tanstack/table-core';
import type { Features } from './features';
import { allowedAggs, allowedFormatKeysFor, metaFor } from './columns';
import { TREASURY_SCHEMA } from '../data/treasury';
import { idsOf, type GridSchema } from './schema';
import { COMPUTED_OPS, MAX_COMPUTED, computedIssues, isComputedId, type ComputedColumn, type ComputedOp } from './computed';
import { isPivotId } from './pivot';
import {
  AGGS, DECIMALS, EMPHASES, MAX_RULES, NEGATIVES, RULE_OPS, SCALES, type Agg, type ColumnFormat, type Emphasis, type Negatives, type RuleOp, type Scale,
} from './meta';

/**
 * Version 2 added `columnAggs` (ADR-72); version 3 added `columnFormats`
 * (ADR-74). An older document is migrated on read — the same JSON, one
 * empty slice more per step — so every saved view and every link written
 * before it still parses.
 */
export const VIEW_VERSION = 6 as const;

export function migrateView(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  let v = input as Record<string, unknown>;
  if (v.version === 1) v = { ...v, version: 2, columnAggs: v.columnAggs ?? {} };
  if (v.version === 2) v = { ...v, version: 3, columnFormats: v.columnFormats ?? {} };
  if (v.version === 3) v = { ...v, version: 4, computedColumns: v.computedColumns ?? [] };
  if (v.version === 4) v = { ...v, version: 5, pivot: v.pivot ?? { column: null, values: [] } };
  // Version 6 (ADR-86): the pivot names which of the dimension's values become columns; none named means every value.
  if (v.version === 5) {
    const pivot = (v.pivot ?? { column: null, values: [] }) as Record<string, unknown>;
    v = { ...v, version: 6, pivot: { ...pivot, buckets: pivot.buckets ?? [] } };
  }
  return v;
}

/** The zod schema for one grid schema's views, built once per schema. */
function buildViewSchema(schema: GridSchema) {
const KNOWN = idsOf(schema);
// A `c:` id is a calculated column's (ADR-79): accepted here, and checked
// against the view's own `computedColumns` once the whole view is parsed.
// A `p:` id is a pivot column's (ADR-80): its values come from the data,
// so it is accepted by shape and simply absent when the data lacks it.
const columnId = z.string().refine((id) => KNOWN.has(id) || isComputedId(id) || isPivotId(id), (id) => ({ message: `unknown column: ${id}` }));
const measureId = columnId.refine((id) => schema.columns[id]?.kind === 'measure', (id) => ({ message: `column is not a measure: ${id}` }));
const groupableId = columnId.refine(
  (id) => !!schema.columns[id]?.groupable,
  (id) => ({ message: `column is not groupable: ${id}` }),
);
const byColumn = <V extends z.ZodTypeAny>(value: V) =>
  z.record(z.string(), value).superRefine((rec, ctx) => {
    for (const k of Object.keys(rec)) {
      if (!KNOWN.has(k) && !isComputedId(k) && !isPivotId(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown column: ${k}`, path: [k] });
    }
  });

const ComputedColumnSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  op: z.enum(COMPUTED_OPS as [ComputedOp, ...ComputedOp[]]),
  of: z.array(z.string()).min(1).max(2),
  k: z.number().finite().optional(),
});

/** The checks that need the whole view: calculated ids against their definitions. */
const crossCheck = (v: { [k: string]: unknown }, ctx: z.RefinementCtx): void => {
  const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
  const computed = (v.computedColumns ?? []) as ComputedColumn[];
  const metaOf = (id: string) => schema.columns[id];
  const seen = new Set<string>();
  computed.forEach((c, i) => {
    for (const m of computedIssues(c, metaOf, KNOWN)) issue(m, ['computedColumns', i]);
    if (seen.has(c.id)) issue(`duplicate calculated column: ${c.id}`, ['computedColumns', i, 'id']);
    seen.add(c.id);
  });
  const defined = (id: string, path: (string | number)[]) => {
    if (isComputedId(id) && !seen.has(id)) issue(`unknown calculated column: ${id}`, path);
  };
  (v.columnOrder as string[]).forEach((id, i) => defined(id, ['columnOrder', i]));
  (v.sorting as { id: string }[]).forEach((s, i) => defined(s.id, ['sorting', i, 'id']));
  (v.columnFilters as { id: string; value?: unknown }[]).forEach((f, i) => {
    defined(f.id, ['columnFilters', i, 'id']);
    if (isPivotId(f.id)) { issue(`a pivot column is not filtered; filter its measure or its dimension: ${f.id}`, ['columnFilters', i, 'id']); return; }
    // The value's shape follows the column's kind, as the contract says: a
    // dimension keeps rows whose value is one of a list of strings; a
    // measure (a calculated column is one) an inclusive range whose ends
    // are finite numbers or null. Any other shape would read differently
    // in memory and in SQL, so it is refused here.
    const measure = isComputedId(f.id) || metaOf(f.id)?.kind === 'measure';
    const value = f.value;
    if (measure) {
      const end = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x));
      if (!Array.isArray(value) || value.length !== 2 || !value.every(end)) {
        issue(`a range filter on ${f.id} takes [min|null, max|null] of finite numbers`, ['columnFilters', i, 'value']);
      }
    } else if (metaOf(f.id) && (!Array.isArray(value) || !value.every((x) => typeof x === 'string'))) {
      issue(`a set filter on ${f.id} takes a list of strings`, ['columnFilters', i, 'value']);
    }
  });
  for (const k of Object.keys(v.columnVisibility as object)) defined(k, ['columnVisibility', k]);
  for (const k of Object.keys(v.columnSizing as object)) defined(k, ['columnSizing', k]);
  const pinning = v.columnPinning as { start: string[]; end: string[] };
  pinning.start.forEach((id, i) => defined(id, ['columnPinning', 'start', i]));
  pinning.end.forEach((id, i) => defined(id, ['columnPinning', 'end', i]));
  for (const [k, format] of Object.entries(v.columnFormats as Record<string, Record<string, unknown>>)) {
    if (!isComputedId(k)) continue;
    defined(k, ['columnFormats', k]);
    if (!seen.has(k)) continue;
    const allowed = allowedFormatKeysFor(metaFor(k, computed, schema));
    for (const key of Object.keys(format)) {
      if (format[key] !== undefined && !allowed.includes(key as never)) issue(`${key} is not a format ${k} can take`, ['columnFormats', k, key]);
    }
  }
};

return z
  .object({
    version: z.literal(VIEW_VERSION),
    grouping: z.array(groupableId).default([]),
    // Pivot mode (ADR-80): a groupable dimension across the top, measures under each value.
    pivot: z.strictObject({
      column: groupableId.nullable(),
      values: z.array(measureId),
      // The values across the top (ADR-86): named ones in this order, or every value the source has when none are named.
      buckets: z.array(z.string().min(1)).default([]),
    }).default({ column: null, values: [], buckets: [] }),
    // A reader's calculated columns (ADR-79): a closed operation over registry measures.
    computedColumns: z.array(ComputedColumnSchema).max(MAX_COMPUTED, `at most ${MAX_COMPUTED} calculated columns; a ninth is a model`).default([]),
    columnFilters: z.array(z.object({ id: columnId, value: z.unknown() })).default([]),
    globalFilter: z.string().default(''),
    sorting: z.array(z.object({ id: columnId, desc: z.boolean() })).default([]),
    expanded: z.union([z.literal(true), z.record(z.string(), z.boolean())]).default({}),
    pagination: z
      .object({ pageIndex: z.number().int().min(0), pageSize: z.number().int().positive() })
      .default({ pageIndex: 0, pageSize: 100 }),
    columnVisibility: byColumn(z.boolean()).default({}),
    columnOrder: z.array(columnId).default([]),
    // v9 pins by logical direction — `start`/`end`, not left/right — so a
    // view means the same thing in an RTL layout.
    columnPinning: z
      .object({ start: z.array(columnId).default([]), end: z.array(columnId).default([]) })
      .default({}),
    columnSizing: byColumn(z.number().positive()).default({}),
    // A measure's aggregation, overriding the meta's (ADR-72): only a
    // registered name, only on a measure, `wavg` only where a weight exists.
    columnAggs: z
      .record(z.string(), z.enum(AGGS as [Agg, ...Agg[]]))
      .superRefine((rec, ctx) => {
        for (const [k, agg] of Object.entries(rec)) {
          if (isComputedId(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `a calculated column's aggregation follows its operands: ${k}`, path: [k] });
          else if (isPivotId(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `a pivot column aggregates as its measure does: ${k}`, path: [k] });
          else if (!KNOWN.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown column: ${k}`, path: [k] });
          else if (!allowedAggs(k, schema).includes(agg)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${agg} is not an aggregation ${k} can take`, path: [k] });
          }
        }
      })
      .default({}),
    // A measure's reading, within its unit (ADR-74, NUM-01): decimals,
    // the scale dollars are read at, accounting negatives, the colourings.
    columnFormats: z
      .record(z.string(), z
        .object({
          dp: z.number().int().refine((n) => DECIMALS.includes(n), 'decimals must be 0 to 4').optional(),
          scale: z.enum(SCALES as [Scale, ...Scale[]]).optional(),
          negatives: z.enum(NEGATIVES as [Negatives, ...Negatives[]]).optional(),
          negativeRed: z.boolean().optional(),
          heatmap: z.boolean().optional(),
          rules: z.array(z.strictObject({
            op: z.enum(RULE_OPS as [RuleOp, ...RuleOp[]]),
            value: z.number().finite(),
            emphasis: z.enum(EMPHASES as [Emphasis, ...Emphasis[]]),
          })).max(MAX_RULES, `at most ${MAX_RULES} rules; a threshold belongs in the registry`).optional(),
        })
        .strict())
      .superRefine((rec, ctx) => {
        for (const [k, format] of Object.entries(rec)) {
          if (isComputedId(k)) continue; // checked against the view's definitions in crossCheck
          if (isPivotId(k)) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `a pivot column reads as its measure does; format the measure: ${k}`, path: [k] }); continue; }
          if (!KNOWN.has(k)) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown column: ${k}`, path: [k] }); continue; }
          const allowed = allowedFormatKeysFor(metaFor(k, [], schema));
          for (const key of Object.keys(format) as (keyof ColumnFormat)[]) {
            if (format[key] === undefined) continue;
            if (allowed.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${k} is a dimension and has no format`, path: [k, key] });
            else if (!allowed.includes(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${key} is not a format ${k} can take`, path: [k, key] });
          }
        }
      })
      .default({}),
  })
  .strict()
  .superRefine(crossCheck);
}

const viewSchemas = new WeakMap<GridSchema, ReturnType<typeof buildViewSchema>>();
export function viewSchemaFor(schema: GridSchema = TREASURY_SCHEMA) {
  let v = viewSchemas.get(schema);
  if (!v) { v = buildViewSchema(schema); viewSchemas.set(schema, v); }
  return v;
}

/** The treasury book's view schema — the default every caller had before ADR-82. */
export const ViewStateSchema = viewSchemaFor(TREASURY_SCHEMA);

/**
 * The parsed shape. `columnFilters` is stated as the table's own type: zod
 * infers `value?: unknown` for an unknown, and the table's `ColumnFilter`
 * requires the key — the same runtime value either way.
 */
export type ViewState = Omit<z.infer<typeof ViewStateSchema>, 'columnFilters'> & {
  columnFilters: ColumnFiltersState;
};

/** A view with nothing applied: every default, current version. */
export const defaultView = (schema: GridSchema = TREASURY_SCHEMA): ViewState => parseView({ version: VIEW_VERSION }, schema);

/** Parse untrusted JSON into a view, or throw the zod error naming what is wrong. */
export function parseView(input: unknown, schema: GridSchema = TREASURY_SCHEMA): ViewState {
  return viewSchemaFor(schema).parse(migrateView(input)) as ViewState;
}

/** The safe form for callers that render the reason rather than throw (ADR-44). */
export function safeParseView(input: unknown, schema: GridSchema = TREASURY_SCHEMA): { ok: true; view: ViewState } | { ok: false; issues: string[] } {
  const r = viewSchemaFor(schema).safeParse(migrateView(input));
  return r.success
    ? { ok: true, view: r.data as ViewState }
    : { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '$'}: ${i.message}`) };
}

/** The slices the registered features drive, in the table's own shape. */
export type ViewSlice = keyof ReturnType<typeof toTableState>;

export function toTableState(view: ViewState) {
  // Pagination is deliberately absent — TODO(grid-phase-5).
  return {
    grouping: view.grouping,
    columnFilters: view.columnFilters,
    globalFilter: view.globalFilter,
    sorting: view.sorting,
    expanded: view.expanded,
    columnVisibility: view.columnVisibility,
    columnOrder: view.columnOrder,
    columnPinning: view.columnPinning,
    columnSizing: view.columnSizing,
    // `columnAggs` is not table state: it shapes the column definitions.
  } satisfies Partial<TableState<Features>>;
}
