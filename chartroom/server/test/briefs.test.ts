/**
 * The Phase-2 acceptance tests, stated as the spec states them:
 * the grilling protocol is enforced in `create_brief`'s validation, not merely
 * prompted; composition tool calls are rejected pre-approval; and an agent
 * session cannot approve anything, whatever headers it sends.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Brief, DashboardSpec } from 'chartroom-spec';
import { migrate, openSqlite, type Db } from '../../../server/db';
import { ContractCache, handle, type ApiDeps } from '../src/api';
import { chartroomDialect } from '../src/dialect';
import { fetchRegistryState } from '../src/keel';
import { QueryService } from '../src/query';
import { ChartroomRepository } from '../src/repository';

let db: Db;
let deps: ApiDeps;
let ref: (m: string) => string;

const AGENT = 'agent:mcp-test-session';
const HUMAN = 'beau';

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
  await handle({
    method: 'POST', path: '/api/dashboards',
    body: { id: 'briefed', title: 'A briefed board' }, identity: HUMAN,
  }, deps);
});

afterAll(async () => db.close());

const goodBrief = (): Brief => ({
  dashboard_id: 'briefed',
  intake: {
    decision: 'Decide whether to escalate to ALCO before an LCR floor breach',
    audience: 'treasury-committee',
    cadence: 'eod',
    grain_entities: 'legal entity, consolidated group',
    comparisons: 'against the regulatory floor and prior day',
    thresholds: 'the 100% LCR minimum; the governed stress haircut',
    sharing_scope: 'team',
    existing_overlap: 'the seeded lcr-monitor shows the ratio but not committee framing',
  },
  pattern: { ref: 'limit-utilization-board@1', deviations: ['no breach table in v1'] },
  bindings: [
    { widget_slot: 'utilization-tiles', metric: ref('lcr_pct') as never, dims: [] },
  ],
  gaps: [],
  wireframe: '[KPI][KPI]\n[ trend  ]',
  excluded: [{ what: 'desk P&L', why: 'a different decision; the guide says one decision per board' }],
});

const spec = (): DashboardSpec => ({
  chartroom: '0.1',
  dashboard: {
    id: 'briefed', title: 'A briefed board',
    pattern: 'limit-utilization-board@1',
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

describe('the grilling protocol is a schema, not a suggestion', () => {
  it('rejects a brief missing an intake slot, naming the slot', async () => {
    const b = goodBrief();
    (b.intake as Record<string, unknown>).decision = 'monitoring';
    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/brief', body: { brief: b }, identity: AGENT,
    }, deps);
    expect(r.status).toBe(422);
    expect((r.body as { problems: string[] }).problems.join(' ')).toContain('intake.decision');
  });

  it('rejects "no pattern" without a written justification', async () => {
    const b = goodBrief();
    (b as Record<string, unknown>).pattern = { none: { justification: 'meh' } };
    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/brief', body: { brief: b }, identity: AGENT,
    }, deps);
    expect(r.status).toBe(422);
  });

  it('accepts a complete brief, as a draft', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/brief', body: { brief: goodBrief() }, identity: AGENT,
    }, deps);
    expect(r.status).toBe(201);
    expect((r.body as { brief: { status: string; version: number } }).brief.status).toBe('draft');
  });
});

describe('composition waits for a human', () => {
  it('an agent save is rejected while the brief is a draft', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/versions',
      body: { spec: spec(), expectedVersion: null }, identity: AGENT,
    }, deps);
    expect(r.status).toBe(403);
    expect((r.body as { error: string }).error).toContain('human approval');
  });

  it('an agent session cannot approve — the entitlement holds at the boundary', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/brief/approve', body: {}, identity: AGENT,
    }, deps);
    expect(r.status).toBe(403);
    expect((r.body as { error: string }).error).toContain('cannot approve');
  });

  it('a human approves; the approval is stamped and audited', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/brief/approve', body: {}, identity: HUMAN,
    }, deps);
    expect(r.status).toBe(200);
    const { brief } = r.body as { brief: { status: string; approvedBy: string } };
    expect(brief.status).toBe('approved');
    expect(brief.approvedBy).toBe(HUMAN);

    const audit = await handle({ method: 'GET', path: '/api/dashboards/briefed/audit' }, deps);
    const actions = (audit.body as { audit: Array<{ action: string; actor: string }> }).audit;
    expect(actions.some((a) => a.action === 'brief.approve' && a.actor === HUMAN)).toBe(true);
  });

  it('after approval, the same agent save goes through', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/versions',
      body: { spec: spec(), expectedVersion: null }, identity: AGENT,
    }, deps);
    expect(r.status).toBe(201);
  });

  it('editing the brief supersedes the approval — composition locks again', async () => {
    const edited = goodBrief();
    edited.intake.decision = 'A different decision entirely, which nobody has approved yet';
    const saved = await handle({
      method: 'POST', path: '/api/dashboards/briefed/brief', body: { brief: edited }, identity: AGENT,
    }, deps);
    expect((saved.body as { brief: { status: string; version: number } }).brief.status).toBe('draft');
    expect((saved.body as { brief: { version: number } }).brief.version).toBe(2);

    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/versions',
      body: { spec: spec(), expectedVersion: 1 }, identity: AGENT,
    }, deps);
    expect(r.status).toBe(403);
  });

  it('humans compose freely — they are the approvers, not the gated', async () => {
    const r = await handle({
      method: 'POST', path: '/api/dashboards/briefed/versions',
      body: { spec: spec(), expectedVersion: 1 }, identity: HUMAN,
    }, deps);
    expect(r.status).toBe(201);
  });
});
