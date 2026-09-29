/**
 * The treasury grid harness (#/grid): Phase 0's done-when, executed against
 * the real bundle — a table of seeded positions with every cell formatted
 * from its column's meta.
 */

import { expect, test } from '@playwright/test';

test.describe('the treasury grid harness', () => {
  test('renders the seeded book with cells formatted from column meta', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    await expect(grid).toBeVisible();

    // Headers come from meta labels, in the declared order.
    const headers = grid.locator('thead th');
    await expect(headers.first()).toHaveText('Desk');
    await expect(headers.nth(9)).toHaveText('Notional');
    await expect(headers.nth(13)).toHaveText('Yield');

    // 200 seeded rows, every one drawn.
    await expect(grid.locator('tbody tr')).toHaveCount(200);

    // Measures read as their units say: $M for notional, a percent for yield,
    // years for WAL, right-aligned tabular figures throughout.
    const first = grid.locator('tbody tr').first();
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^-?\$[\d,]+\.\dM$/);
    await expect(first.locator('td[data-column="yield"]')).toHaveText(/^\d+\.\d\d%$/);
    await expect(first.locator('td[data-column="wal"]')).toHaveText(/^\d+\.\d\dy$/);
    await expect(first.locator('td[data-column="dv01"]')).toHaveAttribute('data-align', 'right');
    await expect(first.locator('td[data-column="desk"]')).toHaveAttribute('data-align', 'left');

    // A negative MTM is flagged for the breach colour — the stylesheet's
    // reading of `negativeRed`, not a hardcoded red.
    const negative = grid.locator('td[data-column="mtm"] .cr-grid-value[data-negative]');
    await expect(negative.first()).toBeVisible();
    await expect(negative.first()).toHaveText(/^-\$/);
  });
});
