/**
 * A SQL executor for the tests: Node's own SQLite, the seeded book loaded
 * into a `positions` table. `node:` imports are the tests' privilege, not
 * the package's (the boundaries test), which is why this lives here.
 */

import { DatabaseSync } from 'node:sqlite';
import { COLUMN_META, COLUMN_ORDER } from '../src/grid/columns';
import type { Position } from '../src/data/mock';
import type { SqlExecutor } from '../src/data/sqlSource';

export function sqliteExecutor(rows: Position[]): SqlExecutor & { db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  const cols = COLUMN_ORDER.map((id) => `"${id}" ${COLUMN_META[id].kind === 'measure' ? 'REAL' : 'TEXT'}`).join(', ');
  db.exec(`CREATE TABLE positions (${cols})`);
  const insert = db.prepare(`INSERT INTO positions VALUES (${COLUMN_ORDER.map(() => '?').join(', ')})`);
  db.exec('BEGIN');
  for (const r of rows) insert.run(...COLUMN_ORDER.map((id) => r[id] as string | number));
  db.exec('COMMIT');
  return {
    db,
    async run(sql, params) {
      return db.prepare(sql).all(...(params as Array<string | number>)) as Array<Record<string, unknown>>;
    },
  };
}
