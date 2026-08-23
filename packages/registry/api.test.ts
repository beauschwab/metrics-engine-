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
import { BodyTooLarge, readBody, shippedDocuments } from './index';
import { VIEW_FILES } from 'keel-engine/documents';

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
    expect(artifacts).toHaveLength(VIEW_FILES.length);
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
    // Counted relative to what was seeded: the assertion is "one more than
    // before", and hardcoding a total makes every future shipped document look
    // like a regression here.
    const before = ((await get('/api/artifacts')).body as { artifacts: unknown[] }).artifacts.length;
    const res = await put('/api/artifacts/new_view', { body: 'version: 1', kind: 'metrics_view' });
    expect(res.body).toMatchObject({ revision: 1, changed: true });
    expect(((await get('/api/artifacts')).body as { artifacts: unknown[] }).artifacts)
      .toHaveLength(before + 1);
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

describe('the request body', () => {
  async function* chunks(total: number): AsyncGenerator<Buffer> {
    // Sent in pieces, like a real socket — the cap has to bite mid-stream
    // rather than after the whole thing is already in memory.
    for (let sent = 0; sent < total; sent += 64 * 1024) {
      yield Buffer.alloc(Math.min(64 * 1024, total - sent), 0x20);
    }
  }

  it('reads ordinary JSON', async () => {
    async function* one(): AsyncGenerator<Buffer> {
      yield Buffer.from('{"body":"hello"}');
    }
    expect(await readBody(one())).toEqual({ body: 'hello' });
  });

  it('refuses a body larger than the limit', async () => {
    // Unbounded, one unauthenticated request makes the process allocate until
    // it dies — cheap to send, and the registry is what every author depends on.
    await expect(readBody(chunks(2 * 1024 * 1024))).rejects.toThrow(BodyTooLarge);
  });

  it('treats unreadable JSON as absent rather than throwing', async () => {
    async function* junk(): AsyncGenerator<Buffer> {
      yield Buffer.from('not json at all');
    }
    expect(await readBody(junk())).toBeNull();
  });
});

describe('live routes without a warehouse', () => {
  it('says which variable is missing rather than 404ing', async () => {
    // A 404 would read as "this build has no live support", which is a
    // different problem from "nobody configured a warehouse".
    const res = await handle(repo, { method: 'GET', path: '/api/live/status' });
    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toContain('KEEL_DREMIO_URI');
  });

  it('answers the same way for every live route, including POSTs', async () => {
    for (const path of [
      '/api/live/report/fr2052a_submission',
      '/api/live/coverage/fr2052a_outflows',
      '/api/live/sample/fr2052a_outflows',
    ]) {
      expect((await handle(repo, { method: 'POST', path, body: {} })).status).toBe(503);
    }
  });
});

// ---------------------------------------------------------------------------
// The human seam (ADR-57)
// ---------------------------------------------------------------------------

describe('the human seam (ADR-57)', () => {
  const as = (identity: string | null, method: string, path: string, body?: unknown,
    controls?: { requireIdentity?: boolean }) =>
    handle(repo, {
      method, path,
      ...(body !== undefined ? { body } : {}),
      ...(identity !== null ? { identity } : {}),
    }, controls ? { controls } : {});

  const body = async (name: string) => (await repo.latest(name))!.body;

  it('refuses an agent identity on every write route, mode or no mode', async () => {
    // The registry's tool surface never offers agents the write tools
    // (ADR-56); the HTTP door holds the same line rather than being the way
    // around it. No mode flag involved — this is identity, not configuration.
    const doc = await body('liquidity_pit');
    const writes: Array<[string, string, unknown]> = [
      ['PUT', '/api/artifacts/liquidity_pit', { body: doc, message: 'x' }],
      ['POST', '/api/releases', { message: 'x' }],
      ['PUT', '/api/channels/production', { version: 1 }],
      ['POST', '/api/artifacts/liquidity_pit/review', { revision: 1 }],
      ['POST', '/api/releases/1/review', {}],
    ];
    for (const [method, path, payload] of writes) {
      const res = await as('agent:lg-registry', method, path, payload);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((res.body as { error: string }).error).toMatch(/agent identity/);
    }
  });

  it('with the mode on, refuses an identity-less write and names the control', async () => {
    const doc = await body('liquidity_pit');
    const res = await as(null, 'PUT', '/api/artifacts/liquidity_pit',
      { body: doc, message: 'x' }, { requireIdentity: true });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toMatch(/KEEL_REQUIRE_IDENTITY/);

    // Reads are untouched — the mode governs writes, not the surface.
    const read = await as(null, 'GET', '/api/artifacts', undefined, { requireIdentity: true });
    expect(read.status).toBe(200);

    // And an asserted identity goes through.
    const ok = await as('alice', 'PUT', '/api/artifacts/liquidity_pit',
      { body: `${doc}\n# note`, message: 'x' }, { requireIdentity: true });
    expect(ok.status).toBe(200);
  });

  it('a second person clears an acknowledged weakening for release; the author cannot', async () => {
    // alice saves an acknowledged weakening — the flag is the structural record.
    const doc = await body('fr2052a_variance');
    const saved = await as('alice', 'PUT', '/api/artifacts/fr2052a_variance', {
      body: doc.replace('limit: 1000000', 'limit: 5000000'),
      message: 'loosen', acknowledgeReview: true,
    });
    expect(saved.status).toBe(200);
    const revision = (saved.body as { revision: number }).revision;

    // The cut refuses, naming whose review is missing.
    const refused = await as('alice', 'POST', '/api/releases', { message: 'ship' });
    expect(refused.status).toBe(400);
    expect((refused.body as { error: string }).error).toMatch(/second person/);
    expect((refused.body as { error: string }).error).toContain('fr2052a_variance');

    // A review is an attribution act: no identity, no review.
    const anonymous = await as(null, 'POST', '/api/artifacts/fr2052a_variance/review', { revision });
    expect(anonymous.status).toBe(403);

    // The author's own second signature is refused — the second name is the control.
    const self = await as('alice', 'POST', '/api/artifacts/fr2052a_variance/review', { revision });
    expect(self.status).toBe(403);
    expect((self.body as { error: string }).error).toMatch(/cannot\s+second-review/);

    // bob's review clears it, and the cut goes through.
    const review = await as('bob', 'POST', '/api/artifacts/fr2052a_variance/review',
      { revision, note: 'checked the ALCO minute' });
    expect(review.status).toBe(201);
    const cut = await as('alice', 'POST', '/api/releases', { message: 'ship' });
    expect(cut.status).toBe(201);
  });

  it('the cutter cannot be the only name on deploying a tier-1 release', async () => {
    const cutRes = await as('alice', 'POST', '/api/releases', { message: 'first' });
    expect(cutRes.status).toBe(201);
    const version = (cutRes.body as { version: number }).version;

    // alice cut it; alice alone may not deploy it — the workspace carries
    // tier-1 artifacts.
    const solo = await as('alice', 'PUT', `/api/channels/staging`, { version, message: 'go' });
    expect(solo.status).toBe(400);
    expect((solo.body as { error: string }).error).toMatch(/only name/);

    // bob signing his own... no — bob is not the cutter, so bob promoting is
    // itself the second name.
    const byBob = await as('bob', 'PUT', `/api/channels/staging`, { version, message: 'go' });
    expect(byBob.status).toBe(200);

    // Alternatively: bob signs the release, after which alice may promote it.
    const cut2 = await as('alice', 'POST', '/api/releases', { message: 'second' });
    const v2 = (cut2.body as { version: number }).version;
    const sign = await as('bob', 'POST', `/api/releases/${v2}/review`, { note: 'looks right' });
    expect(sign.status).toBe(201);
    const byAlice = await as('alice', 'PUT', `/api/channels/uat`,
      { version: v2, message: 'go', acknowledgeReview: true });
    expect(byAlice.status).toBe(200);

    // And the cutter signing their own release changes nothing.
    const selfSign = await as('alice', 'POST', `/api/releases/${v2}/review`, {});
    expect(selfSign.status).toBe(403);
  });

  it('reviews name exactly what they reviewed', async () => {
    const missing = await as('bob', 'POST', '/api/artifacts/liquidity_pit/review', { revision: 99 });
    expect(missing.status).toBe(404);
    const noRevision = await as('bob', 'POST', '/api/artifacts/liquidity_pit/review', {});
    expect(noRevision.status).toBe(400);
    const noRelease = await as('bob', 'POST', '/api/releases/99/review', {});
    expect(noRelease.status).toBe(404);
  });
});
