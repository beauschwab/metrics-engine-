/**
 * The view, compiled to SQL (ADR-70). Pure: a view and a dialect in, a
 * statement and its parameters out. Identifiers come only from the column
 * meta — an id the meta does not know throws before a byte of SQL exists —
 * and values never enter the text: they are parameters, or for a dialect
 * without parameters (Dremio's REST API) escaped literals from one function.
 *
 * Two shapes. A *leaf* query selects positions, filtered, sorted and
 * windowed. A *group* query, asked when the view groups deeper than the
 * `groupPath` given, aggregates the next level: the dimension, a count, and
 * each measure by its meta's `agg` — `wavg` as SUM(x·w) / SUM(w), the same
 * decomposition the client uses (ADR-67), with the parts alongside so a
 * parent could merge children. Both take the same WHERE: the view's set and
 * range filters, the quick filter, and the group path's dimensions.
 */

import { COLUMN_META, COLUMN_ORDER, effectiveAgg } from '../grid/columns';
import { isComputedId, type ComputedColumn } from '../grid/computed';
import { isPivotId, parsePivotId, pivotId } from '../grid/pivot';
import { pivotMeasures } from '../grid/columns';
import { parseSearch } from '../grid/search';
import type { ColumnMeta } from '../grid/meta';
import type { ViewState } from '../grid/viewState';
import type { Position } from './mock';

export interface SqlDialect {
  name: 'duckdb' | 'sqlite' | 'dremio';
  quote(identifier: string): string;
  /** Case-insensitive substring match of a text expression against a parameter or literal. */
  ilike(expr: string, needle: string): string;
  /** Text cast for the quick filter. */
  text(expr: string): string;
  /** True when the dialect takes no parameters and values must be inlined as literals. */
  inlineLiterals: boolean;
  /** The median of a column, where the engine has one. */
  median?: (expr: string) => string;
}

const dq = (id: string) => `"${id.replace(/"/g, '""')}"`;

export const DUCKDB: SqlDialect = {
  name: 'duckdb',
  quote: dq,
  ilike: (expr, needle) => `${expr} ILIKE ${needle}`,
  text: (expr) => `CAST(${expr} AS VARCHAR)`,
  inlineLiterals: false,
  median: (expr) => `MEDIAN(${expr})`,
};

export const SQLITE: SqlDialect = {
  name: 'sqlite',
  quote: dq,
  ilike: (expr, needle) => `${expr} LIKE ${needle} COLLATE NOCASE`,
  text: (expr) => `CAST(${expr} AS TEXT)`,
  inlineLiterals: false,
};

export const DREMIO: SqlDialect = {
  name: 'dremio',
  quote: dq,
  ilike: (expr, needle) => `LOWER(${expr}) LIKE LOWER(${needle})`,
  text: (expr) => `CAST(${expr} AS VARCHAR)`,
  inlineLiterals: true,
  median: (expr) => `MEDIAN(${expr})`,
};

export interface CompiledSql {
  sql: string;
  params: Array<string | number>;
  /** 'group' when the statement aggregates the next grouping level, else 'leaf'. */
  shape: 'leaf' | 'group';
  /** For a group statement, the dimension it groups by. */
  groupColumn?: keyof Position;
}

export interface CompileOptions {
  /** The table or view holding positions. Quoted as an identifier; dots separate schema parts. */
  table: string;
  /** The values of the view's grouping columns, outermost first, that scope this query. */
  groupPath?: string[];
  limit?: number;
  offset?: number;
  /** For a leaf query: count the matching rows instead of selecting them. */
  count?: boolean;
  /** The pivot dimension's distinct values (ADR-80), for a grouping level's bucketed aggregates. */
  pivotValues?: readonly string[];
}

const META = COLUMN_META as Record<string, ColumnMeta>;

function columnId(id: string): keyof Position {
  if (!(id in META)) throw new RangeError(`compileSql: unknown column ${JSON.stringify(id)}`);
  return id as keyof Position;
}

/** A calculated column's definition in the view, or a refusal. */
function computedSpec(id: string, view: ViewState): ComputedColumn {
  const spec = view.computedColumns.find((c) => c.id === id);
  if (!spec) throw new RangeError(`compileSql: unknown calculated column ${JSON.stringify(id)}`);
  return spec;
}

/** The operation composed over two SQL expressions — the same arithmetic the client does (ADR-79). */
function compose(spec: ComputedColumn, a: string, b: string | undefined, params: Params): string {
  switch (spec.op) {
    case 'ratio': return `((${a}) / NULLIF(${b}, 0)) * 100`;
    case 'delta': return `((${a}) - (${b}))`;
    case 'sum': return `((${a}) + (${b}))`;
    case 'pct_change': return `(((${a}) - (${b})) / NULLIF(ABS(${b}), 0)) * 100`;
    case 'scaled': return `((${a}) * ${params.add(spec.k ?? Number.NaN)})`;
    default: throw new RangeError(`compileSql: unknown operation ${String(spec.op)}`);
  }
}

/** A column's leaf-row expression: the quoted column, or a calculated column's arithmetic. */
function leafExpr(id: string, dialect: SqlDialect, view: ViewState, params: Params): string {
  if (!isComputedId(id)) return dialect.quote(columnId(id));
  const spec = computedSpec(id, view);
  const a = leafExpr(spec.of[0]!, dialect, view, params);
  const b = spec.of[1] !== undefined ? leafExpr(spec.of[1], dialect, view, params) : undefined;
  return compose(spec, a, b, params);
}

/**
 * A measure's aggregate expressions within one pivot bucket (ADR-80): the
 * same rule over `CASE WHEN dim = value THEN measure END`, so a bucket sums,
 * averages or weights only its own rows; the wavg parts ride along.
 */
function pivotAggregate(id: string, dialect: SqlDialect, view: ViewState, params: Params): Aggregated[] {
  const p = parsePivotId(id);
  if (!p || !view.pivot.column) throw new RangeError(`compileSql: not a pivot column ${JSON.stringify(id)}`);
  const measure = columnId(p.measure);
  const dim = dialect.quote(columnId(view.pivot.column));
  // One parameter per occurrence in the text: a placeholder binds once, so
  // each bucket expression is built where it is written, never reused.
  const bucket = (expr: string) => `CASE WHEN ${dim} = ${params.add(p.value)} THEN ${expr} END`;
  const col = () => bucket(dialect.quote(measure));
  const meta = META[measure]!;
  switch (effectiveAgg(measure, view.columnAggs)) {
    case 'sum': return [{ expr: `SUM(${col()})`, alias: id }];
    case 'min': return [{ expr: `MIN(${col()})`, alias: id }];
    case 'max': return [{ expr: `MAX(${col()})`, alias: id }];
    case 'count': return [{ expr: `COUNT(${col()})`, alias: id }];
    case 'mean': return [{ expr: `AVG(${col()})`, alias: id }];
    case 'uniqueCount': return [{ expr: `COUNT(DISTINCT ${col()})`, alias: id }];
    case 'median': {
      if (!dialect.median) throw new RangeError(`compileSql: ${dialect.name} has no median; choose another aggregation for ${measure}`);
      return [{ expr: dialect.median(col()), alias: id }];
    }
    case 'wavg': {
      const w = () => bucket(dialect.quote(columnId(meta.weightBy ?? '')));
      const xw = () => `SUM(${dialect.quote(measure)} * ${w()})`;
      return [
        { expr: `${xw()} / NULLIF(SUM(${w()}), 0)`, alias: id },
        { expr: xw(), alias: `${id}__xw` },
        { expr: `SUM(${w()})`, alias: `${id}__w` },
      ];
    }
    default: return [];
  }
}

/** A column's aggregate expression at a grouping level: the measure's own, a pivot bucket's, or a calculated column's over its operands'. */
function aggExpr(id: string, dialect: SqlDialect, view: ViewState, params: Params): string | undefined {
  if (isPivotId(id)) return pivotAggregate(id, dialect, view, params)[0]?.expr;
  if (!isComputedId(id)) {
    const parts = aggregate(columnId(id), dialect, view);
    return parts[0]?.expr;
  }
  const spec = computedSpec(id, view);
  const a = aggExpr(spec.of[0]!, dialect, view, params);
  const b = spec.of[1] !== undefined ? aggExpr(spec.of[1], dialect, view, params) : undefined;
  if (a === undefined || (spec.of[1] !== undefined && b === undefined)) return undefined;
  return compose(spec, a, b, params);
}

function tableRef(dialect: SqlDialect, table: string): string {
  if (!/^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/.test(table)) throw new RangeError(`compileSql: bad table name ${JSON.stringify(table)}`);
  return table.split('.').map(dialect.quote).join('.');
}

class Params {
  readonly values: Array<string | number> = [];
  constructor(private readonly dialect: SqlDialect) {}
  add(value: string | number): string {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('compileSql: a filter value is not finite');
    if (this.dialect.inlineLiterals) {
      return typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`;
    }
    this.values.push(value);
    return '?';
  }
}

function where(view: ViewState, opts: CompileOptions, dialect: SqlDialect, params: Params): string[] {
  const clauses: string[] = [];
  for (const f of view.columnFilters) {
    if (isComputedId(f.id)) {
      // A range on a calculated column filters leaf rows by its arithmetic (ADR-79).
      const expr = leafExpr(f.id, dialect, view, params);
      const [lo, hi] = Array.isArray(f.value) ? (f.value as [unknown, unknown]) : [f.value, f.value];
      if (typeof lo === 'number') clauses.push(`${expr} >= ${params.add(lo)}`);
      if (typeof hi === 'number') clauses.push(`${expr} <= ${params.add(hi)}`);
      continue;
    }
    const id = columnId(f.id);
    const col = dialect.quote(id);
    if (META[id]!.kind === 'dimension') {
      const values = Array.isArray(f.value) ? f.value : [f.value];
      const strings = values.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
      // An empty set is "none of these" (ADR-73): no row, not every row.
      if (strings.length === 0) { clauses.push('1 = 0'); continue; }
      clauses.push(`${col} IN (${strings.map((v) => params.add(v)).join(', ')})`);
    } else {
      const [lo, hi] = Array.isArray(f.value) ? (f.value as [unknown, unknown]) : [f.value, f.value];
      if (typeof lo === 'number') clauses.push(`${col} >= ${params.add(lo)}`);
      if (typeof hi === 'number') clauses.push(`${col} <= ${params.add(hi)}`);
    }
  }
  // The quick filter's tokens (ADR-73): each free word somewhere in the row,
  // each column term on its column, and an unknown term keeps no row — the
  // same reading `rowMatchesSearch` gives the client.
  const search = parseSearch(view.globalFilter);
  if (search.unknown.length > 0) clauses.push('1 = 0');
  for (const word of search.text) {
    if (word.value === '') continue;
    // One parameter per occurrence: a positional placeholder binds once, and
    // a needle reused across fifteen columns would leave fourteen of them null.
    const needle = `%${word.value}%`;
    clauses.push(`(${COLUMN_ORDER.map((id) => dialect.ilike(dialect.text(dialect.quote(id)), params.add(needle))).join(' OR ')})`);
  }
  for (const term of search.terms) {
    const col = dialect.quote(term.column);
    if (typeof term.value === 'string') {
      const like = (needle: string) => dialect.ilike(dialect.text(col), params.add(needle));
      if (term.op === ':') clauses.push(like(`%${term.value}%`));
      else if (term.op === '=') clauses.push(like(term.value));
      else clauses.push(`NOT ${like(term.value)}`);
    } else {
      clauses.push(`${col} ${term.op === '=' ? '=' : term.op === '!=' ? '<>' : term.op} ${params.add(term.value)}`);
    }
  }
  const path = opts.groupPath ?? [];
  if (path.length > view.grouping.length) throw new RangeError(`compileSql: groupPath has ${path.length} values but the view groups by ${view.grouping.length} column(s)`);
  path.forEach((value, i) => {
    clauses.push(`${dialect.quote(columnId(view.grouping[i]!))} = ${params.add(value)}`);
  });
  return clauses;
}

interface Aggregated { expr: string; alias: string }

/** A measure's aggregate expressions at a grouping level: the value first, then any parts a merge needs. */
function aggregate(id: keyof Position, dialect: SqlDialect, view: ViewState): Aggregated[] {
  const meta = META[id]!;
  const col = dialect.quote(id);
  switch (effectiveAgg(id, view.columnAggs)) {
    case 'sum': return [{ expr: `SUM(${col})`, alias: id }];
    case 'min': return [{ expr: `MIN(${col})`, alias: id }];
    case 'max': return [{ expr: `MAX(${col})`, alias: id }];
    case 'count': return [{ expr: `COUNT(${col})`, alias: id }];
    case 'mean': return [{ expr: `AVG(${col})`, alias: id }];
    case 'uniqueCount': return [{ expr: `COUNT(DISTINCT ${col})`, alias: id }];
    case 'median': {
      if (!dialect.median) throw new RangeError(`compileSql: ${dialect.name} has no median; choose another aggregation for ${id}`);
      return [{ expr: dialect.median(col), alias: id }];
    }
    case 'wavg': {
      const w = dialect.quote(columnId(meta.weightBy ?? ''));
      return [
        { expr: `SUM(${col} * ${w}) / NULLIF(SUM(${w}), 0)`, alias: id },
        { expr: `SUM(${col} * ${w})`, alias: `__${id}_xw` },
        { expr: `SUM(${w})`, alias: `__${id}_w` },
      ];
    }
    default: return [];
  }
}

export function compileSql(view: ViewState, opts: CompileOptions, dialect: SqlDialect = DUCKDB): CompiledSql {
  const params = new Params(dialect);
  const from = tableRef(dialect, opts.table);
  const path = opts.groupPath ?? [];
  const nextGroup = view.grouping[path.length];

  if (nextGroup !== undefined) {
    const dim = columnId(nextGroup);
    const dimCol = dialect.quote(dim);
    // The SELECT list is built before the WHERE clause: its placeholders
    // come first in the text, so their parameters must come first too.
    const select = [
      `${dimCol}`,
      `COUNT(*) AS ${dialect.quote('__count')}`,
      ...COLUMN_ORDER.filter((id) => META[id]!.kind === 'measure').flatMap((id) =>
        aggregate(id, dialect, view).map((a) => `${a.expr} AS ${dialect.quote(a.alias)}`)),
      // Pivot buckets (ADR-80): one aggregate per value per pivoted measure.
      ...(view.pivot.column ? (opts.pivotValues ?? []).flatMap((value) =>
        pivotMeasures(view.pivot).flatMap((m) => pivotAggregate(pivotId(m, value), dialect, view, params).map((a) => `${a.expr} AS ${dialect.quote(a.alias)}`))) : []),
    ];
    const clauses = where(view, opts, dialect, params);
    const whereSql = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const order: string[] = [];
    for (const s of view.sorting) {
      if (isComputedId(s.id) || isPivotId(s.id)) {
        // A calculated column sorts a grouping level by its arithmetic over the operands' aggregates; a pivot column by its bucket's.
        const expr = aggExpr(s.id, dialect, view, params);
        if (expr) order.push(`${expr} ${s.desc ? 'DESC' : 'ASC'}`);
        continue;
      }
      const id = columnId(s.id);
      if (id === dim || effectiveAgg(id, view.columnAggs)) order.push(`${dialect.quote(id)} ${s.desc ? 'DESC' : 'ASC'}`);
    }
    if (!order.some((o) => o.startsWith(dimCol))) order.push(`${dimCol} ASC`);
    const sql = `SELECT ${select.join(', ')} FROM ${from}${whereSql} GROUP BY ${dimCol} ORDER BY ${order.join(', ')}`;
    return { sql, params: params.values, shape: 'group', groupColumn: dim };
  }

  const clauses = where(view, opts, dialect, params);
  const whereSql = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  if (opts.count) {
    return { sql: `SELECT COUNT(*) AS ${dialect.quote('__count')} FROM ${from}${whereSql}`, params: params.values, shape: 'leaf' };
  }
  const select = COLUMN_ORDER.map((id) => dialect.quote(id)).join(', ');
  const order = view.sorting.flatMap((s) => {
    // A leaf row sorts by a pivot column as by its measure within the bucket: rows outside it last.
    const p = parsePivotId(s.id);
    if (p && view.pivot.column) {
      const dim = dialect.quote(columnId(view.pivot.column));
      return [
        `CASE WHEN ${dim} = ${params.add(p.value)} THEN 0 ELSE 1 END ASC`,
        `CASE WHEN ${dim} = ${params.add(p.value)} THEN ${dialect.quote(columnId(p.measure))} END ${s.desc ? 'DESC' : 'ASC'}`,
      ];
    }
    return [`${leafExpr(s.id, dialect, view, params)} ${s.desc ? 'DESC' : 'ASC'}`];
  });
  order.push(`${dialect.quote('tradeId')} ASC`);
  let sql = `SELECT ${select} FROM ${from}${whereSql} ORDER BY ${order.join(', ')}`;
  if (opts.limit !== undefined) sql += ` LIMIT ${Math.max(0, Math.floor(opts.limit))}`;
  if (opts.offset) sql += ` OFFSET ${Math.max(0, Math.floor(opts.offset))}`;
  return { sql, params: params.values, shape: 'leaf' };
}
