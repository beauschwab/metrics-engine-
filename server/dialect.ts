/**
 * Every place SQLite and SQL Server disagree, in one file.
 *
 * The reason this is a module rather than a scattering of `if (mssql)` checks is
 * that only one of the two can be executed here: there is no SQL Server in this
 * environment and no Docker daemon to start one. So the T-SQL side is proved the
 * only way it can be — by asserting the exact text it emits and handing that
 * text to a T-SQL parser — and that is only worth anything if *all* of it lives
 * somewhere a test can reach without a connection.
 *
 * Everything above this file is written once and runs on both.
 *
 * Two deliberate portability choices, both of which cost something:
 *
 * Timestamps are ISO-8601 UTC *strings*, not `DATETIME2`. A native date type
 * would index better and read more naturally in a query tool, but the two
 * drivers hand it back differently — `node:sqlite` returns whatever was stored,
 * `mssql` returns a JS `Date` — and a repository that returns a string in
 * development and an object in production is a bug waiting for a deployment.
 * ISO-8601 UTC sorts lexicographically, so range queries still work.
 *
 * Nothing needs the identity of a freshly inserted row. Reading it back is the
 * one thing the two engines do least alike (`lastInsertRowid` versus
 * `SCOPE_IDENTITY()` versus `OUTPUT INSERTED`), and every statement here is
 * written to avoid the question rather than to abstract over it.
 */

export type DialectName = 'sqlite' | 'mssql';

export interface Dialect {
  name: DialectName;
  /** DDL, in dependency order. Each is separately executable and idempotent. */
  schema(): string[];
  /**
   * Rewrite positional `?` markers into whatever the driver binds.
   *
   * The repository writes one flavour of SQL. Tedious wants `@p1`, `node:sqlite`
   * wants `?`, and getting this wrong shifts every parameter by one rather than
   * failing outright — so it is a pure function with its own tests.
   */
  bind(sql: string): string;
}

const ARTIFACT = 'keel_artifact';
const REVISION = 'keel_revision';

/**
 * The one thing the schema is really about: revisions are append-only.
 *
 * A governed rule set is never updated in place. Reproducing a number that was
 * filed last quarter means reading the rules exactly as they stood, and an
 * `UPDATE` destroys that. So the only write is an `INSERT`, and history is not
 * a feature bolted on for auditing — it is the storage model.
 *
 * `UNIQUE (artifact_id, revision_no)` is doing real work beyond tidiness: two
 * authors saving at once compute the same next revision number, and the
 * constraint turns that into a failed write the caller can retry rather than a
 * silent overwrite of someone else's change.
 */
const SQLITE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ${ARTIFACT} (
  artifact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,
  created_at  TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS ${REVISION} (
  revision_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id  INTEGER NOT NULL REFERENCES ${ARTIFACT}(artifact_id),
  revision_no  INTEGER NOT NULL,
  body         TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  author       TEXT NOT NULL,
  message      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (artifact_id, revision_no)
)`,
  `CREATE INDEX IF NOT EXISTS ix_${REVISION}_artifact ON ${REVISION} (artifact_id, revision_no)`,
  `CREATE INDEX IF NOT EXISTS ix_${REVISION}_created ON ${REVISION} (artifact_id, created_at)`,
];

/**
 * The same schema for SQL Server.
 *
 * `CREATE TABLE IF NOT EXISTS` does not exist in T-SQL, so each statement is
 * guarded on `sys.tables` / `sys.indexes` instead. `NVARCHAR(MAX)` for the body
 * because a rule set has no useful length bound, and `NVARCHAR` throughout
 * rather than `VARCHAR` because a citation or a display name may not be Latin-1
 * — `FR 2052a — daily submission` already is not.
 */
const MSSQL_SCHEMA = [
  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '${ARTIFACT}')
CREATE TABLE ${ARTIFACT} (
  artifact_id INT IDENTITY(1,1) PRIMARY KEY,
  name        NVARCHAR(200) NOT NULL UNIQUE,
  kind        NVARCHAR(40) NOT NULL,
  created_at  NVARCHAR(30) NOT NULL
)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '${REVISION}')
CREATE TABLE ${REVISION} (
  revision_id  INT IDENTITY(1,1) PRIMARY KEY,
  artifact_id  INT NOT NULL REFERENCES ${ARTIFACT}(artifact_id),
  revision_no  INT NOT NULL,
  body         NVARCHAR(MAX) NOT NULL,
  content_hash NVARCHAR(64) NOT NULL,
  author       NVARCHAR(200) NOT NULL,
  message      NVARCHAR(1000) NOT NULL,
  created_at   NVARCHAR(30) NOT NULL,
  CONSTRAINT uq_${REVISION}_no UNIQUE (artifact_id, revision_no)
)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_${REVISION}_artifact')
CREATE INDEX ix_${REVISION}_artifact ON ${REVISION} (artifact_id, revision_no)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_${REVISION}_created')
CREATE INDEX ix_${REVISION}_created ON ${REVISION} (artifact_id, created_at)`,
];

/**
 * Replace positional markers, ignoring any inside a string literal.
 *
 * No statement in this server puts a `?` in a literal, but a naive
 * `replace(/\?/g)` would silently corrupt the first one that ever did, and the
 * corruption would look like a parameter-order bug rather than a quoting bug.
 */
export function toNamedParameters(sql: string, prefix = '@p'): string {
  let out = '';
  let n = 0;
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") {
      // '' inside a literal is an escaped quote, not the end of one.
      if (inString && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inString = !inString;
      out += c;
      continue;
    }
    if (c === '?' && !inString) {
      out += `${prefix}${++n}`;
      continue;
    }
    out += c;
  }

  return out;
}

export const SQLITE: Dialect = {
  name: 'sqlite',
  schema: () => SQLITE_SCHEMA.slice(),
  bind: (sql) => sql,
};

export const MSSQL: Dialect = {
  name: 'mssql',
  schema: () => MSSQL_SCHEMA.slice(),
  bind: (sql) => toNamedParameters(sql),
};

export function dialectFor(name: DialectName): Dialect {
  return name === 'mssql' ? MSSQL : SQLITE;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/**
 * Every statement the repository runs, in one dialect-neutral place.
 *
 * These are deliberately written in the intersection of the two grammars: no
 * `LIMIT`, no `TOP`, no `RETURNING`, no upsert. "The latest revision" is a
 * correlated `MAX(revision_no)` rather than an ordered fetch, which both
 * engines plan well off the index above and neither spells differently.
 */
export const SQL = {
  artifactByName: `SELECT artifact_id, name, kind, created_at FROM ${ARTIFACT} WHERE name = ?`,

  insertArtifact: `INSERT INTO ${ARTIFACT} (name, kind, created_at) VALUES (?, ?, ?)`,

  /**
   * Append a revision, numbering it from what is already there.
   *
   * `INSERT … SELECT` rather than a read followed by a write: the number is
   * computed by the same statement that uses it, so two concurrent callers
   * collide on the unique constraint instead of interleaving a stale read.
   */
  insertRevision:
    `INSERT INTO ${REVISION}
  (artifact_id, revision_no, body, content_hash, author, message, created_at)
SELECT
  a.artifact_id,
  COALESCE((SELECT MAX(r.revision_no) FROM ${REVISION} r WHERE r.artifact_id = a.artifact_id), 0) + 1,
  ?, ?, ?, ?, ?
FROM ${ARTIFACT} a
WHERE a.name = ?`,

  /** The current workspace: every artifact at its newest revision. */
  latestAll:
    `SELECT a.name, a.kind, r.revision_no, r.body, r.content_hash, r.author, r.message, r.created_at
FROM ${ARTIFACT} a
JOIN ${REVISION} r ON r.artifact_id = a.artifact_id
WHERE r.revision_no = (
  SELECT MAX(r2.revision_no) FROM ${REVISION} r2 WHERE r2.artifact_id = a.artifact_id
)
ORDER BY a.name`,

  latestOne:
    `SELECT a.name, a.kind, r.revision_no, r.body, r.content_hash, r.author, r.message, r.created_at
FROM ${ARTIFACT} a
JOIN ${REVISION} r ON r.artifact_id = a.artifact_id
WHERE a.name = ?
  AND r.revision_no = (
    SELECT MAX(r2.revision_no) FROM ${REVISION} r2 WHERE r2.artifact_id = a.artifact_id
  )`,

  /**
   * The workspace as it stood at a transaction time.
   *
   * This is the other half of the bitemporality the documents already declare.
   * `effective.from/to` is valid time — when a rule applies. This is
   * transaction time — when we knew it. Reproducing a filed submission needs
   * both, and until now the second one lived only in git history.
   */
  asOfAll:
    `SELECT a.name, a.kind, r.revision_no, r.body, r.content_hash, r.author, r.message, r.created_at
FROM ${ARTIFACT} a
JOIN ${REVISION} r ON r.artifact_id = a.artifact_id
WHERE r.created_at <= ?
  AND r.revision_no = (
    SELECT MAX(r2.revision_no) FROM ${REVISION} r2
    WHERE r2.artifact_id = a.artifact_id AND r2.created_at <= ?
  )
ORDER BY a.name`,

  history:
    `SELECT r.revision_no, r.content_hash, r.author, r.message, r.created_at, LENGTH(r.body) AS body_length
FROM ${ARTIFACT} a
JOIN ${REVISION} r ON r.artifact_id = a.artifact_id
WHERE a.name = ?
ORDER BY r.revision_no DESC`,

  revision:
    `SELECT r.revision_no, r.body, r.content_hash, r.author, r.message, r.created_at
FROM ${ARTIFACT} a
JOIN ${REVISION} r ON r.artifact_id = a.artifact_id
WHERE a.name = ? AND r.revision_no = ?`,
} as const;

/**
 * `LENGTH` is `LEN` in T-SQL — and they are not the same function.
 *
 * `LEN` ignores trailing spaces, which for a YAML body would under-report. The
 * T-SQL equivalent of `LENGTH` is `DATALENGTH`, halved for `NVARCHAR` because
 * it counts bytes. This is the only function in `SQL` that needs translating,
 * and it is worth the ugliness to keep the statements themselves shared.
 */
export function translateFunctions(sql: string, dialect: DialectName): string {
  if (dialect !== 'mssql') return sql;
  return sql.replace(/LENGTH\((r\.body)\)/g, 'DATALENGTH($1) / 2');
}

/** A statement, ready for the driver it is going to. */
export function prepareSql(sql: string, dialect: Dialect): string {
  return dialect.bind(translateFunctions(sql, dialect.name));
}
