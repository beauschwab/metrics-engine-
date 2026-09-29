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

import { COLUMN_META, COLUMN_ORDER } from '../grid/columns';
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
}

const dq = (id: string) => `"${id.replace(/"/g, '""')}"`;

export const DUCKDB: SqlDialect = {
  name: 'duckdb',
  quote: dq,
  ilike: (expr, needle) => `${expr} ILIKE ${needle}`,
  text: (expr) => `CAST(${expr} AS VARCHAR)`,
  inlineLiterals: false,
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
}

const META = COLUMN_META as Record<string, ColumnMeta>;

function columnId(id: string): keyof Position {
  if (!(id in META)) throw new RangeError(`compileSql: unknown column ${JSON.stringify(id)}`);
  return id as keyof Position;
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
    const id = columnId(f.id);
    const col = dialect.quote(id);
    if (META[id]!.kind === 'dimension') {
      const values = Array.isArray(f.value) ? f.value : [f.value];
      const strings = values.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
      if (strings.length === 0) continue;
      clauses.push(`${col} IN (${strings.map((v) => params.add(v)).join(', ')})`);
    } else {
      const [lo, hi] = Array.isArray(f.value) ? (f.value as [unknown, unknown]) : [f.value, f.value];
      if (typeof lo === 'number') clauses.push(`${col} >= ${params.add(lo)}`);
      if (typeof hi === 'number') clauses.push(`${col} <= ${params.add(hi)}`);
    }
  }
  if (view.globalFilter.trim() !== '') {
    // One parameter per occurrence: a positional placeholder binds once, and
    // a needle reused across fifteen columns would leave fourteen of them null.
    const needle = `%${view.globalFilter.trim()}%`;
    clauses.push(`(${COLUMN_ORDER.map((id) => dialect.ilike(dialect.text(dialect.quote(id)), params.add(needle))).join(' OR ')})`);
  }
  const path = opts.groupPath ?? [];
  if (path.length > view.grouping.length) throw new RangeError(`compileSql: groupPath has ${path.length} values but the view groups by ${view.grouping.length} column(s)`);
  path.forEach((value, i) => {
    clauses.push(`${dialect.quote(columnId(view.grouping[i]!))} = ${params.add(value)}`);
  });
  return clauses;
}

function aggregate(id: keyof Position, dialect: SqlDialect): string[] {
  const meta = META[id]!;
  const col = dialect.quote(id);
  const as = (expr: string, alias: string) => `${expr} AS ${dialect.quote(alias)}`;
  switch (meta.agg) {
    case 'sum': return [as(`SUM(${col})`, id)];
    case 'min': return [as(`MIN(${col})`, id)];
    case 'max': return [as(`MAX(${col})`, id)];
    case 'count': return [as(`COUNT(${col})`, id)];
    case 'wavg': {
      const w = dialect.quote(columnId(meta.weightBy ?? ''));
      return [
        as(`SUM(${col} * ${w}) / NULLIF(SUM(${w}), 0)`, id),
        as(`SUM(${col} * ${w})`, `__${id}_xw`),
        as(`SUM(${w})`, `__${id}_w`),
      ];
    }
    default: return [];
  }
}

export function compileSql(view: ViewState, opts: CompileOptions, dialect: SqlDialect = DUCKDB): CompiledSql {
  const params = new Params(dialect);
  const from = tableRef(dialect, opts.table);
  const clauses = where(view, opts, dialect, params);
  const whereSql = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const path = opts.groupPath ?? [];
  const nextGroup = view.grouping[path.length];

  if (nextGroup !== undefined) {
    const dim = columnId(nextGroup);
    const dimCol = dialect.quote(dim);
    const select = [
      `${dimCol}`,
      `COUNT(*) AS ${dialect.quote('__count')}`,
      ...COLUMN_ORDER.filter((id) => META[id]!.kind === 'measure').flatMap((id) => aggregate(id, dialect)),
    ];
    const order: string[] = [];
    for (const s of view.sorting) {
      const id = columnId(s.id);
      if (id === dim || META[id]!.agg) order.push(`${dialect.quote(id)} ${s.desc ? 'DESC' : 'ASC'}`);
    }
    if (!order.some((o) => o.startsWith(dimCol))) order.push(`${dimCol} ASC`);
    const sql = `SELECT ${select.join(', ')} FROM ${from}${whereSql} GROUP BY ${dimCol} ORDER BY ${order.join(', ')}`;
    return { sql, params: params.values, shape: 'group', groupColumn: dim };
  }

  if (opts.count) {
    return { sql: `SELECT COUNT(*) AS ${dialect.quote('__count')} FROM ${from}${whereSql}`, params: params.values, shape: 'leaf' };
  }
  const select = COLUMN_ORDER.map((id) => dialect.quote(id)).join(', ');
  const order = view.sorting.map((s) => `${dialect.quote(columnId(s.id))} ${s.desc ? 'DESC' : 'ASC'}`);
  order.push(`${dialect.quote('tradeId')} ASC`);
  let sql = `SELECT ${select} FROM ${from}${whereSql} ORDER BY ${order.join(', ')}`;
  if (opts.limit !== undefined) sql += ` LIMIT ${Math.max(0, Math.floor(opts.limit))}`;
  if (opts.offset) sql += ` OFFSET ${Math.max(0, Math.floor(opts.offset))}`;
  return { sql, params: params.values, shape: 'leaf' };
}
