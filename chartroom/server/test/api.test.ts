/**
 * The API at the level it is written — no port, no socket.
 *
 * The audit assertions here are the non-optional ones: every mutation leaves a
 * row saying who did it. A route added without that fails the last test, which
 * is the point of the last test.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DashboardSpec } from 'chartroom-spec';
import { migrate, openSqlite, type Db } from '../../../server/db';
import { ContractCache, handle, type ApiDeps } from '../src/api';
import { chartroomDialect } from '../src/dialect';
import { fetchRegistryState } from '../src/keel';
import { QueryService } from '../src/query';
import { ChartroomRepository } from '../src/repository';

let db: Db;
let deps: ApiDeps;
let ref: (m: string) => string;

beforeAll(async () => {
  db = await openSqlite(':memory:', chartroomDialect('sqlite'));
  await migrate(db);
  const state = await fetchRegistryState();
  const rev = state.docs.find((d) => d.name === 'liquidity_pit')!.revision;
  ref = (m: string) => `keel://liquidity_pit.${m}@${rev}`;
  deps = {
    repo: new ChartroomRepository(db),
    contracts: new ContractCache(60_000),
    queries: new QueryService({ state }),
  };
});

afterAll(async () => {
  await db.close();
});

const spec = (over: Partial<DashboardSpec['dashboard']> = {}): DashboardSpec => ({
  chartroom: '0.1',
  dashboard: {
    id: 'board', title: 'A board', pattern: { none: { justification: 'a test dashboard' } },
    audience: 'alm-analyst', cadence: 'eod', status: 'draft', ...over,
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [{
    id: 'tile', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
    bind: { metric: ref('lcr_pct'), compare: { vs: 'prior_period', style: 'delta' } },
  }],
  interactions: [],
});

describe('catalog', () => {
  it('serves contracts, truncated for listing and full by ref', async () => {
    const list = await handle({ method: 'GET', path: '/api/contracts' }, deps);
    expect(list.status).toBe(200);
    const { contracts } = list.body as { contracts: Array<{ ref: string; dims: unknown[] }> };
    expect(contracts.length).toBeGreaterThan(10);

    const one = await handle(
      { method: 'GET', path: `/api/contracts/${encodeURIComponent(ref('lcr_pct'))}` }, deps,
    );
    expect(one.status).toBe(200);
    const { contract } = one.body as { contract: { denominator_of: string } };
    expect(contract.denominator_of).toBe('net_cash_outflows_30d');
  });

  it('serves the widget catalog', async () => {
    const r = await handle({ method: 'GET', path: '/api/widgets' }, deps);
    const { widgets } = r.body as { widgets: Array<{ widget: string }> };
    expect(widgets.map((w) => w.widget)).toContain('perspective-grid');
  });
});

describe('queries over HTTP', () => {
  it('answers a scalar', async () => {
    const r = await handle(
      { method: 'POST', path: '/api/query', body: { metric: ref('lcr_pct') } }, deps,
    );
    expect(r.status).toBe(200);
    expect((r.body as { kind: string }).kind).toBe('scalar');
  });

  it('maps refusals to statuses a client can act on', async () => {
    const missing = await handle(
      { method: 'POST', path: '/api/query', body: { metric: 'keel://liquidity_pit.ghost@1' } }, deps,
    );
    expect(missing.status).toBe(404);
  });
});

describe('the dashboard lifecycle', () => {
  it('creates, saves versions with server-side lint, and reads back', async () => {
    const created = await handle({
      method: 'POST', path: '/api/dashboards',
      body: { id: 'board', title: 'A board' }, identity: 'beau',
    }, deps);
    expect(created.status).toBe(201);

    const saved = await handle({
      method: 'POST', path: '/api/dashboards/board/versions',
      body: { spec: spec(), expectedVersion: null }, identity: 'beau',
    }, deps);
    expect(saved.status).toBe(201);
    const savedBody = saved.body as { version: number; lintReport: { counts: { block: number } } };
    expect(savedBody.version).toBe(1);
    expect(savedBody.lintReport.counts.block).toBe(0);

    const read = await handle({ method: 'GET', path: '/api/dashboards/board' }, deps);
    const readBody = read.body as { latest: { version: number; author: string } };
    expect(readBody.latest.version).toBe(1);
    expect(readBody.latest.author).toBe('beau');
  });

  it('refuses a schema-invalid spec with the problems named', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/board/versions',
      body: { spec: { chartroom: '0.1', html: '<div>' } }, identity: 'beau',
    }, deps);
    expect(r.status).toBe(422);
    expect((r.body as { problems: string[] }).problems.length).toBeGreaterThan(0);
  });

  it('allows lint BLOCKs at draft and records them with the version', async () => {
    const s = spec();
    s.widgets[0].bind.metric = 'keel://liquidity_pit.no_such@1'; // REF-01 BLOCK
    const r = await handle({
      method: 'POST', path: '/api/dashboards/board/versions',
      body: { spec: s, expectedVersion: 1 }, identity: 'beau',
    }, deps);
    expect(r.status).toBe(201);
    expect((r.body as { lintReport: { counts: { block: number } } }).lintReport.counts.block)
      .toBeGreaterThan(0);
  });

  it('enforces optimistic concurrency', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/board/versions',
      body: { spec: spec(), expectedVersion: 1 }, identity: 'someone-else',
    }, deps);
    expect(r.status).toBe(409);
  });

  it('a save cannot change status — that is the promotion path’s job', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/board/versions',
      body: { spec: spec({ status: 'team' }), expectedVersion: 2 }, identity: 'beau',
    }, deps);
    expect(r.status).toBe(422);
    expect((r.body as { error: string }).error).toContain('cannot change status');
  });

  it('a non-draft dashboard refuses BLOCKs server-side — never trust the studio', async () => {
    // No promotion endpoint exists yet (Phase 3); stand a team dashboard up
    // directly to prove the stored gate holds regardless of who sets status.
    await db.run(
      'INSERT INTO chartroom_dashboard (id, title, status, owner, created_at) VALUES (?, ?, ?, ?, ?)',
      ['team-board', 'Team board', 'team', 'beau', new Date().toISOString()],
    );
    const bad = spec({ id: 'team-board', status: 'team' });
    bad.widgets[0].bind.metric = 'keel://liquidity_pit.no_such@1';
    const r = await handle({
      method: 'POST', path: '/api/dashboards/team-board/versions',
      body: { spec: bad, expectedVersion: null }, identity: 'beau',
    }, deps);
    expect(r.status).toBe(422);
    expect((r.body as { error: string }).error).toContain('BLOCK');
  });

  it('diffs two versions in reviewer vocabulary', async () => {
    const r = await handle({
      method: 'GET', path: '/api/dashboards/board/diff', query: { a: '1', b: '2' },
    }, deps);
    expect(r.status).toBe(200);
    const { diff } = r.body as { diff: { rebound: Array<{ id: string }> } };
    expect(diff.rebound.map((x) => x.id)).toContain('tile');
  });

  it('every mutation left an audit row with the actor', async () => {
    const r = await handle({ method: 'GET', path: '/api/dashboards/board/audit' }, deps);
    const { audit } = r.body as {
      audit: Array<{ action: string; actor: string }>;
    };
    const actions = audit.map((a) => a.action);
    expect(actions).toContain('dashboard.create');
    // Exactly the saves that succeeded (v1, v2) — refused saves audit nothing,
    // because nothing changed.
    expect(actions.filter((a) => a === 'dashboard.save')).toHaveLength(2);
    expect(audit.every((a) => a.actor.length > 0)).toBe(true);
  });
});
