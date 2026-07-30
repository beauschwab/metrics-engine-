/**
 * The read-only guard, which is the security boundary.
 *
 * Every case here is a way someone gets a write past a naive keyword check. They
 * are worth enumerating because the failure is not a wrong number — it is the
 * authoring surface issuing a `DROP` against a production warehouse.
 */

import { describe, expect, it } from 'vitest';
import { isReadOnly, skeleton, withRowCap } from './readonly';

const ok = (sql: string) => expect(isReadOnly(sql).ok, sql).toBe(true);
const no = (sql: string) => {
  const v = isReadOnly(sql);
  expect(v.ok, `should have been refused: ${sql}`).toBe(false);
  expect(v.reason, sql).toBeTruthy();
  return v.reason!;
};

describe('what is allowed', () => {
  it('accepts an ordinary read', () => {
    ok('SELECT 1');
    ok('select * from alm.positions');
    ok('SELECT a, SUM(b) FROM t WHERE d = DATE \'2026-06-30\' GROUP BY 1 ORDER BY 1');
  });

  it('accepts the compiled plans this registry actually emits', () => {
    ok(`WITH base AS (SELECT * FROM alm.fct_2052a_positions WHERE as_of_date = DATE '2026-06-30'),
        d1 AS (SELECT *, COALESCE(DATE_DIFF('day', as_of_date, maturity_date), 0) AS days FROM base)
        SELECT product_id, ROUND(SUM(balance_usd), 2) AS total FROM d1 GROUP BY 1`);
    ok(`WITH rollup AS (SELECT a, SUM(v) AS value FROM t GROUP BY 1)
        SELECT *, LAG(value) OVER (PARTITION BY a ORDER BY d) AS prev FROM rollup`);
  });

  it('accepts a trailing semicolon', () => {
    ok('SELECT 1;');
    ok('SELECT 1;   \n');
  });

  it('is not fooled by a keyword inside a string', () => {
    // A column holding the word is data, not a statement.
    ok("SELECT * FROM t WHERE note = 'delete this row'");
    ok("SELECT 'DROP TABLE customers' AS advice");
    ok("SELECT * FROM t WHERE s = 'it''s an update'");
  });
});

describe('what is refused', () => {
  it('refuses every write verb', () => {
    ['INSERT INTO t VALUES (1)', 'UPDATE t SET a = 1', 'DELETE FROM t',
      'DROP TABLE t', 'CREATE TABLE t (a INT)', 'ALTER TABLE t ADD COLUMN b INT',
      'TRUNCATE TABLE t', 'MERGE INTO t USING s ON 1=1',
      'GRANT SELECT ON t TO u', 'REVOKE SELECT ON t FROM u',
    ].forEach((sql) => no(sql));
  });

  it('refuses a write hidden behind a CTE', () => {
    // A real statement, and the reason the scan is not limited to the first verb.
    const reason = no('WITH a AS (SELECT 1) INSERT INTO t SELECT * FROM a');
    expect(reason).toContain('INSERT');
  });

  it('refuses a second statement', () => {
    const reason = no('SELECT 1; DROP TABLE customers');
    expect(reason).toContain('more than one statement');
    no("SELECT 1;\nDELETE FROM t");
  });

  it('refuses a write hidden behind a comment', () => {
    // The classic. A keyword scan over raw text sees a comment and stops
    // looking; the skeleton removes it first.
    no('SELECT 1 /* harmless */ ; DROP TABLE t');
    no('-- a note\nDROP TABLE t');
    no('/* SELECT */ DROP TABLE t');
  });

  it('refuses a comment that swallows the rest of the line', () => {
    // `--` inside what looks like a statement does not make the tail invisible.
    no('DROP TABLE t -- SELECT 1');
  });

  it('refuses session state changes, which are side effects', () => {
    no('SET query_timeout = 1');
    no('USE otherspace');
    no('PRAGMA table_info(t)');
  });

  it('refuses procedure calls and refreshes', () => {
    no('CALL sys.do_something()');
    no("REFRESH DATASET alm.positions");
    no('SELECT * FROM t; CALL x()');
  });

  it('refuses an empty statement', () => {
    expect(no('')).toContain('empty');
    expect(no('   \n  -- nothing here')).toContain('empty');
  });

  it('names the verb it refused, so the author can act on it', () => {
    expect(no('EXPLAIN SELECT 1')).toMatch(/EXPLAIN/);
  });
});

describe('the skeleton', () => {
  it('removes comments without joining the tokens either side', () => {
    expect(skeleton('SELECT/* x */1').replace(/\s+/g, ' ')).toBe('SELECT 1');
    expect(skeleton('SELECT 1 -- trailing\nFROM t').replace(/\s+/g, ' ')).toBe('SELECT 1 FROM t');
  });

  it('replaces a literal with a placeholder rather than deleting it', () => {
    // Deleting could weld two identifiers into one word and hide a keyword.
    expect(skeleton("a'x'b").replace(/\s+/g, ' ')).toBe("a '' b");
    expect(skeleton('a"x"b').replace(/\s+/g, ' ')).toBe('a "" b');
  });

  it('handles an unterminated literal without hanging or leaking', () => {
    // Malformed input must still be refused rather than crash the server.
    expect(() => isReadOnly("SELECT 'unterminated")).not.toThrow();
    expect(() => isReadOnly('SELECT /* unterminated')).not.toThrow();
    expect(isReadOnly('SELECT /* unterminated').ok).toBe(true);
  });

  it('does not treat a nested block comment as nesting', () => {
    // SQL block comments do not portably nest, and pretending they do would let
    // `/* /* */ DROP` past — the outer close would be read as inner.
    no('/* /* */ DROP TABLE t');
  });
});

describe('the row cap', () => {
  it('wraps rather than appending, so an existing LIMIT is not doubled', () => {
    const capped = withRowCap('SELECT * FROM t ORDER BY a LIMIT 10', 100);
    expect(capped).toContain('SELECT * FROM (');
    expect(capped).toContain('LIMIT 101');
    expect(capped.match(/LIMIT/g)).toHaveLength(2);
  });

  it('asks for one more than the cap, so truncation is detectable', () => {
    // Presenting a truncated answer as a complete one is the failure this avoids.
    expect(withRowCap('SELECT 1', 5000)).toContain('LIMIT 5001');
  });

  it('survives a trailing semicolon', () => {
    expect(withRowCap('SELECT 1;', 10)).not.toContain(';');
  });

  it('produces something the guard still accepts', () => {
    ok(withRowCap('WITH a AS (SELECT 1) SELECT * FROM a', 100));
  });
});
