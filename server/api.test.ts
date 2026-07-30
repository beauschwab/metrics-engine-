/**
 * The HTTP contract.
 *
 * Tested at the level it is written — request in, response out, no socket. The
 * status codes are the part worth pinning: a client that cannot tell "someone
 * else saved first" from "the server is broken" will either retry a real failure
 * forever or silently drop an author's work.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from './api';
import { migrate, openSqlite, type Db } from './db';
import { SQLITE } from './dialect';
import { Repository } from './repository';
import { shippedDocuments } from './index';

const dir = mkdtempSync(join(tmpdir(), 'keel-api-'));
let n = 0;
let db: Db;
let repo: Repository;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (db) await db.close();
  db = await openSqlite(join(dir, `t${++n}.db`), SQLITE);
  await migrate(db);
  repo = new Repository(db);
  await repo.seed(shippedDocuments());
});

const get = (path: string, query?: Record<string, string>) =>
  handle(repo, { method: 'GET', path, ...(query ? { query } : {}) });

const put = (path: string, body: unknown) =>
  handle(repo, { method: 'PUT', path, body });

// ---------------------------------------------------------------------------

describe('reading', () => {
  it('serves the seeded workspace', async () => {
    const res = await get('/api/artifacts');
    expect(res.status).toBe(200);
    const { artifacts } = res.body as { artifacts: Array<{ name: string; revision: number }> };
    expect(artifacts).toHaveLength(6);
    expect(artifacts.map((a) => a.name)).toContain('fr2052a_product_id');
  });

  it('serves one artifact, and its history', async () => {
    expect((await get('/api/artifacts/liquidity_pit')).status).toBe(200);
    const hist = await get('/api/artifacts/liquidity_pit/history');
    expect(hist.status).toBe(200);
    expect((hist.body as { history: unknown[] }).history).toHaveLength(1);
  });

  it('serves a specific revision', async () => {
    await put('/api/artifacts/liquidity_pit', { body: 'v2', kind: 'metrics_view' });
    const first = await get('/api/artifacts/liquidity_pit', { revision: '1' });
    expect((first.body as { body: string }).body).not.toBe('v2');
    expect((await get('/api/artifacts/liquidity_pit')).body).toMatchObject({ body: 'v2' });
  });

  it('404s an artifact that does not exist', async () => {
    expect((await get('/api/artifacts/nope')).status).toBe(404);
    expect((await get('/api/artifacts/nope/history')).status).toBe(404);
  });

  it('404s an unknown route rather than falling through', async () => {
    expect((await get('/api/nonsense')).status).toBe(404);
    expect((await handle(repo, { method: 'DELETE', path: '/api/artifacts/liquidity_pit' })).status)
      .toBe(404);
  });

  it('reports health without touching the database', async () => {
    expect(await get('/api/health')).toEqual({ status: 200, body: { ok: true } });
  });
});

describe('writing', () => {
  it('appends a revision', async () => {
    const res = await put('/api/artifacts/liquidity_pit', {
      body: 'edited', kind: 'metrics_view', author: 'beau', message: 'tightened the filter',
    });
    expect(res).toEqual({ status: 200, body: { name: 'liquidity_pit', revision: 2, changed: true } });
  });

  it('reports an unchanged body as unchanged', async () => {
    const current = (await get('/api/artifacts/liquidity_pit')).body as { body: string };
    const res = await put('/api/artifacts/liquidity_pit', { body: current.body });
    expect(res.body).toMatchObject({ revision: 1, changed: false });
  });

  it('rejects a body that is not a string', async () => {
    expect((await put('/api/artifacts/liquidity_pit', { body: 42 })).status).toBe(400);
    expect((await put('/api/artifacts/liquidity_pit', {})).status).toBe(400);
  });

  it('409s a save against a stale revision', async () => {
    await put('/api/artifacts/liquidity_pit', { body: 'v2', author: 'priya' });
    const res = await put('/api/artifacts/liquidity_pit', {
      body: 'v3', author: 'beau', expectedRevision: 1,
    });

    // Not a 500. The client can reload and reapply; it cannot do anything useful
    // about a server that is actually broken.
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toContain('priya');
  });

  it('creates an artifact the workspace did not have', async () => {
    const res = await put('/api/artifacts/new_view', { body: 'version: 1', kind: 'metrics_view' });
    expect(res.body).toMatchObject({ revision: 1, changed: true });
    expect(((await get('/api/artifacts')).body as { artifacts: unknown[] }).artifacts).toHaveLength(7);
  });

  it('refuses a name that is not a plain identifier', async () => {
    // The route pattern is the guard. A name that could contain a slash or a
    // space would make the URL ambiguous.
    expect((await put('/api/artifacts/../etc/passwd', { body: 'x' })).status).toBe(404);
    expect((await put('/api/artifacts/has spaces', { body: 'x' })).status).toBe(404);
  });
});

describe('transaction time', () => {
  it('serves the workspace as it stood at a moment', async () => {
    const at = ((await get('/api/artifacts')).body as {
      artifacts: Array<{ createdAt: string }>;
    }).artifacts[0].createdAt;

    await new Promise((r) => setTimeout(r, 5));
    await put('/api/artifacts/liquidity_pit', { body: 'later' });

    const then = await get('/api/artifacts', { at });
    const bodies = (then.body as { artifacts: Array<{ body: string }> }).artifacts.map((a) => a.body);
    expect(bodies).not.toContain('later');
    expect((then.body as { asOf: string }).asOf).toBe(at);

    const nowRes = await get('/api/artifacts');
    expect((nowRes.body as { artifacts: Array<{ body: string }> }).artifacts.map((a) => a.body))
      .toContain('later');
  });
});
