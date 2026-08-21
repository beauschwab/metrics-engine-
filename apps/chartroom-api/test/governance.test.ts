/**
 * Phase 3, at the API level: the proposal loop with a real KEEL registry
 * process behind it (approval writes the document there — the workflow's one
 * meaningful side effect must be real in the test), the promotion gate
 * matrix, and upgrade notices carrying real impact findings.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Brief, DashboardSpec } from 'chartroom-spec';
import { migrate, openSqlite, type Db } from 'keel-registry/db';
import { CatalogCache, ContractCache, handle, type ApiDeps } from '../src/api';
import { chartroomDialect } from '../src/dialect';
import { fetchRegistryState } from '../src/keel';
import { QueryService } from '../src/query';
import { ChartroomRepository } from '../src/repository';
import { seedCatalog } from '../src/seed';

const dir = mkdtempSync(join(tmpdir(), 'chartroom-gov-'));
const KEEL_PORT = 8600 + (process.pid % 90);

let keelProc: ChildProcess;
let db: Db;
let deps: ApiDeps;
let ref: (m: string) => string;

const AGENT = 'agent:mcp-gov-test';
const HUMAN = 'beau';
const STEWARD = 'metric-steward';

const api = (over: Partial<Parameters<typeof handle>[0]>) =>
  handle({ method: 'GET', path: '/', ...over }, deps);

beforeAll(async () => {
  // A real registry, because proposal approval writes into it.
  keelProc = spawn('npx', ['tsx', 'packages/registry/index.ts'], {
    cwd: join(__dirname, '..', '..', '..'),
    env: {
      ...process.env,
      KEEL_PORT: String(KEEL_PORT),
      KEEL_SQLITE_FILE: join(dir, 'keel.db'),
    },
    stdio: 'ignore',
  });
  process.env.KEEL_API = `http://127.0.0.1:${KEEL_PORT}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${process.env.KEEL_API}/api/health`);
      if (r.ok) break;
    } catch { /* booting */ }
    await new Promise((res) => setTimeout(res, 500));
  }

  db = await openSqlite(':memory:', chartroomDialect('sqlite'));
  await migrate(db);
  const state = await fetchRegistryState();
  expect(state.source).toBe('registry'); // the test is meaningless offline
  const rev = state.docs.find((d) => d.name === 'liquidity_pit')!.revision;
  ref = (m: string) => `keel://liquidity_pit.${m}@${rev}`;
  const repo = new ChartroomRepository(db);
  // The catalogs live in the table now (E10.1); without the seed the linter
  // would have no widget contracts and REF-01 would block every fixture.
  await seedCatalog(repo);
  deps = {
    repo,
    contracts: new ContractCache(1_000),
    queries: new QueryService({ state }),
    catalog: new CatalogCache(repo),
  };
}, 120_000);

afterAll(async () => {
  await db?.close();
  keelProc?.kill();
  delete process.env.KEEL_API;
  rmSync(dir, { recursive: true, force: true });
});

// A small but real metrics view: reads the same source, one simple measure
// and one governed ratio, in the registry's own YAML idiom.
const PROPOSED_YAML = `name: intraday_buffer
kind: metrics_view
display_name: Intraday buffer coverage
owner: Liquidity Regulatory Reporting
source: alm.fct_liquidity_position

measures:
  - name: unencumbered_hqla
    description: Eligible HQLA excluding encumbered positions.
    type: simple
    agg: sum
    field: hqla_eligible_amount
    where: is_encumbered = false
    format: currency_usd

  - name: buffer_coverage_pct
    description: Unencumbered HQLA over 30-day outflows.
    type: derived
    requires: [unencumbered_hqla, outflows_30d]
    expression: >
      100.0 * unencumbered_hqla / nullif(outflows_30d, 0)
    format: percent_1dp

  - name: outflows_30d
    type: simple
    agg: sum
    field: outflow_amount_30d
    format: currency_usd
`;

describe('the proposal loop (E3.1)', () => {
  it('drafting validates through the real engine and stores the evidence', async () => {
    const r = await api({
      method: 'POST', path: '/api/proposals', identity: AGENT,
      body: { id: 'intraday-buffer', yaml: PROPOSED_YAML, rationale: 'Intake surfaced an intraday buffer gap no registry function covers.' },
    });
    expect(r.status).toBe(201);
    const { proposal, blockers } = r.body as {
      proposal: { status: string; docName: string; evidence: { measures: Array<{ finite: boolean }>; semantic: { ok: boolean } } };
      blockers: string[];
    };
    expect(proposal.status).toBe('draft');
    expect(proposal.docName).toBe('intraday_buffer');
    expect(blockers).toEqual([]);
    expect(proposal.evidence.measures).toHaveLength(3);
    expect(proposal.evidence.measures.every((m) => m.finite)).toBe(true);
    expect(proposal.evidence.semantic.ok).toBe(true);
  });

  it('a broken document drafts, but cannot be submitted — with the blockers named', async () => {
    const bad = PROPOSED_YAML.replace('field: hqla_eligible_amount', 'field: no_such_column');
    await api({
      method: 'POST', path: '/api/proposals', identity: AGENT,
      body: { id: 'broken-proposal', yaml: bad, rationale: 'Deliberately broken for the submission gate test.' },
    });
    const r = await api({ method: 'POST', path: '/api/proposals/broken-proposal/submit', identity: AGENT });
    expect(r.status).toBe(422);
    expect((r.body as { problems: string[] }).problems.length).toBeGreaterThan(0);
  });

  it('an agent cannot decide; a steward can, and approval writes the registry', async () => {
    await api({ method: 'POST', path: '/api/proposals/intraday-buffer/submit', identity: AGENT });

    const refused = await api({
      method: 'POST', path: '/api/proposals/intraday-buffer/decide', identity: AGENT,
      body: { decision: 'approve', comment: 'I approve of myself' },
    });
    expect(refused.status).toBe(403);

    const decided = await api({
      method: 'POST', path: '/api/proposals/intraday-buffer/decide', identity: STEWARD,
      body: { decision: 'approve', comment: 'Definition, tests and lineage reviewed.' },
    });
    expect(decided.status).toBe(200);
    const { proposal } = decided.body as {
      proposal: { status: string; steward: string; evidence: { registered: { name: string; revision: number } } };
    };
    expect(proposal.status).toBe('approved');
    expect(proposal.steward).toBe(STEWARD);
    expect(proposal.evidence.registered.name).toBe('intraday_buffer');

    // The document is really in the registry, and the steward authored it.
    const doc = await fetch(`${process.env.KEEL_API}/api/artifacts/intraday_buffer`).then((x) => x.json()) as {
      name: string; body: string;
    };
    expect(doc.body).toContain('buffer_coverage_pct');

    // And the new measures become contracts on the next derivation (the
    // contract cache re-reads the registry after its 1s test TTL).
    await new Promise((res) => setTimeout(res, 1_200));
    const contracts = await api({ method: 'GET', path: '/api/contracts' });
    const refs = (contracts.body as { contracts: Array<{ ref: string }> }).contracts.map((c) => c.ref);
    expect(refs.some((x) => x.includes('intraday_buffer.buffer_coverage_pct'))).toBe(true);
  });

  it('a decided proposal is history — it cannot be revised or re-decided', async () => {
    const revise = await api({
      method: 'POST', path: '/api/proposals', identity: AGENT,
      body: { id: 'intraday-buffer', yaml: PROPOSED_YAML, rationale: 'Trying to edit an approved proposal after the fact.' },
    });
    expect(revise.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------

const brief = (dashboardId: string): Brief => ({
  dashboard_id: dashboardId,
  intake: {
    decision: 'Decide whether to escalate to ALCO before an LCR floor breach',
    audience: 'treasury-committee', cadence: 'eod',
    grain_entities: 'legal entity, consolidated group',
    comparisons: 'against the regulatory floor and prior day',
    thresholds: 'the 100% LCR minimum', sharing_scope: 'team',
    existing_overlap: 'nothing shows committee framing',
  },
  pattern: { none: { justification: 'promotion-matrix test fixture, pattern not under test' } },
  bindings: [{ widget_slot: 'hero', metric: ref('lcr_pct') as never, dims: [] }],
  gaps: [], wireframe: '[KPI][trend]', excluded: [],
});

const spec = (dashboardId: string): DashboardSpec => ({
  chartroom: '0.1',
  dashboard: {
    id: dashboardId, title: 'Promotable board',
    pattern: { none: { justification: 'promotion-matrix test fixture, pattern not under test' } },
    audience: 'treasury-committee', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [{
    id: 'tile', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
    bind: { metric: ref('lcr_pct'), compare: { vs: 'prior_period', style: 'delta' } },
  }],
  interactions: [],
});

describe('the promotion matrix (E3.2)', () => {
  it('sets the stage: a briefed, approved, saved dashboard', async () => {
    await api({ method: 'POST', path: '/api/dashboards', identity: HUMAN, body: { id: 'promotable', title: 'Promotable board' } });
    await api({ method: 'POST', path: '/api/dashboards/promotable/brief', identity: AGENT, body: { brief: brief('promotable') } });
    await api({ method: 'POST', path: '/api/dashboards/promotable/brief/approve', identity: HUMAN });
    const saved = await api({
      method: 'POST', path: '/api/dashboards/promotable/versions', identity: HUMAN,
      body: { spec: spec('promotable'), expectedVersion: null },
    });
    expect(saved.status).toBe(201);
  });

  it('GOV-02 arms at the target status: an ungoverned metric blocks team', async () => {
    // Nothing is promoted to the registry's production channel in this test
    // registry, so every contract is draft — exactly the world where a team
    // promotion must refuse.
    const r = await api({ method: 'GET', path: '/api/dashboards/promotable/promotion' });
    const checklist = r.body as { next: string; requirements: Array<{ id: string; met: boolean; detail?: string }> };
    expect(checklist.next).toBe('team');
    const lintReq = checklist.requirements.find((x) => x.id === 'lint')!;
    expect(lintReq.met).toBe(false);
    expect(lintReq.detail).toContain('GOV-02');
  });

  it('governing the metric (production promotion in the registry) clears the gate', async () => {
    // Cut and promote a release in the KEEL registry — the real governance
    // act GOV-02 is wired to.
    const release = await fetch(`${process.env.KEEL_API}/api/releases`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'governance test release', author: HUMAN }),
    }).then((x) => x.json()) as { version: number };
    const promoted = await fetch(`${process.env.KEEL_API}/api/channels/production`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: release.version, message: 'go live', acknowledgeReview: true }),
    });
    expect(promoted.status).toBe(200);

    // Contracts re-derive within the cache TTL (1s in this test).
    await new Promise((res) => setTimeout(res, 1_200));
    const r = await api({ method: 'GET', path: '/api/dashboards/promotable/promotion' });
    const lintReq = (r.body as { requirements: Array<{ id: string; met: boolean }> })
      .requirements.find((x) => x.id === 'lint')!;
    expect(lintReq.met).toBe(true);
  });

  it('still refuses without a peer approval, then promotes with one', async () => {
    const refused = await api({
      method: 'POST', path: '/api/dashboards/promotable/promote', identity: HUMAN, body: { to: 'team' },
    });
    expect(refused.status).toBe(422);
    expect((refused.body as { unmet: string[] }).unmet.join(' ')).toContain('peer');

    const agentApproval = await api({
      method: 'POST', path: '/api/dashboards/promotable/approvals', identity: AGENT,
      body: { track: 'peer', decision: 'approve', comment: 'lgtm' },
    });
    expect(agentApproval.status).toBe(403);

    await api({
      method: 'POST', path: '/api/dashboards/promotable/approvals', identity: 'colleague',
      body: { track: 'peer', decision: 'approve', comment: 'reviewed the bindings and the layout' },
    });
    const promoted = await api({
      method: 'POST', path: '/api/dashboards/promotable/promote', identity: HUMAN, body: { to: 'team' },
    });
    expect(promoted.status).toBe(200);
    const body = promoted.body as { dashboard: { status: string }; version: number };
    expect(body.dashboard.status).toBe('team');

    // The promoted version carries the status in the spec itself.
    const v = await api({ method: 'GET', path: `/api/dashboards/promotable/versions/${body.version}` });
    expect((v.body as { spec: DashboardSpec }).spec.dashboard.status).toBe('team');
  });

  it('certification needs design + data-owner sign-off and a refresh SLO, then registers the exposure', async () => {
    const early = await api({
      method: 'POST', path: '/api/dashboards/promotable/promote', identity: HUMAN,
      body: { to: 'certified', refresh_slo: 'daily by 07:00 UTC' },
    });
    expect(early.status).toBe(422);

    for (const [track, approver] of [['design', 'design-steward'], ['data-owner', 'alm-data-owner']] as const) {
      await api({
        method: 'POST', path: '/api/dashboards/promotable/approvals', identity: approver,
        body: { track, decision: 'approve', comment: `${track} review complete` },
      });
    }
    // Missing SLO still refuses.
    const noSlo = await api({
      method: 'POST', path: '/api/dashboards/promotable/promote', identity: HUMAN, body: { to: 'certified' },
    });
    expect(noSlo.status).toBe(422);
    expect((noSlo.body as { unmet: string[] }).unmet.join(' ')).toContain('SLO');

    const certified = await api({
      method: 'POST', path: '/api/dashboards/promotable/promote', identity: HUMAN,
      body: { to: 'certified', refresh_slo: 'daily by 07:00 UTC' },
    });
    expect(certified.status).toBe(200);
    const body = certified.body as { dashboard: { status: string }; exposures: Array<{ refreshSlo: string }> };
    expect(body.dashboard.status).toBe('certified');
    expect(body.exposures[0].refreshSlo).toBe('daily by 07:00 UTC');

    // The exposure write is a mutation, so it is audited (working agreement).
    const audit = await api({ method: 'GET', path: '/api/dashboards/promotable/audit' });
    const actions = (audit.body as { audit: Array<{ action: string; actor: string }> }).audit;
    const exposure = actions.find((a) => a.action === 'exposure.register');
    expect(exposure?.actor).toBe(HUMAN);

    // Terminal: no further stage.
    const beyond = await api({
      method: 'POST', path: '/api/dashboards/promotable/promote', identity: HUMAN, body: { to: 'certified' },
    });
    expect(beyond.status).toBe(422);
  });

  it('an agent cannot promote, whatever the checklist says', async () => {
    const r = await api({
      method: 'POST', path: '/api/dashboards/promotable/promote', identity: AGENT, body: { to: 'team' },
    });
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe('upgrade notifications (E3.4)', () => {
  it('a stale pin is reported with the impact findings, not just a version number', async () => {
    // The dashboard pins the revision it was authored against…
    const pinnedRev = Number(ref('lcr_pct').split('@')[1]);

    // …then the registry moves: a loosened variance threshold, the classic
    // weakening the impact assessment exists to catch.
    const current = await fetch(`${process.env.KEEL_API}/api/artifacts/liquidity_pit`).then((x) => x.json()) as {
      body: string; revision: number;
    };
    const edited = current.body.replace('* 0.834', '* 0.1');
    expect(edited).not.toBe(current.body);
    await fetch(`${process.env.KEEL_API}/api/artifacts/liquidity_pit`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: edited, author: 'someone-else', message: 'loosened multiplier' }),
    });

    // Poll past the contract cache's 1s TTL rather than sleeping a fixed
    // amount: a refresh in flight when the PUT lands can stamp pre-PUT state
    // with a fresh timestamp, and a single sleep loses that race under load.
    let upgrades: Array<{ doc: string; pinned: number; latest: number; widgets: string[]; findings: unknown[] }> = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 600));
      const r = await api({ method: 'GET', path: '/api/dashboards/promotable/upgrades' });
      expect(r.status).toBe(200);
      upgrades = (r.body as { upgrades: typeof upgrades }).upgrades;
      if (upgrades.some((u) => u.doc === 'liquidity_pit')) break;
    }
    const notice = upgrades.find((u) => u.doc === 'liquidity_pit');
    expect(notice).toBeTruthy();
    expect(notice!.pinned).toBe(pinnedRev);
    expect(notice!.latest).toBeGreaterThan(pinnedRev);
    expect(notice!.widgets).toContain('tile');
    expect(notice!.findings.length).toBeGreaterThan(0);
  });
});
