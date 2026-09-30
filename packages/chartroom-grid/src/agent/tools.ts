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
import { allowedAggs, allowedFormatKeys } from '../grid/columns';
import { schemaFromDescription, type GridSchema } from '../grid/schema';
import { TREASURY_SCHEMA } from '../data/treasury';
import { type ColumnFormat, formatValue, type ColumnMeta, aggregateMeta } from '../grid/meta';
import { VIEW_VERSION, safeParseView, type ViewState } from '../grid/viewState';
import type { DataSource, SourceDescription } from '../data/source';
import type { GridRecord } from '../grid/schema';
import { headlessTable } from './headless';

export interface ContractColumn {
  id: string;
  label: string;
  kind: ColumnMeta['kind'];
  unit?: ColumnMeta['unit'];
  dp?: number;
  groupable: boolean;
  /** A dimension's implied order (ADR-84): the column sorts by it, not lexically. */
  order?: readonly string[];
  agg?: ColumnMeta['agg'];
  weightBy?: string;
  /** The aggregations `columnAggs` may choose for this measure. */
  aggs: ColumnMeta['agg'][];
  /** The filter shape this column takes in `columnFilters`. */
  filter: 'set' | 'range';
  /** The keys `columnFormats` may set for this column (ADR-74): none for a dimension. */
  formats: readonly (keyof ColumnFormat)[];
}

/** What an agent may write: the shape, in words an agent reads before it patches. */
export interface ViewContract {
  version: typeof VIEW_VERSION;
  columns: ContractColumn[];
  slices: Record<Exclude<keyof ViewState, 'version'>, string>;
  notes: string[];
}

/** The contract for one schema's views (ADR-82): the columns it declares, in words an agent reads before it patches. */
export function viewContract(schema: GridSchema): ViewContract {
  return {
  version: VIEW_VERSION,
  columns: schema.order.map((id) => {
    const m = schema.columns[id]!;
    return {
      id, label: m.label, kind: m.kind, unit: m.unit, dp: m.dp,
      groupable: !!m.groupable, order: m.order, agg: m.agg, weightBy: m.weightBy, aggs: allowedAggs(id, schema),
      filter: m.kind === 'dimension' ? 'set' : 'range',
      formats: allowedFormatKeys(id, [], schema),
    };
  }),
  slices: {
    grouping: 'string[] of groupable column ids, outermost first',
    columnFilters: '{ id, value }[] — a set filter takes value: string[] (keep rows whose value is one of these); a range filter takes value: [min|null, max|null], inclusive, null for an open end',
    globalFilter: 'string — a quick filter of space-separated tokens, all of which must hold: a bare word is matched case-insensitively against every column; column:text (contains), column=text, column!=text on a dimension; column>n, >=, <, <=, =, != on a measure, n with k/m/bn suffixes; a column is named by id or label (ccy, entity); quotes keep spaces',
    sorting: '{ id, desc: boolean }[] — first entry sorts first; measures sort numerically; a dimension with an order sorts by it, unlisted values last',
    expanded: 'true to expand every group, or { [groupRowId]: true } where a group row id is "column:value" joined by ">" per level',
    pagination: '{ pageIndex, pageSize } — carried, not driven until the data layer serves it',
    columnVisibility: '{ [columnId]: false } hides a column',
    columnOrder: 'string[] of column ids; columns not listed follow in declared order',
    columnPinning: '{ start: string[], end: string[] } — logical start/end, not left/right',
    columnSizing: '{ [columnId]: px }',
    columnAggs: '{ [measureId]: one of that column’s aggs } — overrides the meta’s aggregation for subtotals, totals and the SQL the source runs',
    pivot: '{ column: groupable dimension id | null, values: measure ids ([] = every measure) } — the dimension across the top, one column per value per measure (ids p:<measure>:<value>), each aggregating as its measure does within the value; the pivoted measures follow under a Total band',
    computedColumns: '[{ id: "c:<slug>", label, op: ratio|delta|sum|pct_change|scaled, of: [measureId, measureId?], k? }] — a reader\'s calculated column over registry measures (max 8, no calculated operands); ratio and pct_change read as a percent of the second operand, delta and sum keep a shared unit, scaled keeps the first\'s; a draft, never a metric (GOV-02)',
    columnFormats: '{ [measureId]: { dp?: 0–4, scale?: units|k|m|bn (dollar columns only), negatives?: minus|parens, negativeRed?, heatmap?, rules?: [{ op: >|>=|<|<=|=|!=, value, emphasis: accent|strong|muted }] (max 4, first match wins) } } — how the measure reads, never its unit (NUM-01); a rule emphasises, it never colours red or green',
  },
  notes: [
    'Column ids must be ones the contract lists; unknown ids are refused with an issue naming them.',
    'A grouping on a column that is not groupable is refused, not rendered.',
    'A weighted average (agg: wavg) is Σ(x·w)/Σ(w) over the group, weighted by weightBy — never a mean of means.',
    'pct values are in percent units: 3.46 means 3.46%. mm values are raw dollars formatted in millions.',
  ],
  };
}

/** The treasury book's contract — the default every caller had before ADR-82. */
export const VIEW_CONTRACT: ViewContract = viewContract(TREASURY_SCHEMA);

export interface DescribeResult {
  source: SourceDescription;
  view: ViewState;
  contract: ViewContract;
}

export async function describeView(source: DataSource<GridRecord>, view: ViewState): Promise<DescribeResult> {
  const about = await source.describe();
  return { source: about, view, contract: viewContract(schemaFromDescription(about)) };
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
  /** What the source itself already applied; the rest was done here. `window`: the rows are the source's window (ADR-85). */
  applied: { filter: boolean; sort: boolean; group: boolean; window?: boolean };
}

const MAX_LIMIT = 1000;

export async function queryView(
  source: DataSource<GridRecord>,
  view: ViewState,
  options: QueryViewOptions = {},
): Promise<QueryViewResult> {
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(options.limit ?? 100)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const display = options.display ?? true;
  const about = await source.describe();
  // A source that serves windows (ADR-85) is asked for exactly this one, and
  // for the totals over everything the view matches; the rest is answered
  // whole and cut here.
  const windowed = !!about.serves.window && view.grouping.length === 0;
  const answer = windowed ? await source.query(view, { window: { offset, limit }, totals: true }) : await source.query(view);
  const effective: ViewState = options.expandAll ? { ...view, expanded: true } : view;
  const table = headlessTable(answer.rows, effective, schemaFromDescription(about));
  const columnsOut = table.getVisibleLeafColumns().map((c) => c.id);
  const model = table.getRowModel().rows;
  const window = answer.applied.window ? model : model.slice(offset, offset + limit);

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
      if (display && meta && v !== undefined) shown[id] = formatValue(v, cell.getIsAggregated() ? aggregateMeta(meta, cell.column.columnDef.aggregationFn) : meta);
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
    if (!meta || !c.columnDef.aggregationFn) continue;
    const n = answer.totals ? answer.totals[c.id] : aggregatedNumber(c.getAggregationValue());
    if (n === undefined) continue;
    totals.values[c.id] = n;
    if (totals.display) totals.display[c.id] = formatValue(n, aggregateMeta(meta, c.columnDef.aggregationFn));
  }

  const total = answer.applied.window ? answer.total : table.getFilteredRowModel().rows.length;
  const modelRows = answer.applied.window ? answer.total : model.length;
  return {
    view: effective,
    columns: columnsOut,
    rows,
    total,
    modelRows,
    offset,
    truncated: offset + window.length < modelRows,
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
export function setView(view: ViewState, patch: unknown, options: { replace?: boolean } = {}, schema: GridSchema = TREASURY_SCHEMA): SetViewResult {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, issues: ['$: the patch must be an object of view slices'] };
  }
  const base = options.replace ? { version: VIEW_VERSION } : view;
  const merged = { ...base, ...(patch as Record<string, unknown>), version: VIEW_VERSION };
  const parsed = safeParseView(merged, schema);
  return parsed.ok ? { ok: true, view: parsed.view } : { ok: false, issues: parsed.issues };
}
