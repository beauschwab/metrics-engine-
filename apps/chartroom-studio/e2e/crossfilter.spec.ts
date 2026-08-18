/**
 * Cross-filtering, spec-interpreted (Phase 4): a widget is clickable only
 * because `spec.interactions` names it a source, a click narrows exactly the
 * declared targets, the active filter is a visible chip, and clearing it
 * restores the numbers. The declared-wiring half is IX-01's (lint tests); this
 * proves the interpreter obeys the declaration.
 */

import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8788';
const HUMAN = { 'content-type': 'application/json', 'x-identity': 'studio-author' };

const SPEC = {
  chartroom: '0.1',
  dashboard: {
    id: 'wired-board', title: 'Wired board',
    pattern: { none: { justification: 'cross-filter interpreter e2e fixture' } },
    audience: 'alm-analyst', cadence: 'eod', status: 'draft',
  },
  context: {},
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [
    {
      id: 'hqla-tile', type: 'kpi-tile@1', pos: { x: 0, y: 0, w: 3, h: 2 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@1' },
    },
    {
      id: 'by-entity', type: 'bar@1', pos: { x: 3, y: 0, w: 9, h: 4 },
      bind: { metric: 'keel://liquidity_pit.hqla_total@1', dims: ['entity_id'] },
    },
  ],
  interactions: [
    { cross_filter: { source: 'by-entity', dim: 'entity_id', targets: ['hqla-tile'] } },
  ],
};

test('click narrows the target, the chip says so, clear restores', async ({ page, request }) => {
  await request.post(`${API}/api/dashboards`, {
    headers: HUMAN, data: { id: 'wired-board', title: 'Wired board' },
  });
  const saved = await request.post(`${API}/api/dashboards/wired-board/versions`, {
    headers: HUMAN, data: { spec: SPEC, expectedVersion: null },
  });
  expect([200, 201]).toContain(saved.status());

  await page.goto('/');
  await page.getByTestId('dash-wired-board').click();

  const tile = page.getByTestId('widget-hqla-tile');
  await expect(tile).toHaveAttribute('data-status', 'fresh');
  const total = await tile.locator('.cr-kpi-value').textContent();

  // The bar is a declared source, so its rows are pickable.
  await page.getByTestId('pick-BANK_US').click();

  // The filter is visible state, not ambient state.
  await expect(page.getByTestId('crossfilter-chip')).toContainText('entity_id = BANK_US');
  await expect(page.getByTestId('filtered-hqla-tile')).toBeVisible();

  // And it actually narrowed: one entity's HQLA is not the group's.
  await expect(tile).toHaveAttribute('data-status', 'fresh');
  await expect(tile.locator('.cr-kpi-value')).not.toHaveText(total!);

  // The source itself is not a target — its bars did not change meaning.
  await expect(page.getByTestId('widget-by-entity').locator('[data-picked]')).toHaveCount(1);

  // Clear restores the unfiltered number.
  await page.getByTestId('crossfilter-clear').click();
  await expect(page.getByTestId('crossfilter-chip')).toHaveCount(0);
  await expect(tile.locator('.cr-kpi-value')).toHaveText(total!);

  // And the header offers the committee pack for the saved version.
  await expect(page.getByTestId('export-deck')).toBeVisible();
});

test('the committee pack downloads as a real PPTX', async ({ request }) => {
  const deck = await request.get(`${API}/api/dashboards/wired-board/deck.pptx`);
  expect(deck.status()).toBe(200);
  expect(deck.headers()['content-type']).toContain('presentationml');
  const body = await deck.body();
  expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(body.length).toBeGreaterThan(10_000);
});
