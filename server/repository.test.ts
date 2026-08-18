/**
 * The repository, against a real SQLite database.
 *
 * These are the tests that actually execute SQL. Everything they cover — the
 * revision numbering, the no-op detection, the optimistic concurrency, the
 * as-of read — is dialect-agnostic by construction, so passing here is evidence
 * for the SQL Server path too, as far as anything short of a SQL Server can be.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openSqlite, type Db } from './db';
import { SQLITE } from './dialect';
import { Conflict, Repository, contentHash } from './repository';
import { shippedDocuments } from './index';

const dir = mkdtempSync(join(tmpdir(), 'keel-db-'));
let n = 0;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let db: Db;
let repo: Repository;

async function fresh(): Promise<Repository> {
  if (db) await db.close();
  db = await openSqlite(join(dir, `t${++n}.db`), SQLITE);
  await migrate(db);
  return new Repository(db);
}

beforeEach(async () => {
  repo = await fresh();
});

const RULES = `version: 1
kind: classification
name: demo
rules:
  - id: R1
    emit: A
    when: segment = 'RETAIL'`;

// ---------------------------------------------------------------------------

describe('schema', () => {
  it('can be applied twice', async () => {
    // Every boot runs it. A second run must be a no-op, not an error.
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it('enforces the foreign key from revision to artifact', async () => {
    // SQLite has foreign keys off by default, which would make the reference
    // decorative rather than enforced.
    await expect(
      db.run(
        'INSERT INTO keel_revision (artifact_id, revision_no, body, content_hash, author, message, created_at)' +
        " VALUES (9999, 1, 'x', 'h', 'a', 'm', '2026-01-01T00:00:00.000Z')",
      ),
    ).rejects.toThrow();
  });
});

describe('saving', () => {
  it('creates revision 1 for a new artifact', async () => {
    const r = await repo.save({
      name: 'demo', kind: 'classification', body: RULES, author: 'beau', message: 'first',
    });
    expect(r).toEqual({ revision: 1, changed: true });

    const latest = await repo.latest('demo');
    expect(latest?.body).toBe(RULES);
    expect(latest?.kind).toBe('classification');
    expect(latest?.author).toBe('beau');
    expect(latest?.contentHash).toBe(contentHash(RULES));
  });

  it('numbers each subsequent revision', async () => {
    for (let i = 1; i <= 4; i++) {
      const r = await repo.save({
        name: 'demo', kind: 'classification', body: `${RULES}\n# edit ${i}`,
        author: 'beau', message: `edit ${i}`,
      });
      expect(r.revision).toBe(i);
    }
    expect((await repo.history('demo')).map((h) => h.revision)).toEqual([4, 3, 2, 1]);
  });

  it('treats an identical body as no change at all', async () => {
    await repo.save({ name: 'demo', kind: 'classification', body: RULES, author: 'a', message: 'm' });
    const again = await repo.save({
      name: 'demo', kind: 'classification', body: RULES, author: 'a', message: 'm',
    });

    // Recording it would fill the history with entries nobody made a decision
    // in, and the history is what an auditor reads.
    expect(again).toEqual({ revision: 1, changed: false });
    expect(await repo.history('demo')).toHaveLength(1);
  });

  it('records a revert as its own revision', async () => {
    await repo.save({ name: 'demo', kind: 'classification', body: RULES, author: 'a', message: 'v1' });
    await repo.save({ name: 'demo', kind: 'classification', body: `${RULES}\n# oops`, author: 'a', message: 'v2' });
    const back = await repo.save({
      name: 'demo', kind: 'classification', body: RULES, author: 'a', message: 'revert',
    });

    // Going back to an earlier body is a decision someone made, and it happened
    // at a different time than the original. Deduplicating it would lose that.
    expect(back).toEqual({ revision: 3, changed: true });
    expect((await repo.latest('demo'))?.body).toBe(RULES);
  });

  it('never modifies a revision that already exists', async () => {
    await repo.save({ name: 'demo', kind: 'classification', body: RULES, author: 'a', message: 'v1' });
    const first = await repo.revision('demo', 1);
    await repo.save({ name: 'demo', kind: 'classification', body: 'changed', author: 'b', message: 'v2' });

    // The whole storage model rests on this: reproducing a filed number means
    // reading the rules exactly as they stood.
    expect(await repo.revision('demo', 1)).toEqual(first);
    expect((await repo.revision('demo', 2))?.body).toBe('changed');
  });
});

describe('concurrency', () => {
  it('rejects a save against a revision that has moved', async () => {
    await repo.save({ name: 'demo', kind: 'classification', body: RULES, author: 'a', message: 'v1' });
    await repo.save({ name: 'demo', kind: 'classification', body: 'b', author: 'b', message: 'v2' });

    // A stale tab holding revision 1 must not be allowed to overwrite 2 — that
    // is how a reviewed and approved change quietly disappears.
    await expect(
      repo.save({
        name: 'demo', kind: 'classification', body: 'c', author: 'c', message: 'v3',
        expectedRevision: 1,
      }),
    ).rejects.toThrow(Conflict);
  });

  it('names who got there first', async () => {
    await repo.save({ name: 'demo', kind: 'classification', body: RULES, author: 'a', message: 'v1' });
    await repo.save({ name: 'demo', kind: 'classification', body: 'b', author: 'priya', message: 'v2' });

    await expect(
      repo.save({
        name: 'demo', kind: 'classification', body: 'c', author: 'c', message: 'v3',
        expectedRevision: 1,
      }),
    ).rejects.toThrow(/priya/);
  });

  it('accepts a save against the current revision', async () => {
    await repo.save({ name: 'demo', kind: 'classification', body: RULES, author: 'a', message: 'v1' });
    const r = await repo.save({
      name: 'demo', kind: 'classification', body: 'b', author: 'a', message: 'v2',
      expectedRevision: 1,
    });
    expect(r.revision).toBe(2);
  });

  it('accepts a first save with no expectation to check', async () => {
    const r = await repo.save({
      name: 'new', kind: 'report', body: 'x', author: 'a', message: 'm', expectedRevision: 0,
    });
    expect(r.revision).toBe(1);
  });
});

describe('reading', () => {
  it('lists every artifact at its newest revision', async () => {
    await repo.save({ name: 'a', kind: 'report', body: 'a1', author: 'x', message: 'm' });
    await repo.save({ name: 'a', kind: 'report', body: 'a2', author: 'x', message: 'm' });
    await repo.save({ name: 'b', kind: 'classification', body: 'b1', author: 'x', message: 'm' });

    const ws = await repo.workspace();
    expect(ws.map((r) => [r.name, r.revision, r.body])).toEqual([
      ['a', 2, 'a2'],
      ['b', 1, 'b1'],
    ]);
  });

  it('reports the body length of each revision', async () => {
    await repo.save({ name: 'a', kind: 'report', body: RULES, author: 'x', message: 'm' });
    expect((await repo.history('a'))[0].bodyLength).toBe(RULES.length);
  });

  it('returns nothing for an artifact that does not exist', async () => {
    expect(await repo.latest('nope')).toBeNull();
    expect(await repo.revision('nope', 1)).toBeNull();
    expect(await repo.history('nope')).toEqual([]);
  });
});

describe('transaction time', () => {
  it('reads the workspace as it stood at a moment', async () => {
    await repo.save({ name: 'a', kind: 'report', body: 'v1', author: 'x', message: 'm' });
    const afterV1 = (await repo.latest('a'))!.createdAt;

    // A distinct later timestamp — the ISO string is millisecond-resolution, so
    // two saves in the same tick would be indistinguishable.
    await new Promise((r) => setTimeout(r, 5));
    await repo.save({ name: 'a', kind: 'report', body: 'v2', author: 'x', message: 'm' });

    // This is the axis the documents did not have. `effective.from/to` is when a
    // rule applies; this is when the registry knew it. A filed submission needs
    // both to be reproducible.
    expect((await repo.workspaceAsOf(afterV1)).map((r) => r.body)).toEqual(['v1']);
    expect((await repo.workspace()).map((r) => r.body)).toEqual(['v2']);
  });

  it('excludes an artifact that did not exist yet', async () => {
    await repo.save({ name: 'a', kind: 'report', body: 'v1', author: 'x', message: 'm' });
    const beforeB = new Date(Date.now() + 1).toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await repo.save({ name: 'b', kind: 'report', body: 'v1', author: 'x', message: 'm' });

    expect((await repo.workspaceAsOf(beforeB)).map((r) => r.name)).toEqual(['a']);
    expect((await repo.workspace()).map((r) => r.name)).toEqual(['a', 'b']);
  });

  it('returns an empty workspace before anything was written', async () => {
    await repo.save({ name: 'a', kind: 'report', body: 'v1', author: 'x', message: 'm' });
    expect(await repo.workspaceAsOf('2020-01-01T00:00:00.000Z')).toEqual([]);
  });
});

describe('seeding', () => {
  it('puts every shipped document in as revision 1', async () => {
    const docs = shippedDocuments();
    expect(docs).toHaveLength(8);
    expect(await repo.seed(docs)).toBe(8);

    const ws = await repo.workspace();
    expect(ws).toHaveLength(8);
    expect(ws.every((r) => r.revision === 1)).toBe(true);
    // The kind comes off the parsed document rather than being guessed.
    expect(ws.find((r) => r.name === 'fr2052a_product_id')?.kind).toBe('classification');
    expect(ws.find((r) => r.name === 'lcr_outflow_rates')?.kind).toBe('parameter_set');
    expect(ws.find((r) => r.name === 'fr2052a_submission')?.kind).toBe('report');
    expect(ws.find((r) => r.name === 'liquidity_pit')?.kind).toBe('metrics_view');
    expect(ws.find((r) => r.name === 'fr2052a_variance')?.kind).toBe('variance_monitor');
  });

  it('is a no-op on the second boot', async () => {
    await repo.seed(shippedDocuments());
    expect(await repo.seed(shippedDocuments())).toBe(0);
    expect((await repo.workspace()).every((r) => r.revision === 1)).toBe(true);
  });

  it('leaves an edited artifact alone rather than resetting it', async () => {
    await repo.seed(shippedDocuments());
    await repo.save({
      name: 'liquidity_pit', kind: 'metrics_view', body: 'edited', author: 'beau', message: 'change',
    });

    // The seed is a starting point, not a source of truth that keeps
    // reasserting itself over an author's work every time the server restarts.
    await repo.seed(shippedDocuments());
    expect((await repo.latest('liquidity_pit'))?.body).toBe('edited');
    expect((await repo.latest('liquidity_pit'))?.revision).toBe(2);
  });

  it('round-trips a document the parser still accepts', async () => {
    await repo.seed(shippedDocuments());
    const stored = (await repo.latest('fr2052a_product_id'))!.body;
    // Storage must not touch the text — a normalised newline or a trimmed line
    // would move every diagnostic's line number.
    const { INITIAL_DOCS } = await import('keel-engine/documents');
    expect(stored).toBe(INITIAL_DOCS.fr2052a_product_id);
  });
});
