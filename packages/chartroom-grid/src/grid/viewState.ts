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
import { COLUMN_META, COLUMN_ORDER, allowedAggs, allowedFormatKeys } from './columns';
import {
  AGGS, DECIMALS, EMPHASES, MAX_RULES, NEGATIVES, RULE_OPS, SCALES, type Agg, type ColumnFormat, type Emphasis, type Negatives, type RuleOp, type Scale,
} from './meta';
import type { Position } from '../data/mock';

/**
 * Version 2 added `columnAggs` (ADR-72); version 3 added `columnFormats`
 * (ADR-74). An older document is migrated on read — the same JSON, one
 * empty slice more per step — so every saved view and every link written
 * before it still parses.
 */
export const VIEW_VERSION = 3 as const;

export function migrateView(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  let v = input as Record<string, unknown>;
  if (v.version === 1) v = { ...v, version: 2, columnAggs: v.columnAggs ?? {} };
  if (v.version === 2) v = { ...v, version: 3, columnFormats: v.columnFormats ?? {} };
  return v;
}

const KNOWN = new Set<string>(COLUMN_ORDER);
const columnId = z.string().refine((id) => KNOWN.has(id), (id) => ({ message: `unknown column: ${id}` }));
const groupableId = columnId.refine(
  (id) => !!COLUMN_META[id as keyof typeof COLUMN_META]?.groupable,
  (id) => ({ message: `column is not groupable: ${id}` }),
);
const byColumn = <V extends z.ZodTypeAny>(value: V) =>
  z.record(z.string(), value).superRefine((rec, ctx) => {
    for (const k of Object.keys(rec)) {
      if (!KNOWN.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown column: ${k}`, path: [k] });
    }
  });

export const ViewStateSchema = z
  .object({
    version: z.literal(VIEW_VERSION),
    grouping: z.array(groupableId).default([]),
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
          if (!KNOWN.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown column: ${k}`, path: [k] });
          else if (!allowedAggs(k as keyof Position).includes(agg)) {
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
          if (!KNOWN.has(k)) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unknown column: ${k}`, path: [k] }); continue; }
          const allowed = allowedFormatKeys(k as keyof Position);
          for (const key of Object.keys(format) as (keyof ColumnFormat)[]) {
            if (format[key] === undefined) continue;
            if (allowed.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${k} is a dimension and has no format`, path: [k, key] });
            else if (!allowed.includes(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${key} is not a format ${k} can take`, path: [k, key] });
          }
        }
      })
      .default({}),
  })
  .strict();

/**
 * The parsed shape. `columnFilters` is stated as the table's own type: zod
 * infers `value?: unknown` for an unknown, and the table's `ColumnFilter`
 * requires the key — the same runtime value either way.
 */
export type ViewState = Omit<z.infer<typeof ViewStateSchema>, 'columnFilters'> & {
  columnFilters: ColumnFiltersState;
};

/** A view with nothing applied: every default, current version. */
export const defaultView = (): ViewState => parseView({ version: VIEW_VERSION });

/** Parse untrusted JSON into a view, or throw the zod error naming what is wrong. */
export function parseView(input: unknown): ViewState {
  return ViewStateSchema.parse(migrateView(input)) as ViewState;
}

/** The safe form for callers that render the reason rather than throw (ADR-44). */
export function safeParseView(input: unknown): { ok: true; view: ViewState } | { ok: false; issues: string[] } {
  const r = ViewStateSchema.safeParse(migrateView(input));
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
