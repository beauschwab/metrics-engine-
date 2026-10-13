/**
 * Tree mode (ADR-93): a grouping read as one indented column. The grouped
 * dimensions leave the screen while the tree holds them, every level draws in
 * the tree with its toggle and count, the header sorts the levels together,
 * the link carries the choice, and switching back restores the columns.
 */

import { expect, test } from '@playwright/test';

const SHOTS = process.env.CHART_SHOTS;
const TREE = '__tree';

test('groups read as one tree column, and switching back restores the grouped columns', async ({ page }) => {
  await page.goto('/#/grid');
  const grid = page.getByTestId('treasury-grid');
  await expect(grid.locator('tbody tr').first()).toBeVisible();
  const sidebar = page.getByTestId('columns-sidebar');
  // No grouping, no toggle: there is nothing to nest.
  await expect(page.locator('[data-slot="tree-toggle"]')).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Group by Desk' }).click();
  await sidebar.getByRole('button', { name: 'Group by Ccy' }).click();
  const toggle = page.locator('[data-slot="tree-toggle"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(grid.locator('th[data-column="desk"]')).toHaveCount(1);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // One column holds the hierarchy; the grouped dimensions are off the screen.
  const header = grid.locator(`th[data-column="${TREE}"]`);
  await expect(header).toHaveText(/Desk › Ccy/i);
  await expect(grid.locator('th[data-column="desk"]')).toHaveCount(0);
  await expect(grid.locator('th[data-column="currency"]')).toHaveCount(0);
  const groups = grid.locator('tbody tr[data-grouped][data-depth="0"]');
  await expect(groups).toHaveCount(5);
  const first = groups.first().locator(`td[data-column="${TREE}"]`);
  await expect(first).toHaveAttribute('data-cell', 'group');
  await expect(first).toContainText(/\(\d[\d,]*\)/);

  // Opening a desk shows its currencies in the same column, one level in.
  await first.locator('[data-slot="group-toggle"]').click();
  const nested = grid.locator('tbody tr[data-grouped][data-depth="1"]').first().locator(`td[data-column="${TREE}"]`);
  await expect(nested).toHaveAttribute('data-cell', 'group');
  await expect(nested.locator('span').first()).toHaveCSS('padding-left', '14px');
  // A measure still subtotals beside it.
  await expect(grid.locator('tbody tr[data-grouped][data-depth="1"]').first().locator('td[data-column="notional"]')).toHaveAttribute('data-cell', 'aggregated');

  // The sidebar says where the grouped columns went, and does not offer to show them twice.
  const deskBox = sidebar.locator('[data-column="desk"]').getByRole('checkbox');
  await expect(deskBox).toBeDisabled();
  await expect(deskBox).toHaveAttribute('aria-label', 'Desk is shown in the tree');

  // The header sorts every level by its own values.
  await header.locator('[data-slot="tree-header"]').click();
  await expect(header.locator('[data-slot="sort-indicator"]')).toBeVisible();

  // The link carries the display.
  const hash = await page.evaluate(() => location.hash);
  const decoded = JSON.parse(Buffer.from(new URL(`http://x/${hash.slice(1)}`).searchParams.get('v')!, 'base64url').toString());
  expect(decoded.groupDisplay).toBe('tree');
  expect(decoded.columnVisibility ?? {}).not.toHaveProperty('desk');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tree-mode.png` });

  // Back to columns: the grouped dimensions return, the tree column goes.
  await toggle.click();
  await expect(grid.locator(`th[data-column="${TREE}"]`)).toHaveCount(0);
  await expect(grid.locator('th[data-column="desk"]')).toHaveCount(1);
  await expect(grid.locator('th[data-column="currency"]')).toHaveCount(1);
  await expect(sidebar.locator('[data-column="desk"]').getByRole('checkbox')).toBeEnabled();
});
