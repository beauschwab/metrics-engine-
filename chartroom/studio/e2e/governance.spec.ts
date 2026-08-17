/**
 * Phase 3 in the studio, offline mode on purpose.
 *
 * The e2e suite runs against the shipped-documents fallback (no KEEL
 * registry process), which makes it the right place to prove the *honest*
 * halves of governance: a steward can reject with a recorded comment, an
 * approval refuses plainly when there is no registry to write into, the
 * promotion checklist arms the GOV rules at the target status, and the
 * promote button follows the gate instead of decorating it. The happy paths
 * that need a live registry are covered at the API level by
 * server/test/governance.test.ts with a real registry process.
 */

import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8788';
const AGENT = { 'content-type': 'application/json', 'x-identity': 'agent:e2e-gov' };
const HUMAN = { 'content-type': 'application/json', 'x-identity': 'studio-author' };

const YAML = (name: string) => `name: ${name}
kind: metrics_view
display_name: E2E proposed view
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
`;

const BRIEF = {
  dashboard_id: 'governed-board',
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
  pattern: { ref: 'limit-utilization-board@1', deviations: [] },
  bindings: [{ widget_slot: 'utilization-tiles', metric: 'keel://liquidity_pit.lcr_pct@1', dims: [] }],
  gaps: [],
  wireframe: '[KPI][KPI]\n[ trend  ]',
  excluded: [],
};

const SPEC = {
  chartroom: '0.1',
  dashboard: {
    id: 'governed-board', title: 'Governed board', pattern: 'limit-utilization-board@1',
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

test('the steward queue: evidence, a recorded rejection, and the honest approve refusal', async ({ page, request }) => {
  // The agent's half, out of band, as chartroom-mcp would do it.
  for (const id of ['e2e-reject-me', 'e2e-approve-me']) {
    const drafted = await request.post(`${API}/api/proposals`, {
      headers: AGENT,
      data: {
        id,
        yaml: YAML(id.replace(/-/g, '_')),
        rationale: 'Intake surfaced an unencumbered-HQLA gap no registry function covers.',
      },
    });
    expect(drafted.status()).toBe(201);
    const submitted = await request.post(`${API}/api/proposals/${id}/submit`, { headers: AGENT, data: {} });
    expect(submitted.status()).toBe(200);
  }

  await page.goto('/#/proposals');
  await expect(page.getByTestId('proposal-e2e-reject-me')).toBeVisible();

  // The evidence is the engine's, laid out for the decision.
  await page.getByTestId('proposal-e2e-reject-me').getByRole('button', { name: /e2e_reject_me/ }).click();
  await expect(page.getByTestId('evidence-e2e-reject-me')).toContainText('unencumbered_hqla =');
  await expect(page.getByTestId('evidence-e2e-reject-me')).toContainText('semantic view: compiles');

  // Rejection: a human decision with a recorded comment.
  await page.getByTestId('decide-comment-e2e-reject-me').fill('duplicates buffer_coverage_pct; comment there instead');
  await page.getByTestId('reject-e2e-reject-me').click();
  await expect(page.getByTestId('proposal-status-e2e-reject-me')).toHaveText('rejected');

  // Approval without a registry refuses plainly — the workflow will not
  // pretend its one meaningful side effect happened.
  await page.getByTestId('decide-comment-e2e-approve-me').fill('sound definition, approving');
  await page.getByTestId('approve-e2e-approve-me').click();
  await expect(page.getByTestId('decide-error')).toContainText('registry');
  await expect(page.getByTestId('proposal-status-e2e-approve-me')).toHaveText('submitted');
});

test('the promotion gate: GOV rules armed at the target status, sign-offs recorded, the button follows the gate', async ({ page, request }) => {
  // Seed: dashboard, approved brief, one saved version — the Phase-2 flow.
  await request.post(`${API}/api/dashboards`, {
    headers: AGENT, data: { id: 'governed-board', title: 'Governed board' },
  });
  await request.post(`${API}/api/dashboards/governed-board/brief`, {
    headers: AGENT, data: { brief: BRIEF },
  });
  await request.post(`${API}/api/dashboards/governed-board/brief/approve`, { headers: HUMAN, data: {} });
  const saved = await request.post(`${API}/api/dashboards/governed-board/versions`, {
    headers: AGENT, data: { spec: SPEC, expectedVersion: null },
  });
  expect(saved.status()).toBe(201);

  await page.goto('/');
  await page.getByTestId('dash-governed-board').click();
  await page.getByTestId('tab-govern').click();

  await expect(page.getByTestId('govern-status')).toHaveText('draft');
  // Met: versions and the approved brief.
  await expect(page.getByTestId('req-versions')).toHaveAttribute('data-met', 'true');
  await expect(page.getByTestId('req-brief')).toHaveAttribute('data-met', 'true');
  // Unmet, honestly: offline, no metric is production-governed, and the lint
  // runs at *team* status — the GOV rules arm exactly when the bar rises.
  await expect(page.getByTestId('req-lint')).toHaveAttribute('data-met', 'false');
  await expect(page.getByTestId('req-lint')).toContainText('GOV');

  // A peer sign-off records and the requirement flips.
  await expect(page.getByTestId('req-peer')).toHaveAttribute('data-met', 'false');
  await page.getByTestId('approve-peer').click();
  await expect(page.getByTestId('req-peer')).toHaveAttribute('data-met', 'true');
  await expect(page.getByTestId('req-peer')).toContainText('studio-author');

  // The button follows the gate: still one unmet requirement, so disabled.
  await expect(page.getByTestId('promote')).toBeDisabled();

  // And the gate is the server's, not the button's: an agent hitting the
  // route directly is refused as a matter of identity, not UI.
  const agentPromote = await request.post(`${API}/api/dashboards/governed-board/promote`, {
    headers: AGENT, data: { to: 'team' },
  });
  expect(agentPromote.status()).toBe(403);

  // Every pin is at the (only) shipped revision — no upgrade noise.
  await expect(page.getByTestId('pins-current')).toBeVisible();
});
