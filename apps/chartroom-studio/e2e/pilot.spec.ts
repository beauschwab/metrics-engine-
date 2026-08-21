/**
 * Phase 5 pilot readiness in the browser: the data critic runs on demand from
 * the Findings tab and reports on the real numbers, and the pilot metrics
 * endpoint serves the E2.5 instrumentation.
 */

import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8788';

test('the data critic runs from the findings tab and the dogfood numbers hold', async ({ page }) => {
  await page.goto('/#/author');
  await page.getByTestId('dash-lcr-monitor').click();
  await page.getByTestId('tab-findings').click();

  await page.getByTestId('run-data-critic').click();
  // The dogfood dashboard's numbers reconcile — the clean message is the
  // critic's actual verdict, not a default.
  await expect(page.getByTestId('data-critic-clean')).toBeVisible({ timeout: 15_000 });
});

test('the pilot metrics derive from what the session actually did', async ({ request }) => {
  const r = await request.get(`${API}/api/metrics`);
  expect(r.status()).toBe(200);
  const m = await r.json() as {
    briefs: { filed: number };
    edits: { dashboards: number; versions: number };
    fixes: { applied: number; byRule: Record<string, number> };
    dashboardsByStatus: Record<string, number>;
  };
  // The seed plus whatever earlier specs created — at least the two dogfood
  // dashboards with one version each.
  expect(m.edits.dashboards).toBeGreaterThanOrEqual(2);
  expect(m.edits.versions).toBeGreaterThanOrEqual(m.edits.dashboards);
  expect(m.dashboardsByStatus.draft).toBeGreaterThanOrEqual(2);
  expect(typeof m.fixes.applied).toBe('number');
});
