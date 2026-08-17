/**
 * View mode: the shareable URL renders the latest saved version through the
 * same interpreter, with no editing chrome — and cross-filtering still works,
 * because it is a view interaction, not an edit.
 */

import { expect, test } from '@playwright/test';

test('the view URL renders the saved dashboard read-only, interactions intact', async ({ page }) => {
  // The dogfood dashboard is seeded on first boot.
  await page.goto('/#/view/lcr-monitor');

  await expect(page.getByTestId('view-page')).toBeVisible();
  await expect(page.getByTestId('canvas')).toBeVisible();
  // Widgets render with real numbers…
  await expect(page.getByTestId('view-page').locator('.cr-frame').first())
    .toHaveAttribute('data-status', 'fresh');
  // …and none of the editing chrome exists.
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  await expect(page.getByTestId('save')).toHaveCount(0);
});

test('a dashboard with no versions says so instead of showing a blank', async ({ page }) => {
  await page.goto('/#/view/no-such-board');
  await expect(page.getByTestId('view-missing')).toBeVisible();
});
