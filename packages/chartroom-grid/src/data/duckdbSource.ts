/**
 * DuckDB in the browser (ADR-70): the seeded book loaded into a table in a
 * WebAssembly worker, and the view compiled to SQL against it. Everything
 * here is loaded lazily — the bundle carries a few kilobytes until a reader
 * asks for this source, then the worker and the module arrive as assets.
 *
 * The compiled SQL takes positional parameters; DuckDB-WASM's prepared
 * statements bind them. Arrow's BigInt counts are read back as numbers by
 * the SQL source.
 */

/// <reference types="vite/client" />
// Vite's `?url` asset imports, typed wherever this file compiles — the
// package's own typecheck and the studio's — from Vite's client types.
import mvpModule from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehModule from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { DUCKDB } from './compileSql';
import type { Position } from './mock';
import type { GridRecord, GridSchema } from '../grid/schema';
import type { DataSource } from './source';
import { sqlSource, type SqlExecutor } from './sqlSource';

export interface DuckDbExecutor extends SqlExecutor {
  close(): Promise<void>;
}

export const DUCKDB_TABLE = 'positions';

export async function createDuckDbExecutor(rows: Position[]): Promise<DuckDbExecutor> {
  const duckdb = await import('@duckdb/duckdb-wasm');
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpModule, mainWorker: mvpWorker },
    eh: { mainModule: ehModule, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker!);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.registerFileText(`${DUCKDB_TABLE}.json`, JSON.stringify(rows));
  const conn = await db.connect();
  // The file is an array of row objects; DuckDB-WASM detects that shape.
  await conn.insertJSONFromPath(`${DUCKDB_TABLE}.json`, { name: DUCKDB_TABLE });
  return {
    async run(sql, params) {
      const stmt = await conn.prepare(sql);
      try {
        const table = await stmt.query(...params);
        return table.toArray().map((r) => r.toJSON() as Record<string, unknown>);
      } finally {
        await stmt.close();
      }
    },
    async close() {
      await conn.close();
      await db.terminate();
      worker.terminate();
    },
  };
}

/** The book behind DuckDB-WASM, created on first use. */
export function duckdbSource(rows: Position[], name = 'DuckDB-WASM', schema?: GridSchema): DataSource<GridRecord> {
  let executor: Promise<DuckDbExecutor> | null = null;
  let ready: Promise<DataSource<GridRecord>> | null = null;
  const inner = () => (ready ??= (executor = createDuckDbExecutor(rows)).then((ex) => sqlSource({ executor: ex, table: DUCKDB_TABLE, dialect: DUCKDB, name, schema })));
  return {
    describe: () => inner().then((s) => s.describe()),
    query: (view, options) => inner().then((s) => s.query(view, options)),
    distinct: (column, view) => inner().then((s) => s.distinct!(column, view)),
    update: (edits) => inner().then((s) => s.update!(edits)),
    // The worker, the database and the connection go when the host lets the source go;
    // a later question starts a fresh engine rather than asking a closed one.
    async close() {
      const pending = executor;
      executor = null;
      ready = null;
      // A source that never started has nothing to close, and its failure was
      // its questions' to report — the host's `void close()` must not reject.
      if (pending) await pending.then((ex) => ex.close(), () => undefined);
    },
  };
}
