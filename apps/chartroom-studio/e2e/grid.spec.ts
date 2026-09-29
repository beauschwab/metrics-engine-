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

    // The grand total footer reads the whole book.
    const footer = grid.locator('tfoot [data-slot="grand-total"]');
    await expect(footer.locator('td[data-column="desk"]')).toHaveText(/Total · 50,000 rows/);
    await expect(footer.locator('td[data-column="notional"]')).toHaveText(/^\$[\d,]+\.\dM$/);
    await expect(footer.locator('td[data-column="yield"]')).toHaveText(/^\d+\.\d\d%$/);
  });

  test('groups by a dimension from the sidebar, expands a group, and ungroups from the chip', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    await expect(grid.locator('tbody tr').first()).toBeVisible();

    // Only a groupable dimension offers the group button; the trade id does not.
    const sidebar = page.getByTestId('columns-sidebar');
    await expect(sidebar.getByRole('button', { name: 'Group by Desk' })).toBeVisible();
    await expect(sidebar.locator('[data-column="tradeId"] button[aria-label^="Group by"]')).toHaveCount(0);

    await sidebar.getByRole('button', { name: 'Group by Desk' }).click();
    const chip = page.locator('[data-slot="group-chip"][data-column="desk"]');
    await expect(chip).toBeVisible();

    // Five desks, each a group row with a subtotal in every aggregated
    // measure and nothing in the dimensions it does not group.
    const groups = grid.locator('tbody tr[data-grouped]');
    await expect(groups).toHaveCount(5);
    const first = groups.first();
    await expect(first.locator('td[data-column="desk"] [data-slot="group-toggle"]')).toBeVisible();
    await expect(first.locator('td[data-column="desk"]')).toHaveText(/\(\d{1,2},\d{3}\)$/);
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^\$[\d,]+\.\dM$/);
    await expect(first.locator('td[data-column="yield"]')).toHaveText(/^\d+\.\d\d%$/);
    await expect(first.locator('td[data-column="counterparty"]')).toHaveText('');
    await expect(grid.locator('tfoot td[data-column="desk"]')).toHaveText(/Total · 50,000 rows/);

    // Expanding shows leaves under the group, indented one level.
    await first.locator('[data-slot="group-toggle"]').click();
    await expect(first.locator('[data-slot="group-toggle"]')).toHaveAttribute('aria-expanded', 'true');
    const leaf = grid.locator('tbody tr[data-depth="1"]').first();
    await expect(leaf).toBeVisible();
    await expect(leaf.locator('td[data-column="tradeId"]')).toHaveText(/^T\d{6}$/);
    await expect(leaf.locator('td[data-column="desk"]')).toHaveText('');

    // A second grouping stacks under the first; the chips reflect the order.
    await sidebar.getByRole('button', { name: 'Group by Ccy' }).click();
    await expect(page.locator('[data-slot="group-chip"]')).toHaveCount(2);
    await expect(grid.locator('tbody tr[data-grouped][data-depth="1"]').first()).toBeVisible();

    // Removing the chips restores the flat book.
    await page.getByRole('button', { name: 'Remove Ccy from groups' }).click();
    await page.getByRole('button', { name: 'Remove Desk from groups' }).click();
    await expect(page.locator('[data-slot="group-chip"]')).toHaveCount(0);
    await expect(grid.locator('tbody tr[data-grouped]')).toHaveCount(0);
    await expect(grid.locator('tbody tr').first().locator('td[data-column="tradeId"]')).toHaveText('T000001');
  });

  test('drags a column header onto the row-groups zone', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    await expect(grid.locator('tbody tr').first()).toBeVisible();

    const header = grid.locator('th[data-column="product"] [data-slot="column-header"]');
    const zone = page.locator('[data-slot="group-zone"]');
    const from = (await header.boundingBox())!;
    const to = (await zone.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Past the sensor's activation distance, then across to the zone.
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 4, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(zone).toHaveAttribute('data-over', 'true');
    await page.mouse.up();

    await expect(page.locator('[data-slot="group-chip"][data-column="product"]')).toBeVisible();
    await expect(grid.locator('tbody tr[data-grouped]')).toHaveCount(6);
    // The grouped column moved to the front of the header.
    await expect(grid.locator('thead th').first()).toHaveAttribute('data-column', 'product');
  });
});
