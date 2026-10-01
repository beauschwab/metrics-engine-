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
import { type ColumnFormat, formatValue, type ColumnMeta, aggregateMeta, matchRule, type Emphasis } from '../grid/meta';
import { parseSearch, resolveSearchColumn } from '../grid/search';
import { VIEW_VERSION, safeParseView, type ViewState } from '../grid/viewState';
import type { DataSource, SourceDescription } from '../data/source';
import type { GridRecord } from '../grid/schema';
import { headlessTable } from './headless';
import { isGroupNode, type GroupNode } from '../data/groupNode';

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
  /** Dimensions, where the source can list them: how many distinct values the data has. */
  distinct?: number;
  /** Dimensions with at most ${MAX_LISTED} values: every value, exactly as filters, expansion and pivot buckets must name it. */
  values?: string[];
}

/** A dimension's values are listed in the contract up to this many; past it, only the count. */
export const MAX_LISTED = 50;
/** A pivot spreads at most this many buckets unless they are named: more columns than a reader can read is not a view. */
export const MAX_PIVOT_BUCKETS = 50;

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
    grouping: 'string[] of groupable column ids, outermost first, each once. Each group row carries group.count, its number of leaf rows — the way to count rows per group',
    columnFilters: '{ id, value }[], one entry per column — a set filter takes value: string[] (keep rows whose value is one of these, exactly as the column lists them in values); a range filter takes value: [min|null, max|null] in the column’s stored units (raw dollars for mm and ccy, percent units for pct), inclusive, null for an open end. To exclude one value, list the others or use globalFilter column!=value',
    globalFilter: 'string — a quick filter of space-separated tokens, all of which must hold: a bare word is matched case-insensitively against every column; column:text (contains), column=text, column!=text on a dimension; column>n, >=, <, <=, =, != on a measure, n with k/m/bn suffixes; a column is named by id or label (ccy, entity); quotes keep spaces',
    sorting: '{ id, desc: boolean }[], each column once — first entry sorts first; measures sort numerically; a dimension with an order sorts by it, unlisted values last. Under a grouping, groups sort by their aggregate and leaves within them by their own value',
    expanded: 'true expands every group at every level down to the leaf rows; to open chosen groups give { [groupRowId]: true } where a group row id is "column:value" per level joined by ">", following the grouping in order (e.g. "desk:Rates", "desk:Rates>legalEntity:WF-US"); opening a nested group needs its parent open too',
    pagination: '{ pageIndex, pageSize } — carried, not driven until the data layer serves it',
    columnVisibility: '{ [columnId]: false } hides a column',
    columnOrder: 'string[] of column ids; columns not listed follow in declared order',
    columnPinning: '{ start: string[], end: string[] } — logical start/end (start is the left in a left-to-right layout), each column at one end only; query_view lists columns in screen order, pinned ones first',
    columnSizing: '{ [columnId]: px }',
    columnAggs: '{ [measureId]: one of that column’s aggs } — overrides the meta’s aggregation for subtotals, totals and the SQL the source runs; aggregates are over the leaf rows of each group, never over sub-groups. count and uniqueCount replace the column’s subtotals with row counts under the same header — prefer group.count to count rows',
    pivot: '{ column: groupable dimension id | null, values: measure ids ([] = every measure), buckets: dimension values ([] = every value the source has, allowed only up to 50 values — name buckets for a larger dimension, e.g. the top few by a measure found with a grouped, sorted query) } — the dimension across the top, one column per bucket per measure (ids p:<measure>:<value>), each aggregating as its measure does within the value; the pivoted measures follow under a Total band',
    computedColumns: '[{ id: "c:<slug>" (slug: 1–32 lowercase letters, digits or underscores, e.g. c:mtm_share), label, op: ratio|delta|sum|pct_change|scaled, of: [measureId, measureId?], k? }] — a reader\'s calculated column over registry measures (max 8, no calculated operands); ratio and pct_change read as a percent of the second operand (ratio of [mtm, notional] is 100·mtm/notional), delta and sum keep a shared unit, scaled keeps the first\'s; a group’s value is the operation over the group’s sums (a ratio of sums, never a mean of ratios); a draft, never a metric (GOV-02)',
    columnFormats: '{ [measureId]: { dp?: 0–4, scale?: units|k|m|bn (dollar columns only), negatives?: minus|parens, negativeRed?, heatmap?, rules?: [{ op: >|>=|<|<=|=|!=, value: a number in the column’s stored units (raw dollars for mm/ccy: $2bn is 2000000000; percent units for pct), emphasis: accent (highlight) | strong (bold) | muted (fade) }] (max 4, first match wins; query_view reports the matched emphasis per cell), trend?: line|band|column|range (a sparkline of the row’s history beside each leaf value — only a column the schema declares with a history; band draws against the column’s declared limit, which is per leaf row, so group rows never draw one) } } — how the measure reads, never its unit (NUM-01); a rule emphasises, it never colours red or green',
  },
  notes: [
    'Column ids must be ones the contract lists; unknown ids are refused with an issue naming them.',
    'A grouping on a column that is not groupable is refused, not rendered.',
    'A weighted average (agg: wavg) is Σ(x·w)/Σ(w) over the group, weighted by weightBy — never a mean of means.',
    'pct values are in percent units: 3.46 means 3.46%. mm values are raw dollars formatted in millions.',
    'Dimension values are case- and spelling-exact in columnFilters, expanded and pivot.buckets: take them from the column’s values. set_view returns warnings when a value names nothing the data has, and says which column has it if another does.',
    'set_view takes a patch: each slice it names replaces that slice whole (a new columnFilters replaces the old list; it does not append). replace: true with an empty patch is the default view — the way to start again.',
    'query_view’s view argument is a whole view, not a patch: slices it leaves out take their defaults, not the session’s.',
    'In a query_view answer, total is the leaf rows the filters keep; modelRows is the rows the window was cut from (groups and their open children included); truncated means more rows lie beyond this window; applied names the stages the data source ran itself — false means the grid ran it, not that it did not run.',
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

export async function describeView(source: DataSource<GridRecord>, view: ViewState, cache = new Map<string, Promise<string[] | undefined>>()): Promise<DescribeResult> {
  const about = await source.describe();
  const schema = schemaFromDescription(about);
  const contract = viewContract(schema);
  // A dimension's values, where the source can list them: an agent that has
  // to guess "Rates" or "WF-US" — or which column WF-US belongs to — filters
  // to nothing and is told nothing.
  const columns = await Promise.all(contract.columns.map(async (c) => {
    if (c.kind !== 'dimension') return c;
    const found = await distinctOf(source, c.id, cache);
    if (!found) return c;
    // A dimension with an implied order (ADR-84) lists its values in it: a tenor ladder reads O/N to 10Y+, not alphabetically.
    const rank = (v: string) => (c.order ? c.order.indexOf(v) : -1);
    const values = c.order ? [...found].sort((a, b) => (rank(a) < 0 ? 1e9 : rank(a)) - (rank(b) < 0 ? 1e9 : rank(b))) : found;
    return { ...c, distinct: values.length, ...(values.length <= MAX_LISTED ? { values } : {}) };
  }));
  return { source: about, view, contract: { ...contract, columns } };
}

/** A dimension's distinct values from the source, once per column per cache; undefined where the source cannot list them. */
export function distinctOf(source: DataSource<GridRecord>, column: string, cache: Map<string, Promise<string[] | undefined>>): Promise<string[] | undefined> {
  let p = cache.get(column);
  if (!p) {
    p = source.distinct ? source.distinct(column).catch(() => undefined) : Promise.resolve(undefined);
    cache.set(column, p);
  }
  return p;
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
  /** The emphasis a highlight rule gives a cell (ADR-78), by column; absent where no rule matches. */
  emphasis?: Record<string, Emphasis>;
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
  const servedGroups = !!about.serves.group && view.grouping.length > 0;
  const answer = windowed
    ? await source.query(view, { window: { offset, limit }, totals: true })
    : await source.query(view, servedGroups ? { totals: true } : {});
  const effective: ViewState = options.expandAll ? { ...view, expanded: true } : view;
  // A source that grouped (ADR-70) answered with group nodes, a level at a
  // time: they are not grouped again here. Expanding them is asking the
  // source for each node's children by its path, level by level.
  let rows = answer.rows;
  if (answer.applied.group && effective.expanded === true) {
    const attach = async (list: GridRecord[]): Promise<GridRecord[]> => Promise.all(list.map(async (node) => {
      if (!isGroupNode(node)) return node;
      const kids = await source.query(view, { groupPath: node.__group.path });
      return { ...node, __children: await attach(kids.rows) };
    }));
    rows = await attach(rows);
  }
  const table = headlessTable(rows, effective, schemaFromDescription(about), answer.applied);
  // Screen order: pinned-to-start first, then the centre, then pinned-to-end —
  // what the reader sees left to right, not the declared order.
  const columnsOut = [...table.getStartVisibleLeafColumns(), ...table.getCenterVisibleLeafColumns(), ...table.getEndVisibleLeafColumns()].map((c) => c.id);
  const model = table.getRowModel().rows;
  const window = answer.applied.window ? model : model.slice(offset, offset + limit);

  const out: QueryRow[] = window.map((row) => {
    const node: GroupNode | null = isGroupNode(row.original) ? row.original : null;
    const grouped = row.getIsGrouped() || node !== null;
    const values: Record<string, unknown> = {};
    const shown: Record<string, string> = {};
    const emphasis: Record<string, Emphasis> = {};
    for (const cell of row.getAllCells()) {
      const id = cell.column.id;
      if (!columnsOut.includes(id)) continue;
      const meta = cell.column.columnDef.meta;
      let v: unknown;
      let aggregate = cell.getIsAggregated();
      if (node) {
        // An engine-made group: its own dimension's value, and each measure's aggregate as the engine computed it.
        const raw = cell.getValue();
        if (id === node.__group.column) v = node.__group.value;
        else if (meta?.kind === 'measure' && cell.column.columnDef.aggregationFn && typeof raw === 'number' && Number.isFinite(raw)) { v = raw; aggregate = true; }
      } else if (cell.getIsGrouped()) v = row.groupingValue;
      else if (aggregate) v = aggregatedNumber(cell.getValue());
      else if (cell.getIsPlaceholder() || grouped) v = undefined;
      else v = cell.getValue();
      if (v !== undefined) values[id] = v;
      const rule = meta && v !== undefined ? matchRule(meta.rules, v) : undefined;
      if (rule) emphasis[id] = rule.emphasis;
      if (display && meta && v !== undefined) shown[id] = formatValue(v, aggregate ? aggregateMeta(meta, cell.column.columnDef.aggregationFn) : meta);
    }
    const q: QueryRow = { id: row.id, depth: row.depth, kind: grouped ? 'group' : 'leaf', values };
    if (Object.keys(emphasis).length) q.emphasis = emphasis;
    if (node) {
      q.group = { column: node.__group.column, value: node.__group.value, count: node.__group.count };
    } else if (grouped) {
      q.group = {
        column: String(row.groupingColumnId),
        value: String(row.groupingValue),
        count: row.getLeafRows().filter((r) => !r.getIsGrouped()).length,
      };
    }
    if (display) q.display = shown;
    return q;
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

  // The leaves the view keeps: the engine's count for a window, the top-level
  // nodes' counts for engine-made groups, else the client's filtered rows.
  const total = answer.applied.window
    ? answer.total
    : answer.applied.group
      ? answer.rows.reduce((n, r) => n + (isGroupNode(r) ? r.__group.count : 1), 0)
      : table.getFilteredRowModel().rows.length;
  const modelRows = answer.applied.window ? answer.total : model.length;
  return {
    view: effective,
    columns: columnsOut,
    rows: out,
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
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const issues = agentIssues(parsed.view, schema);
  return issues.length ? { ok: false, issues } : { ok: true, view: parsed.view };
}

/** A token shaped like a column comparison: `name op value`. */
const COLUMNISH = /^([A-Za-z_][\w ]*?)(!=|>=|<=|:|=|>|<)(.+)$/s;

/**
 * What an agent wrote on purpose and must be told about, though a screen
 * tolerates it: a half-typed search token, a comparison on a column that
 * does not exist, an expanded key that does not follow the grouping. The
 * view contract stays lenient for the screen (a stale key after ungrouping
 * is harmless there); the agent is held to what it meant.
 */
export function agentIssues(view: ViewState, schema: GridSchema): string[] {
  const issues: string[] = [];
  const search = parseSearch(view.globalFilter, schema);
  for (const u of search.unknown) issues.push(`globalFilter: ${u.raw}: ${u.reason}`);
  for (const t of search.text) {
    const m = COLUMNISH.exec(t.raw);
    if (m && !/^["']/.test(t.raw) && !resolveSearchColumn(m[1]!, schema)) {
      issues.push(`globalFilter: ${t.raw}: ${m[1]} is not a column (name one by id or label: ${schema.order.slice(0, 6).join(', ')}, …), and as words it would match only text containing "${t.raw}"; quote it to search that text`);
    }
  }
  if (view.expanded !== true) {
    for (const key of Object.keys(view.expanded)) {
      const levels = key.split('>');
      if (levels.length > view.grouping.length) {
        issues.push(`expanded: ${key}: ${levels.length} levels, but the grouping has ${view.grouping.length}`);
        continue;
      }
      levels.forEach((level, i) => {
        const column = level.slice(0, level.indexOf(':'));
        if (level.indexOf(':') < 0 || column !== view.grouping[i]) {
          issues.push(`expanded: ${key}: level ${i + 1} must be "${view.grouping[i]}:<value>" — a group row id follows the grouping in order`);
        }
      });
    }
  }
  return issues;
}

export interface DataCheck {
  /** What refuses the view: it would be unreadable whatever the reader meant. */
  issues: string[];
  /** What the view names that the data does not have: accepted, because data changes, but almost always a slip. */
  warnings: string[];
}

/**
 * The view against the data (needs a source that lists distinct values):
 * dimension values a filter, an expanded key or a pivot bucket names that
 * the data does not have — "book!=WF-US" filters nothing, because WF-US is an
 * entity — and a pivot that would spread hundreds of columns.
 */
export async function checkAgainstData(
  view: ViewState,
  source: DataSource<GridRecord>,
  schema: GridSchema,
  cache = new Map<string, Promise<string[] | undefined>>(),
): Promise<DataCheck> {
  const issues: string[] = [];
  const warnings: string[] = [];
  const dims = schema.order.filter((id) => schema.columns[id]?.kind === 'dimension');
  const label = (id: string) => `${schema.columns[id]?.label ?? id} (${id})`;
  const sample = (values: readonly string[]) => `${values.slice(0, 8).join(', ')}${values.length > 8 ? `, … (${values.length} in all)` : ''}`;
  // Set filters, expanded keys and pivot buckets match exactly; the quick
  // filter's =, != and : fold case. Each is checked the way it matches.
  const fold = (v: string) => v.toLowerCase();
  type Match = 'exact' | '=' | ':';
  const has = (values: readonly string[], v: string, op: Match = 'exact') =>
    values.some((x) => (op === 'exact' ? x === v : op === ':' ? fold(x).includes(fold(v)) : fold(x) === fold(v)));
  const elsewhere = async (column: string, v: string) => {
    const owners: string[] = [];
    for (const other of dims) {
      if (other === column) continue;
      const values = await distinctOf(source, other, cache);
      if (values && has(values, v, '=')) owners.push(label(other));
    }
    return owners.length ? ` — it is a value of ${owners.join(' and ')}` : '';
  };
  const missing = async (where: string, column: string, v: string, op: Match = 'exact') => {
    const values = await distinctOf(source, column, cache);
    if (!values || has(values, v, op)) return;
    const near = op === 'exact' ? values.find((x) => fold(x) === fold(v)) : undefined;
    const hint = near ? ` (values match exactly: did you mean "${near}"?)` : await elsewhere(column, v);
    warnings.push(`${where}: ${label(column)} has no value ${op === ':' ? 'containing ' : ''}"${v}"${hint}; its values: ${sample(values)}`);
  };

  for (const f of view.columnFilters) {
    if (schema.columns[f.id]?.kind !== 'dimension' || !Array.isArray(f.value)) continue;
    for (const v of f.value as string[]) await missing('columnFilters', f.id, v);
  }
  for (const t of parseSearch(view.globalFilter, schema).terms) {
    if (schema.columns[t.column]?.kind !== 'dimension' || typeof t.value !== 'string') continue;
    await missing(`globalFilter ${t.raw}`, t.column, t.value, t.op === ':' ? ':' : '=');
  }
  if (view.expanded !== true) {
    for (const key of Object.keys(view.expanded)) {
      for (const level of key.split('>')) {
        const at = level.indexOf(':');
        await missing(`expanded ${key}`, level.slice(0, at), level.slice(at + 1));
      }
    }
  }
  if (view.pivot.column) {
    const values = await distinctOf(source, view.pivot.column, cache);
    if (values && view.pivot.buckets.length === 0 && values.length > MAX_PIVOT_BUCKETS) {
      issues.push(`pivot: ${label(view.pivot.column)} has ${values.length} values — one column each is more than a reader can read; name up to ${MAX_PIVOT_BUCKETS} in pivot.buckets (e.g. ${values.slice(0, 3).join(', ')}), or group by it instead`);
    }
    for (const b of view.pivot.buckets) await missing('pivot.buckets', view.pivot.column, b);
  }
  return { issues, warnings };
}
