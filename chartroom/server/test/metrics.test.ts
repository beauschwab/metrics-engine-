/**
 * Pilot instrumentation (E2.5): the metrics the spec says to watch during the
 * pilot — brief acceptance, edits per dashboard, lint-fix acceptance —
 * derived from the audit stream and the core tables, never stored (ADR-32).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DashboardSpec } from 'chartroom-spec';
import { migrate, openSqlite, type Db } from '../../../server/db';
import { CatalogCache, ContractCache, handle, type ApiDeps } from '../src/api';
import { chartroomDialect } from '../src/dialect';
import { fetchRegistryState } from '../src/keel';
import { QueryService } from '../src/query';
import { ChartroomRepository } from '../src/repository';
import { seedCatalog } from '../src/seed';

let db: Db;
let deps: ApiDeps;
let ref: (m: string) => string;

const api = (over: Partial<Parameters<typeof handle>[0]>) =>
  handle({ method: 'GET', path: '/', ...over }, deps);

beforeAll(async () => {
  db = await openSqlite(':memory:', chartroomDialect('sqlite'));
  await migrate(db);
  const state = await fetchRegistryState();
  const rev = state.docs.find((d) => d.name === 'liquidity_pit')!.revision;
  ref = (m: string) => `keel://liquidity_pit.${m}@${rev}`;
  const repo = new ChartroomRepository(db);
  // The catalogs live in the table now (E10.1); without the seed the linter
  // would have no widget contracts and REF-01 would block every fixture.
  await seedCatalog(repo);
  deps = {
    repo,
    contracts: new ContractCache(60_000),
    queries: new QueryService({ state }),
    catalog: new CatalogCache(repo),
  };
});

afterAll(async () => {
  await db.close();
});

const BRIEF = {
  intake: {
    decision: 'Decide whether to escalate to ALCO before an LCR floor breach',
    audience: 'treasury-committee',
    cadence: 'eod',
    grain_entities: 'legal entity, consolidated group',
    comparisons: 'against the regulatory floor and prior day',
    thresholds: 'the 100% LCR minimum; the governed stress haircut',
    sharing_scope: 'team',
    existing_overlap: 'lcr-monitor shows the ratio without committee framing',
  },
  pattern: { none: { justification: 'a metrics test dashboard' } },
  bindings: [{ widget_slot: 'tile', metric: '', dims: [] }],
  gaps: [],
  wireframe: '[KPI][KPI]\n[ trend  ]',
  excluded: [],
};

const spec = (): DashboardSpec => ({
  chartroom: '0.1',
  dashboard: {
    id: 'measured', title: 'Measured', pattern: { none: { justification: 'a metrics test dashboard' } },
    audience: 'alm-analyst', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [{
    id: 'tile', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
    bind: { metric: ref('lcr_pct'), compare: { vs: 'prior_period', style: 'delta' } },
  }],
  interactions: [],
});

describe('the event route', () => {
  it('refuses an unknown kind and an anonymous caller', async () => {
    const anon = await api({ method: 'POST', path: '/api/events', body: { kind: 'fix.apply', artifact_id: 'NUM-01' } });
    expect(anon.status).toBe(401);
    const weird = await api({
      method: 'POST', path: '/api/events', identity: 'beau',
      body: { kind: 'telemetry.slurp', artifact_id: 'x' },
    });
    expect(weird.status).toBe(400);
  });

  it('records fix applications into the audit stream', async () => {
    for (const rule of ['NUM-01', 'NUM-01', 'BAR-02']) {
      const r = await api({
        method: 'POST', path: '/api/events', identity: 'beau',
        body: { kind: 'fix.apply', artifact_id: rule },
      });
      expect(r.status).toBe(201);
    }
  });
});

describe('the pilot metrics', () => {
  it('derives brief acceptance, edits per dashboard, and fix acceptance', async () => {
    // One dashboard through the whole loop: brief filed, approved, two saves.
    await api({ method: 'POST', path: '/api/dashboards', identity: 'beau', body: { id: 'measured', title: 'Measured' } });
    const brief = structuredClone(BRIEF);
    brief.bindings[0].metric = ref('lcr_pct');
    await api({
      method: 'POST', path: '/api/dashboards/measured/brief', identity: 'beau',
      body: { brief: { dashboard_id: 'measured', ...brief } },
    });
    await api({ method: 'POST', path: '/api/dashboards/measured/brief/approve', identity: 'beau' });
    const s = spec();
    const first = await api({
      method: 'POST', path: '/api/dashboards/measured/versions', identity: 'beau',
      body: { spec: s, expectedVersion: null },
    });
    expect(first.status).toBe(201);
    s.widgets[0].title = 'LCR';
    await api({
      method: 'POST', path: '/api/dashboards/measured/versions', identity: 'beau',
      body: { spec: s, expectedVersion: 1 },
    });

    const r = await api({ method: 'GET', path: '/api/metrics' });
    expect(r.status).toBe(200);
    const m = r.body as {
      briefs: { filed: number; approved: number; acceptanceRate: number; medianMinutesToApproval: number };
      edits: { dashboards: number; versions: number; versionsPerDashboard: number };
      fixes: { applied: number; byRule: Record<string, number> };
      dashboardsByStatus: Record<string, number>;
    };
    expect(m.briefs.filed).toBe(1);
    expect(m.briefs.approved).toBe(1);
    expect(m.briefs.acceptanceRate).toBe(1);
    expect(m.briefs.medianMinutesToApproval).toBeGreaterThanOrEqual(0);
    expect(m.edits).toMatchObject({ dashboards: 1, versions: 2, versionsPerDashboard: 2 });
    expect(m.fixes.applied).toBe(3);
    expect(m.fixes.byRule).toEqual({ 'NUM-01': 2, 'BAR-02': 1 });
    expect(m.dashboardsByStatus.draft).toBe(1);
  });
});
