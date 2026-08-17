/**
 * The approval seam, driven from the human side: an agent session drafts a
 * brief and is refused composition; a person reads the card in the studio and
 * approves; the same agent session is now allowed through. The e2e half of
 * the server's briefs.test.ts, proving the card is actually wired to the gate.
 */

import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8788';
const AGENT = { 'content-type': 'application/json', 'x-identity': 'agent:e2e-session' };

const BRIEF = {
  dashboard_id: 'briefed-board',
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
  pattern: { ref: 'limit-utilization-board@1', deviations: ['no breach table in v1'] },
  bindings: [{ widget_slot: 'utilization-tiles', metric: 'keel://liquidity_pit.lcr_pct@1', dims: [] }],
  gaps: [],
  wireframe: '[KPI][KPI]\n[ trend  ]',
  excluded: [{ what: 'desk P&L', why: 'a different decision; one decision per board' }],
};

const SPEC = {
  chartroom: '0.1',
  dashboard: {
    id: 'briefed-board', title: 'Briefed board', pattern: 'limit-utilization-board@1',
    audience: 'treasury-committee', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [{
    id: 'tile', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
    bind: { metric: 'keel://liquidity_pit.lcr_pct@1', compare: { vs: 'prior_period', style: 'delta' } },
  }],
  interactions: [],
};

test('draft → refused composition → human approves in the card → unlocked', async ({ page, request }) => {
  // The agent's half, out of band (as chartroom-mcp would do it).
  await request.post(`${API}/api/dashboards`, {
    headers: AGENT, data: { id: 'briefed-board', title: 'Briefed board' },
  });
  const briefed = await request.post(`${API}/api/dashboards/briefed-board/brief`, {
    headers: AGENT, data: { brief: BRIEF },
  });
  expect(briefed.status()).toBe(201);

  // Composition before approval: 403, with the flow named.
  const refused = await request.post(`${API}/api/dashboards/briefed-board/versions`, {
    headers: AGENT, data: { spec: SPEC, expectedVersion: null },
  });
  expect(refused.status()).toBe(403);

  // The human half: read the card, approve.
  await page.goto('/');
  await page.getByTestId('dash-briefed-board').click();
  await page.getByTestId('tab-brief').click();

  const card = page.getByTestId('brief-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Decide whether to escalate to ALCO');
  await expect(card).toContainText('limit-utilization-board@1');
  await expect(card).toContainText('desk P&L'); // the exclusions are part of the review
  await expect(page.getByTestId('brief-status')).toHaveText('draft');

  await page.getByTestId('brief-approve').click();
  await expect(page.getByTestId('brief-status')).toHaveText('approved');
  await expect(card).toContainText('approved by');

  // The same agent session now composes.
  const allowed = await request.post(`${API}/api/dashboards/briefed-board/versions`, {
    headers: AGENT, data: { spec: SPEC, expectedVersion: null },
  });
  expect(allowed.status()).toBe(201);
});

test('a dashboard without a brief says where briefs come from', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('dash-lcr-monitor').click();
  await page.getByTestId('tab-brief').click();
  await expect(page.getByTestId('brief-missing')).toContainText('create_brief');
});
