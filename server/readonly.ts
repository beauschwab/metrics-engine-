/**
 * The read-only guard.
 *
 * This is the security boundary between an authoring surface and a production
 * warehouse. Everything the registry sends to Dremio passes through here, and the
 * rule is absolute: **the registry reads, it never writes.** A metric definition
 * that could issue a `DROP` because someone typed one into a `where:` clause is
 * not a definition layer, it is a SQL console with extra steps.
 *
 * Two design choices, both deliberately conservative.
 *
 * **Comments and string literals are stripped before anything is judged.** A
 * keyword scan over raw text is defeated by `/* *\/ DROP TABLE t` and confused by
 * `WHERE note = 'delete me'`. The skeleton is what gets checked; the original is
 * what gets sent.
 *
 * **A forbidden verb anywhere is a refusal, not just a leading one.** A CTE can
 * hide a write — `WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a` is a real
 * statement — and following the CTE list correctly means matching parentheses,
 * which is more machinery to get subtly wrong. The cost is that a column
 * genuinely named `copy` would be refused. That is the right way round: the
 * failure is a clear message to the author, not a write to production.
 */

export interface Verdict {
  ok: boolean;
  /** Why it was refused, in terms the author can act on. */
  reason?: string;
}

/**
 * Verbs that make a statement do something other than read.
 *
 * `SET` and `PRAGMA` are here because a session setting is a side effect, and a
 * read that changes how later reads behave is not a read.
 */
const FORBIDDEN = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT',
  'CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'RENAME',
  'GRANT', 'REVOKE',
  'COPY', 'EXPORT', 'IMPORT', 'LOAD', 'UNLOAD',
  'CALL', 'EXECUTE', 'EXEC',
  'REFRESH', 'VACUUM', 'ANALYZE', 'OPTIMIZE',
  'ATTACH', 'DETACH', 'INSTALL',
  'SET', 'RESET', 'PRAGMA', 'USE',
];

/**
 * The statement with comments and string literals removed.
 *
 * Exported because the test suite asserts on it directly: a guard whose
 * normalisation is wrong is a guard that can be walked around, and the skeleton
 * is the only place that can be checked without inventing a SQL parser.
 */
export function skeleton(sql: string): string {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const two = sql.slice(i, i + 2);

    // Line comment.
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      out += ' ';
      continue;
    }

    // Block comment. Not nested — SQL does not nest them portably, and treating
    // them as nesting would let `/* /* */` smuggle text past the scan.
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
      continue;
    }

    const c = sql[i];

    // Single-quoted literal, with '' as the escape.
    if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += " '' ";
      continue;
    }

    // Double-quoted identifier. Kept as a placeholder rather than dropped: a
    // quoted column is still a token, and removing it could join two words.
    if (c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') {
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += ' "" ';
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

/** Is this a single statement that only reads? */
export function isReadOnly(sql: string): Verdict {
  const bare = skeleton(sql).trim();

  if (!bare) return { ok: false, reason: 'the statement is empty' };

  // A trailing semicolon is fine; anything before the end means two statements,
  // and the second one is where a write would hide.
  const withoutTrailing = bare.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return {
      ok: false,
      reason: 'more than one statement — the registry sends exactly one read at a time',
    };
  }

  const upper = withoutTrailing.toUpperCase();

  if (!/^\s*(SELECT|WITH)\b/.test(upper)) {
    const verb = /^\s*([A-Z_]+)/.exec(upper)?.[1] || 'that';
    return { ok: false, reason: `a statement must begin with SELECT or WITH, not ${verb}` };
  }

  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`).test(upper)) {
      return {
        ok: false,
        reason: `${word} is not allowed — the registry reads, it never writes`,
      };
    }
  }

  return { ok: true };
}

/**
 * A row cap the warehouse enforces, rather than one we hope it respects.
 *
 * Wrapping instead of appending `LIMIT`: the compiled plan may already end in
 * `ORDER BY`, and a plan that ends in its own `LIMIT` would silently get two.
 * The wrapper also means the cap applies to whatever the plan actually is,
 * including a `WITH` chain, without parsing it.
 *
 * `cap + 1` so the caller can tell "exactly the cap" from "more than the cap"
 * and say so, rather than presenting a truncated answer as a complete one.
 */
export function withRowCap(sql: string, cap: number): string {
  const bare = sql.trim().replace(/;\s*$/, '');
  return `SELECT * FROM (\n${bare}\n) AS keel_capped LIMIT ${cap + 1}`;
}
