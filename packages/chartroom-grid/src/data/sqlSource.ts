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

import { COLUMN_META, COLUMN_ORDER, effectiveAgg } from '../grid/columns';
import type { ViewState } from '../grid/viewState';
import { compileSql, DUCKDB, type SqlDialect } from './compileSql';
import type { Position } from './mock';
import type { DataSource, QueryOptions, QueryResult, SourceDescription } from './source';

export interface SqlExecutor {
  /** Run one statement with positional parameters; rows as plain objects keyed by column alias. */
  run(sql: string, params: ReadonlyArray<string | number>): Promise<Array<Record<string, unknown>>>;
}

export interface GroupNode extends Position {
  __group: {
    column: keyof Position;
    value: string;
    /** The values of every grouping column down to this node, outermost first. */
    path: string[];
    depth: number;
    count: number;
  };
}

export const isGroupNode = (row: Position): row is GroupNode => '__group' in row;

/** A group node's row id: stable across queries, distinct from any trade id. */
export const groupNodeId = (path: string[]) => `g:${path.map(encodeURIComponent).join('/')}`;

export interface SqlSourceOptions {
  executor: SqlExecutor;
  table: string;
  dialect?: SqlDialect;
  name?: string;
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

const cellText = (id: keyof Position, v: unknown): string => (COLUMN_META[id].unit === 'date' ? dateText(v) : String(v ?? ''));

function blankPosition(): Position {
  const p: Record<string, unknown> = {};
  for (const id of COLUMN_ORDER) p[id] = COLUMN_META[id].kind === 'measure' ? Number.NaN : '';
  return p as unknown as Position;
}

export function sqlSource({ executor, table, dialect = DUCKDB, name = `sql (${dialect.name})` }: SqlSourceOptions): DataSource<Position> {
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
        columns: COLUMN_ORDER.map((id) => ({ id, meta: COLUMN_META[id] })),
        serves,
      };
    },
    async query(view: ViewState, { groupPath = [] }: QueryOptions = {}): Promise<QueryResult<Position>> {
      const compiled = compileSql(view, { table, groupPath }, dialect);
      const raw = await executor.run(compiled.sql, compiled.params);
      if (compiled.shape === 'group') {
        const dim = compiled.groupColumn!;
        const rows: GroupNode[] = raw.map((r) => {
          const value = String(r[dim] ?? '');
          const node = blankPosition() as GroupNode;
          (node as unknown as Record<string, unknown>)[dim] = value;
          for (const id of COLUMN_ORDER) {
            if (effectiveAgg(id, view.columnAggs)) (node as unknown as Record<string, unknown>)[id] = num(r[id]);
          }
          const path = [...groupPath, value];
          node.tradeId = groupNodeId(path);
          node.__group = { column: dim, value, path, depth: groupPath.length, count: num(r.__count) || 0 };
          return node;
        });
        return { rows, total: rows.length, applied: { filter: true, sort: true, group: true } };
      }
      const rows = raw.map((r) => {
        const p: Record<string, unknown> = {};
        for (const id of COLUMN_ORDER) p[id] = COLUMN_META[id].kind === 'measure' ? num(r[id]) : cellText(id, r[id]);
        return p as unknown as Position;
      });
      return { rows, total: rows.length, applied: { filter: true, sort: true, group: false } };
    },
  };
}
