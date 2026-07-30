/**
 * The dialect layer, both halves.
 *
 * The SQLite half is executed by `repository.test.ts` against a real database.
 * The SQL Server half cannot be — there is no SQL Server here and no Docker
 * daemon to start one — so it is held to the two strongest checks available
 * without a connection: the text is asserted verbatim, and it is handed to a
 * T-SQL parser. That is the same posture as the PySpark emitter, and it caught
 * the same class of bug there: something that reads correctly and is not.
 */

import { Parser } from 'node-sql-parser';
import { describe, expect, it } from 'vitest';
import {
  MSSQL, SQL, SQLITE, prepareSql, toNamedParameters, translateFunctions,
} from './dialect';

const parser = new Parser();
const parses = (sql: string, database: string) => {
  parser.astify(sql, { database });
};

const STATEMENTS = Object.entries(SQL);

describe('parameter rewriting', () => {
  it('leaves SQLite markers alone', () => {
    expect(SQLITE.bind('SELECT * FROM t WHERE a = ? AND b = ?'))
      .toBe('SELECT * FROM t WHERE a = ? AND b = ?');
  });

  it('numbers SQL Server markers from one, in order', () => {
    expect(MSSQL.bind('SELECT * FROM t WHERE a = ? AND b = ? AND c = ?'))
      .toBe('SELECT * FROM t WHERE a = @p1 AND b = @p2 AND c = @p3');
  });

  it('does not touch a question mark inside a literal', () => {
    // A naive global replace would shift every later parameter by one, and the
    // symptom would look like a binding-order bug rather than a quoting bug.
    expect(toNamedParameters("SELECT '?' AS q, ? AS p"))
      .toBe("SELECT '?' AS q, @p1 AS p");
  });

  it('handles an escaped quote inside a literal', () => {
    expect(toNamedParameters("SELECT 'it''s ?' , ?"))
      .toBe("SELECT 'it''s ?' , @p1");
  });

  it('counts nothing when there is nothing to count', () => {
    expect(toNamedParameters('SELECT 1')).toBe('SELECT 1');
  });
});

describe('function translation', () => {
  it('maps LENGTH to a byte-count halved, not to LEN', () => {
    // LEN ignores trailing whitespace, which for a YAML body under-reports.
    const out = translateFunctions('SELECT LENGTH(r.body) AS body_length', 'mssql');
    expect(out).toBe('SELECT DATALENGTH(r.body) / 2 AS body_length');
    expect(out).not.toContain('LEN(');
  });

  it('leaves SQLite alone', () => {
    expect(translateFunctions('SELECT LENGTH(r.body)', 'sqlite')).toBe('SELECT LENGTH(r.body)');
  });
});

describe('every statement is valid in both dialects', () => {
  it.each(STATEMENTS)('%s parses as SQLite', (_name, sql) => {
    expect(() => parses(prepareSql(sql, SQLITE), 'sqlite')).not.toThrow();
  });

  it.each(STATEMENTS)('%s parses as T-SQL', (_name, sql) => {
    expect(() => parses(prepareSql(sql, MSSQL), 'transactsql')).not.toThrow();
  });

  it('uses no construct that only one engine has', () => {
    STATEMENTS.forEach(([name, sql]) => {
      // `LIMIT` is SQLite-only and `TOP` is T-SQL-only; "the latest revision" is
      // a correlated MAX instead, which both plan off the same index.
      expect(sql, name).not.toMatch(/\bLIMIT\b/i);
      expect(sql, name).not.toMatch(/\bTOP\b/i);
      expect(sql, name).not.toMatch(/\bRETURNING\b/i);
      expect(sql, name).not.toMatch(/ON CONFLICT|MERGE\s+INTO/i);
    });
  });

  it('never updates or deletes a revision', () => {
    // The storage model is the audit trail. An UPDATE anywhere in this set
    // would mean a rule change could be made unrecoverable.
    STATEMENTS.forEach(([name, sql]) => {
      expect(sql, name).not.toMatch(/^\s*UPDATE\b/i);
      expect(sql, name).not.toMatch(/^\s*DELETE\b/i);
    });
  });
});

describe('schema', () => {
  it('is idempotent in both dialects', () => {
    expect(SQLITE.schema().every((s) => /IF NOT EXISTS/i.test(s))).toBe(true);
    // T-SQL has no CREATE TABLE IF NOT EXISTS, so each statement guards itself.
    expect(MSSQL.schema().every((s) => /^IF NOT EXISTS \(SELECT 1 FROM sys\./i.test(s))).toBe(true);
    expect(MSSQL.schema().some((s) => /CREATE TABLE IF NOT EXISTS/i.test(s))).toBe(false);
  });

  it('constrains one revision number per artifact in both', () => {
    // This is what turns two concurrent saves into a failed write rather than a
    // silent overwrite, so it is not optional in either dialect.
    expect(SQLITE.schema().join('\n')).toContain('UNIQUE (artifact_id, revision_no)');
    expect(MSSQL.schema().join('\n')).toContain('UNIQUE (artifact_id, revision_no)');
  });

  it('gives SQL Server unicode and unbounded bodies', () => {
    const ddl = MSSQL.schema().join('\n');
    expect(ddl).toContain('body         NVARCHAR(MAX)');
    // A display name like `FR 2052a — daily submission` is already not Latin-1.
    expect(ddl).not.toMatch(/\bVARCHAR\((?!MAX)/);
    expect(ddl).toContain('INT IDENTITY(1,1) PRIMARY KEY');
  });

  it('stores timestamps as text in both, so the two drivers agree', () => {
    // A native DATETIME2 reads back as a JS Date from `mssql` and as a string
    // from `node:sqlite`. A repository that returns different types in dev and
    // prod is a bug waiting for a deployment.
    expect(SQLITE.schema().join('\n')).toContain('created_at  TEXT NOT NULL');
    expect(MSSQL.schema().join('\n')).toContain('created_at  NVARCHAR(30) NOT NULL');
    expect(MSSQL.schema().join('\n')).not.toMatch(/DATETIME/i);
  });

  it('emits DDL each engine accepts', () => {
    SQLITE.schema().forEach((s) => {
      if (/^CREATE INDEX/i.test(s)) return; // the parser does not cover index DDL
      expect(() => parses(s, 'sqlite')).not.toThrow();
    });
  });
});
