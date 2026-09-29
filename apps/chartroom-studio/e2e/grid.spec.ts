/**
 * The treasury grid harness (#/grid): Phase 1's done-when, executed against
 * the real bundle — fifty thousand positions behind the data seam, a
 * windowed body, every cell formatted from its column's meta.
 */

import { expect, test } from '@playwright/test';

test.describe('the treasury grid harness', () => {
  test('serves the seeded book through the seam and windows the body', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    await expect(grid).toBeVisible();

    // The header's count comes from `describe()`, not from the harness.
    await expect(page.getByTestId('grid-harness-title')).toHaveText(/50,000 positions as of 2026-09-28/);

    // Headers come from meta labels, in the declared order.
    const headers = grid.locator('thead th');
    await expect(headers.first()).toHaveText('Desk');
    await expect(headers.nth(9)).toHaveText('Notional');
    await expect(headers.nth(13)).toHaveText('Yield');

    // Fifty thousand rows in the model, a window of them in the DOM.
    const bodyRows = grid.locator('tbody tr');
    await expect(bodyRows.first()).toBeVisible();
    const drawn = await bodyRows.count();
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThan(200);
    const bodyHeight = await grid.locator('tbody').evaluate((el) => el.getBoundingClientRect().height);
    expect(bodyHeight).toBeGreaterThan(50_000 * 20);

    // Measures read as their units say: $M for notional, a percent for yield,
    // years for WAL, right-aligned tabular figures throughout.
    const first = bodyRows.first();
    await expect(first.locator('td[data-column="tradeId"]')).toHaveText('T000001');
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^-?\$[\d,]+\.\dM$/);
    await expect(first.locator('td[data-column="yield"]')).toHaveText(/^\d+\.\d\d%$/);
    await expect(first.locator('td[data-column="wal"]')).toHaveText(/^\d+\.\d\dy$/);
    await expect(first.locator('td[data-column="dv01"]')).toHaveAttribute('data-align', 'right');
    await expect(first.locator('td[data-column="desk"]')).toHaveAttribute('data-align', 'left');

    // A negative MTM is flagged for the breach colour — the theme's breach
    // text token read through `negativeRed`, not a hardcoded red (ADR-65).
    const negative = grid.locator('td[data-column="mtm"] [data-slot="value"][data-negative]');
    await expect(negative.first()).toBeVisible();
    await expect(negative.first()).toHaveText(/^-\$/);

    // Scrolling to the end reaches the last trade, and the header stays put.
    const container = page.locator('[data-slot="table-container"]');
    await container.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(grid.locator('td[data-column="tradeId"]', { hasText: 'T050000' })).toBeVisible();
    await expect(headers.first()).toBeInViewport();
  });
});
