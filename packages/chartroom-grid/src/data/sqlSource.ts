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
import type { CellEdit } from '../grid/edit';
import { compileDistinct, compileSql, DUCKDB, sqlLiteral, tableRef, type SqlDialect } from './compileSql';
import type { GridRecord, GridSchema } from '../grid/schema';
import { TREASURY_SCHEMA } from './treasury';
import type { DataSource, QueryOptions, QueryResult, SourceDescription } from './source';

export interface SqlExecutor {
  /** Run one statement with positional parameters; rows as plain objects keyed by column alias. */
  run(sql: string, params: ReadonlyArray<string | number>): Promise<Array<Record<string, unknown>>>;
}



/** A group node's row id: stable across queries, distinct from any trade id. */
export const groupNodeId = (path: string[]) => `g:${path.map(encodeURIComponent).join('/')}`;
/** The path a group node id was made from — what a child query needs to ask for it again. */
export const groupNodePath = (id: string): string[] => (id.startsWith('g:') ? id.slice(2).split('/').filter((s) => s !== '').map(decodeURIComponent) : []);

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

/** A view that filters nothing, for a question asked of the whole table. */
const EMPTY_VIEW = { columnFilters: [], globalFilter: '', grouping: [], sorting: [] } as unknown as ViewState;

export function sqlSource({ executor, table, dialect = DUCKDB, name = `sql (${dialect.name})`, schema = TREASURY_SCHEMA }: SqlSourceOptions): DataSource<GridRecord> {
  const serves = { filter: true, sort: true, group: true, groupPath: true, window: true };
  return {
    async describe(): Promise<SourceDescription> {
      const q = dialect.quote;
      // The as-of is the schema's `asOf`, else its first date column; a schema with neither has none.
      const asOfColumn = schema.columns.asOf ? 'asOf' : schema.order.find((id) => schema.columns[id]?.unit === 'date');
      const [row] = await executor.run(
        `SELECT COUNT(*) AS ${q('__count')}${asOfColumn ? `, MAX(${q(asOfColumn)}) AS ${q('asOf')}` : ''} FROM ${tableRef(dialect, table)}`,
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
    async distinct(column: string, view?: ViewState): Promise<string[]> {
      if (!schema.columns[column]) throw new RangeError(`sqlSource: unknown column ${JSON.stringify(column)}`);
      // Without a view: every value the table holds. With one: the values its other filters leave.
      const c = compileDistinct(view ?? EMPTY_VIEW, column, { table }, dialect, schema);
      const raw = await executor.run(c.sql, c.params);
      return raw.map((r) => cellText(schema, column, r.v)).filter((v) => v !== '');
    },
    // A committed batch (ADR-87) is one UPDATE per edit by the row id, in one
    // transaction where the engine has them, so a batch lands whole or not at
    // all; the value binds as a parameter, or inlines escaped where the
    // dialect takes none (the same escaping the compiler uses).
    async update(edits: CellEdit[]) {
      const q = dialect.quote;
      const from = tableRef(dialect, table);
      for (const e of edits) {
        if (!schema.columns[e.columnId]) throw new RangeError(`sqlSource: unknown column ${JSON.stringify(e.columnId)}`);
        if (e.columnId === schema.rowId) throw new RangeError(`sqlSource: the row id column ${JSON.stringify(e.columnId)} is not editable`);
      }
      const statements = edits.map((e) => (dialect.inlineLiterals
        ? { sql: `UPDATE ${from} SET ${q(e.columnId)} = ${sqlLiteral(e.value)} WHERE ${q(schema.rowId)} = ${sqlLiteral(e.rowId)}`, params: [] as Array<string | number> }
        : { sql: `UPDATE ${from} SET ${q(e.columnId)} = ? WHERE ${q(schema.rowId)} = ?`, params: [e.value, e.rowId] }));
      // Dremio's REST API takes one statement per job and has no transaction to offer.
      const transactional = dialect.name !== 'dremio' && statements.length > 1;
      if (transactional) await executor.run('BEGIN', []);
      try {
        for (const st of statements) await executor.run(st.sql, st.params);
        if (transactional) await executor.run('COMMIT', []);
      } catch (err) {
        if (transactional) await executor.run('ROLLBACK', []).catch(() => undefined);
        throw err;
      }
    },
    async query(view: ViewState, { groupPath = [], window, totals }: QueryOptions = {}): Promise<QueryResult<GridRecord>> {
      // A pivot's buckets (ADR-80) need the dimension's values before a level or the totals compile:
      // the ones the view names (ADR-86), else every value the table holds.
      const pivotValues = view.pivot.column && (totals || view.grouping.length > groupPath.length)
        ? (view.pivot.buckets?.length ? view.pivot.buckets : await this.distinct!(view.pivot.column))
        : undefined;
      const leaf = view.grouping.length <= groupPath.length;
      // The grand totals (ADR-85): one aggregate scan, which also counts the
      // rows a window is cut from; without them a window still needs its count.
      let total: number | undefined;
      let grand: Record<string, number> | undefined;
      if (totals) {
        const c = compileSql(view, { table, groupPath, pivotValues, totals: true }, dialect, schema);
        const [row] = await executor.run(c.sql, c.params);
        total = num(row?.__count) || 0;
        grand = {};
        for (const k of Object.keys(row ?? {})) {
          if (k === '__count' || k.startsWith('__')) continue;
          const n = num(row![k]);
          if (Number.isFinite(n)) grand[k] = n;
        }
      } else if (window && leaf) {
        const c = compileSql(view, { table, groupPath, count: true }, dialect, schema);
        const [row] = await executor.run(c.sql, c.params);
        total = num(row?.__count) || 0;
      }
      const compiled = compileSql(view, { table, groupPath, pivotValues, ...(window && leaf ? { limit: window.limit, offset: window.offset } : {}) }, dialect, schema);
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
        return { rows, total: rows.length, applied: { filter: true, sort: true, group: true }, ...(grand ? { totals: grand } : {}) };
      }
      const rows = raw.map((r) => {
        const p: GridRecord = {};
        for (const id of schema.order) p[id] = schema.columns[id]?.kind === 'measure' ? num(r[id]) : cellText(schema, id, r[id]);
        return p;
      });
      if (window) {
        return { rows, total: total ?? rows.length, offset: window.offset, applied: { filter: true, sort: true, group: false, window: true }, ...(grand ? { totals: grand } : {}) };
      }
      return { rows, total: total ?? rows.length, applied: { filter: true, sort: true, group: false }, ...(grand ? { totals: grand } : {}) };
    },
  };
}
