/**
 * A source over SQL (ADR-70): the view compiles, an executor runs it, and
 * the answer says what it applied — filter and sort always, grouping when
 * the view groups deeper than the path asked for. The executor is injected:
 * DuckDB-WASM in the browser, Dremio's REST API, Node's SQLite in the
 * tests. No SQL leaves this module; the caller hands over a view.
 *
 * A group answer is a list of group nodes, Position-shaped so the columns
 * still read them — the grouped dimension filled, the others blank, every
 * measure holding its aggregate — with `__group` carrying the level, the
 * value, the count and the path a child query needs (lazy expansion).
 */

import type { GroupNode } from './groupNode';
export { isGroupNode, type GroupNode } from './groupNode';
import { isPivotId } from '../grid/pivot';
import { effectiveAgg } from '../grid/columns';
import type { ViewState } from '../grid/viewState';
import { compileSql, DUCKDB, type SqlDialect } from './compileSql';
import type { GridRecord, GridSchema } from '../grid/schema';
import { TREASURY_SCHEMA } from './treasury';
import type { DataSource, QueryOptions, QueryResult, SourceDescription } from './source';

export interface SqlExecutor {
  /** Run one statement with positional parameters; rows as plain objects keyed by column alias. */
  run(sql: string, params: ReadonlyArray<string | number>): Promise<Array<Record<string, unknown>>>;
}



/** A group node's row id: stable across queries, distinct from any trade id. */
export const groupNodeId = (path: string[]) => `g:${path.map(encodeURIComponent).join('/')}`;

export interface SqlSourceOptions {
  executor: SqlExecutor;
  table: string;
  dialect?: SqlDialect;
  name?: string;
  /** The columns the table holds (ADR-82); the treasury book by default. */
  schema?: GridSchema;
}

const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : v === null || v === undefined ? Number.NaN : Number(v));

/**
 * A date column as the ISO day the grid formats, whatever the engine
 * returned it as: DuckDB parses an ISO string in JSON into a DATE and Arrow
 * hands it back as epoch milliseconds; Dremio's REST API returns text.
 */
export function dateText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' || typeof v === 'bigint') return new Date(Number(v)).toISOString().slice(0, 10);
  return String(v);
}

const cellText = (schema: GridSchema, id: string, v: unknown): string => (schema.columns[id]?.unit === 'date' ? dateText(v) : String(v ?? ''));

function blankRecord(schema: GridSchema): GridRecord {
  const p: GridRecord = {};
  for (const id of schema.order) p[id] = schema.columns[id]?.kind === 'measure' ? Number.NaN : '';
  return p;
}

export function sqlSource({ executor, table, dialect = DUCKDB, name = `sql (${dialect.name})`, schema = TREASURY_SCHEMA }: SqlSourceOptions): DataSource<GridRecord> {
  const serves = { filter: true, sort: true, group: true, groupPath: true };
  return {
    async describe(): Promise<SourceDescription> {
      const q = dialect.quote;
      const [row] = await executor.run(
        `SELECT COUNT(*) AS ${q('__count')}, MAX(${q('asOf')}) AS ${q('asOf')} FROM ${table.split('.').map(q).join('.')}`,
        [],
      );
      return {
        name,
        asOf: row?.asOf === null || row?.asOf === undefined ? null : dateText(row.asOf),
        rowCount: num(row?.__count) || 0,
        columns: schema.order.map((id) => ({ id, meta: schema.columns[id]! })),
        rowId: schema.rowId,
        serves,
      };
    },
    async distinct(column: string): Promise<string[]> {
      const q = dialect.quote;
      if (!schema.columns[column]) throw new RangeError(`sqlSource: unknown column ${JSON.stringify(column)}`);
      const col = q(column);
      const raw = await executor.run(`SELECT DISTINCT ${col} AS ${q('v')} FROM ${table.split('.').map(q).join('.')} WHERE ${col} IS NOT NULL ORDER BY ${col}`, []);
      return raw.map((r) => String(r.v ?? '')).filter((v) => v !== '');
    },
    async query(view: ViewState, { groupPath = [] }: QueryOptions = {}): Promise<QueryResult<GridRecord>> {
      // A pivot's buckets (ADR-80) need the dimension's values before the level compiles.
      const pivotValues = view.pivot.column && view.grouping.length > groupPath.length ? await this.distinct!(view.pivot.column) : undefined;
      const compiled = compileSql(view, { table, groupPath, pivotValues }, dialect, schema);
      const raw = await executor.run(compiled.sql, compiled.params);
      if (compiled.shape === 'group') {
        const dim = compiled.groupColumn!;
        const rows: GroupNode[] = raw.map((r) => {
          const value = String(r[dim] ?? '');
          const node = blankRecord(schema) as GroupNode;
          node[dim] = value;
          for (const id of schema.order) {
            if (effectiveAgg(id, view.columnAggs, schema)) node[id] = num(r[id]);
          }
          // The bucketed aggregates travel on the node under their pivot ids, parts included.
          for (const k of Object.keys(r)) if (isPivotId(k)) node[k] = num(r[k]);
          const path = [...groupPath, value];
          node[schema.rowId] = groupNodeId(path);
          node.__group = { column: dim, value, path, depth: groupPath.length, count: num(r.__count) || 0 };
          return node;
        });
        return { rows, total: rows.length, applied: { filter: true, sort: true, group: true } };
      }
      const rows = raw.map((r) => {
        const p: GridRecord = {};
        for (const id of schema.order) p[id] = schema.columns[id]?.kind === 'measure' ? num(r[id]) : cellText(schema, id, r[id]);
        return p;
      });
      return { rows, total: rows.length, applied: { filter: true, sort: true, group: false } };
    },
  };
}
