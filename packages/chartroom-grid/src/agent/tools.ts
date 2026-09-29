/**
 * The agent tools — pure functions over a source and a view (ADR-69).
 *
 * `describe_view` says what there is: the source, the current view, and the
 * contract an agent must write to. `query_view` answers a view exactly as
 * the screen would — the same headless row models, the same aggregations,
 * the same formatter — a window of rows at a time. `set_view` takes a patch
 * and returns the merged view or the issues that refused it; it never
 * guesses (ADR-44). No SQL, no fetch: a source is asked through the seam
 * (ADR-66), and the boundaries test holds `src/agent` to that.
 */

import { aggregatedNumber } from '../grid/aggregations';
import { COLUMN_META, COLUMN_ORDER } from '../grid/columns';
import { formatValue, type ColumnMeta } from '../grid/meta';
import { VIEW_VERSION, safeParseView, type ViewState } from '../grid/viewState';
import type { DataSource, SourceDescription } from '../data/source';
import type { Position } from '../data/mock';
import { headlessTable } from './headless';

export interface ContractColumn {
  id: string;
  label: string;
  kind: ColumnMeta['kind'];
  unit?: ColumnMeta['unit'];
  dp?: number;
  groupable: boolean;
  agg?: ColumnMeta['agg'];
  weightBy?: string;
  /** The filter shape this column takes in `columnFilters`. */
  filter: 'set' | 'range';
}

/** What an agent may write: the shape, in words an agent reads before it patches. */
export interface ViewContract {
  version: typeof VIEW_VERSION;
  columns: ContractColumn[];
  slices: Record<Exclude<keyof ViewState, 'version'>, string>;
  notes: string[];
}

export const VIEW_CONTRACT: ViewContract = {
  version: VIEW_VERSION,
  columns: COLUMN_ORDER.map((id) => {
    const m = COLUMN_META[id];
    return {
      id, label: m.label, kind: m.kind, unit: m.unit, dp: m.dp,
      groupable: !!m.groupable, agg: m.agg, weightBy: m.weightBy,
      filter: m.kind === 'dimension' ? 'set' : 'range',
    };
  }),
  slices: {
    grouping: 'string[] of groupable column ids, outermost first',
    columnFilters: '{ id, value }[] — a set filter takes value: string[] (keep rows whose value is one of these); a range filter takes value: [min|null, max|null], inclusive, null for an open end',
    globalFilter: 'string — a quick filter matched case-insensitively against every column',
    sorting: '{ id, desc: boolean }[] — first entry sorts first; measures sort numerically',
    expanded: 'true to expand every group, or { [groupRowId]: true } where a group row id is "column:value" joined by ">" per level',
    pagination: '{ pageIndex, pageSize } — carried, not driven until the data layer serves it',
    columnVisibility: '{ [columnId]: false } hides a column',
    columnOrder: 'string[] of column ids; columns not listed follow in declared order',
    columnPinning: '{ start: string[], end: string[] } — logical start/end, not left/right',
    columnSizing: '{ [columnId]: px }',
  },
  notes: [
    'Column ids must be ones the contract lists; unknown ids are refused with an issue naming them.',
    'A grouping on a column that is not groupable is refused, not rendered.',
    'A weighted average (agg: wavg) is Σ(x·w)/Σ(w) over the group, weighted by weightBy — never a mean of means.',
    'pct values are in percent units: 3.46 means 3.46%. mm values are raw dollars formatted in millions.',
  ],
};

export interface DescribeResult {
  source: SourceDescription;
  view: ViewState;
  contract: ViewContract;
}

export async function describeView(source: DataSource<Position>, view: ViewState): Promise<DescribeResult> {
  return { source: await source.describe(), view, contract: VIEW_CONTRACT };
}

export interface QueryViewOptions {
  /** Rows per answer, 1..1000; default 100. */
  limit?: number;
  offset?: number;
  /** Include each value formatted as the screen shows it. Default true. */
  display?: boolean;
  /** Expand every group regardless of the view's `expanded`. Default false: the answer is the view as it stands. */
  expandAll?: boolean;
}

export interface QueryRow {
  id: string;
  depth: number;
  kind: 'leaf' | 'group';
  group?: { column: string; value: string; count: number };
  values: Record<string, unknown>;
  display?: Record<string, string>;
}

export interface QueryViewResult {
  view: ViewState;
  columns: string[];
  rows: QueryRow[];
  /** Leaf rows the view's filters leave, in total. */
  total: number;
  /** Rows in the display model (groups included) the window was cut from. */
  modelRows: number;
  offset: number;
  truncated: boolean;
  totals: { values: Record<string, unknown>; display?: Record<string, string> };
  /** What the source itself already applied; the rest was done here. */
  applied: { filter: boolean; sort: boolean; group: boolean };
}

const MAX_LIMIT = 1000;

export async function queryView(
  source: DataSource<Position>,
  view: ViewState,
  options: QueryViewOptions = {},
): Promise<QueryViewResult> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(options.limit ?? 100)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const display = options.display ?? true;
  const answer = await source.query(view);
  const effective: ViewState = options.expandAll ? { ...view, expanded: true } : view;
  const table = headlessTable(answer.rows, effective);
  const columnsOut = table.getVisibleLeafColumns().map((c) => c.id);
  const model = table.getRowModel().rows;
  const window = model.slice(offset, offset + limit);

  const rows: QueryRow[] = window.map((row) => {
    const grouped = row.getIsGrouped();
    const values: Record<string, unknown> = {};
    const shown: Record<string, string> = {};
    for (const cell of row.getAllCells()) {
      const id = cell.column.id;
      if (!columnsOut.includes(id)) continue;
      const meta = cell.column.columnDef.meta;
      let v: unknown;
      if (cell.getIsGrouped()) v = row.groupingValue;
      else if (cell.getIsAggregated()) v = aggregatedNumber(cell.getValue());
      else if (cell.getIsPlaceholder() || grouped) v = undefined;
      else v = cell.getValue();
      if (v !== undefined) values[id] = v;
      if (display && meta && v !== undefined) shown[id] = formatValue(v, meta);
    }
    const out: QueryRow = { id: row.id, depth: row.depth, kind: grouped ? 'group' : 'leaf', values };
    if (grouped) {
      out.group = {
        column: String(row.groupingColumnId),
        value: String(row.groupingValue),
        count: row.getLeafRows().filter((r) => !r.getIsGrouped()).length,
      };
    }
    if (display) out.display = shown;
    return out;
  });

  const totals: QueryViewResult['totals'] = { values: {} };
  if (display) totals.display = {};
  for (const c of table.getVisibleLeafColumns()) {
    const meta = c.columnDef.meta;
    if (!meta || meta.kind !== 'measure' || !meta.agg) continue;
    const n = aggregatedNumber(c.getAggregationValue());
    if (n === undefined) continue;
    totals.values[c.id] = n;
    if (totals.display) totals.display[c.id] = formatValue(n, meta);
  }

  return {
    view: effective,
    columns: columnsOut,
    rows,
    total: table.getFilteredRowModel().rows.length,
    modelRows: model.length,
    offset,
    truncated: offset + window.length < model.length,
    totals,
    applied: answer.applied,
  };
}

export type SetViewResult = { ok: true; view: ViewState } | { ok: false; issues: string[] };

/**
 * Merge a patch into a view and validate the result. `replace: true` starts
 * from an empty view so the patch is the whole new view; otherwise a slice
 * the patch names replaces that slice and the rest stands.
 */
export function setView(view: ViewState, patch: unknown, options: { replace?: boolean } = {}): SetViewResult {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, issues: ['$: the patch must be an object of view slices'] };
  }
  const base = options.replace ? { version: VIEW_VERSION } : view;
  const merged = { ...base, ...(patch as Record<string, unknown>), version: VIEW_VERSION };
  const parsed = safeParseView(merged);
  return parsed.ok ? { ok: true, view: parsed.view } : { ok: false, issues: parsed.issues };
}
