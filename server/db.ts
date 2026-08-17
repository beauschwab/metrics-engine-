/**
 * The two drivers, behind one interface.
 *
 * Deliberately tiny. Everything interesting is in `dialect.ts` (statement text)
 * or `repository.ts` (what the statements mean); this file only knows how to
 * hand a string and some parameters to a driver and get rows back. That
 * division is what makes it possible to test the SQL Server path without a SQL
 * Server: the untestable part is small enough to read.
 *
 * SQLite comes from `node:sqlite`, which ships with Node rather than compiling
 * against it — one less native build to fail on a colleague's machine.
 */

import { prepareSql, type Dialect } from './dialect';

export type Param = string | number | null;

export interface Db {
  dialect: Dialect;
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  run(sql: string, params?: Param[]): Promise<void>;
  /** Run a unit of work atomically. Nested calls are not supported. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** A driver error that means "someone else got there first". */
export class ConflictError extends Error {}

/**
 * Both engines report a violated unique constraint, and neither does it the
 * same way. Recognising it is what turns a lost update into a `409` the caller
 * can retry, rather than a `500` that looks like the server broke.
 */
export function isUniqueViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /UNIQUE constraint failed/i.test(msg) ||          // node:sqlite
    /SQLITE_CONSTRAINT/i.test(msg) ||
    /Violation of UNIQUE KEY constraint/i.test(msg) || // SQL Server 2627
    /Cannot insert duplicate key/i.test(msg)
  );
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

interface SqliteStatement {
  all(...params: Param[]): unknown[];
  run(...params: Param[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

export async function openSqlite(file: string, dialect: Dialect): Promise<Db> {
  // Imported lazily so the browser bundle never sees a Node builtin, and so a
  // deployment running SQL Server does not need the SQLite module at all.
  const { DatabaseSync } = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const db = new DatabaseSync(file);

  // Foreign keys are off by default in SQLite, which would make the reference
  // from revision to artifact decorative. WAL so a read during a write does not
  // block — the editor saves while the workspace is being listed.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');

  let depth = 0;

  return {
    dialect,
    async all<T>(sql: string, params: Param[] = []): Promise<T[]> {
      return db.prepare(prepareSql(sql, dialect)).all(...params) as T[];
    },
    async run(sql: string, params: Param[] = []): Promise<void> {
      db.prepare(prepareSql(sql, dialect)).run(...params);
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      if (depth++ > 0) throw new Error('nested transaction');
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await work();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    async close() {
      db.close();
    },
  };
}

// ---------------------------------------------------------------------------
// SQL Server
// ---------------------------------------------------------------------------

export interface MssqlConfig {
  server: string;
  database: string;
  user?: string;
  password?: string;
  port?: number;
  /** Azure SQL and most managed instances require it; a dev container will not have a cert. */
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

/**
 * SQL Server, over a connection pool.
 *
 * Untested against a live server — there is no SQL Server in this environment
 * and no Docker daemon to start one. What *is* tested is everything this
 * function depends on: the DDL and DML text (asserted verbatim and parsed as
 * T-SQL), the `?` → `@p1` rewrite, and the repository logic, which runs against
 * real SQLite. This is the same posture as the PySpark emitter, and it is
 * stated rather than glossed.
 */
export async function openMssql(config: MssqlConfig, dialect: Dialect): Promise<Db> {
  const mssql = await import('mssql');
  const pool = await new mssql.ConnectionPool({
    server: config.server,
    database: config.database,
    user: config.user,
    password: config.password,
    port: config.port ?? 1433,
    options: {
      encrypt: config.encrypt ?? true,
      trustServerCertificate: config.trustServerCertificate ?? false,
    },
  }).connect();

  /** Tedious binds by name, so parameters go on the request as `p1…pn`. */
  const request = (tx?: unknown) => {
    const r = tx ? new mssql.Request(tx as never) : pool.request();
    return r;
  };

  const bindAll = (r: ReturnType<typeof request>, params: Param[]) => {
    params.forEach((v, i) => r.input(`p${i + 1}`, v));
    return r;
  };

  let tx: unknown = null;

  return {
    dialect,
    async all<T>(sql: string, params: Param[] = []): Promise<T[]> {
      const result = await bindAll(request(tx), params).query(prepareSql(sql, dialect));
      return result.recordset as T[];
    },
    async run(sql: string, params: Param[] = []): Promise<void> {
      await bindAll(request(tx), params).query(prepareSql(sql, dialect));
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      if (tx) throw new Error('nested transaction');
      const t = new mssql.Transaction(pool);
      await t.begin();
      tx = t;
      try {
        const result = await work();
        await t.commit();
        return result;
      } catch (err) {
        await t.rollback();
        throw err;
      } finally {
        tx = null;
      }
    },
    async close() {
      await pool.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Create the tables if they are not there. Safe to run on every boot. */
export async function migrate(db: Db): Promise<void> {
  for (const stmt of db.dialect.schema()) await db.run(stmt);
  // Additive column adds for already-created tables. Replayed every boot, so
  // "already exists" is the normal outcome rather than a fault; anything else
  // is a real migration failure and still throws.
  for (const stmt of db.dialect.alters?.() ?? []) {
    try {
      await db.run(stmt);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : String(e);
      const alreadyThere = msg.includes('duplicate column')
        || msg.includes('already exists')
        || msg.includes('duplicate object');
      if (!alreadyThere) throw e;
    }
  }
}
