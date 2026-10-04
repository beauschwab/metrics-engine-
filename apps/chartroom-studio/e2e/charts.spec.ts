/**
 * Charting a grid selection onto the board (ADR-92): select a block in the
 * dashboard's working table, open the Evil Charts gallery, see each kind
 * planned for the selection — drawn, or refused with the linter's reason —
 * dress one, add it, and find it on the canvas as a governed tile.
 */

import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.CHART_SHOTS;

test.beforeEach(async ({ page }) => {
  await page.goto('/#/author');
  await page.getByTestId('dash-lcr-monitor').click();
  await expect(page.getByTestId('widget-outflow-table').getByTestId('treasury-grid').locator('tbody tr').first()).toBeVisible();
});

/** Drag a block from the first row's entity to the `last`-th row's value, and chart it. */
async function chartBlock(page: Page, last: number, from = 'entity_id') {
  const table = page.getByTestId('widget-outflow-table').getByTestId('treasury-grid');
  const rows = table.locator('tbody tr');
  // The working table sits low on the board: bring it on screen, since a raw drag does not scroll.
  await rows.nth(last).locator('td[data-column="value"]').scrollIntoViewIfNeeded();
  const a = (await rows.nth(0).locator(`td[data-column="${from}"]`).boundingBox())!;
  const b = (await rows.nth(last).locator('td[data-column="value"]').boundingBox())!;
  // The middle of the cell: its left edge holds the row's expand toggle.
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // The right edge of the value cell: its left holds the trend, which owns its own pointer.
  await page.mouse.move(b.x + b.width - 6, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(table.locator('td[data-selected]')).toHaveCount((last + 1) * (from === 'entity_id' ? 3 : 2));
  // The entity cell, not the value: the value cell carries the trend, whose own pointer handling owns it.
  await rows.nth(1).locator(`td[data-column="${from}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Chart selection' }).click();
  const gallery = page.getByTestId('chart-gallery');
  await expect(gallery).toBeVisible();
  return gallery;
}

test('the gallery plans every Evil Charts kind for the selection, and draws the ones it can', async ({ page }) => {
  const gallery = await chartBlock(page, 5);
  const tiles = gallery.getByRole('radio');
  await expect(tiles).toHaveCount(10);
  // Two dimensions and the value: bars, stacks, lines over the window and a flow all apply.
  for (const kind of ['evil-bar', 'evil-composed', 'evil-line', 'evil-area', 'evil-radial', 'evil-sankey']) {
    await expect(gallery.locator(`[data-kind="${kind}"]`), kind).toHaveAttribute('data-ok', 'true');
  }
  for (const tile of await tiles.all()) {
    const kind = (await tile.getAttribute('data-kind'))!;
    await tile.click();
    await expect(tile).toHaveAttribute('aria-checked', 'true');
    if ((await tile.getAttribute('data-ok')) === 'true') {
      // The preview is the widget, resolved as the canvas resolves it: an SVG chart, or the renderer's own refusal.
      const preview = gallery.getByTestId('chart-preview');
      await expect(preview.locator('.recharts-surface, [data-slot="chart-refused"]').first(), kind).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(gallery.locator('[data-slot="chart-refused"] [role="note"]'), kind).not.toBeEmpty();
    }
    if (SHOTS) {
      // Let the library's entrance animation finish before the picture is taken.
      await page.waitForTimeout(1500);
      await gallery.screenshot({ path: `${SHOTS}/gallery-${kind}.png` });
    }
  }
});

test('a dressed chart is added to the board as a governed tile and saved in the spec', async ({ page }) => {
  const gallery = await chartBlock(page, 5);
  await gallery.locator('[data-kind="evil-bar"]').click();
  // Appearance options re-dress the same binding: no refetch, a new fill.
  await gallery.locator('[data-option="variant:gradient"]').click();
  await expect(gallery.locator('[data-option="variant:gradient"]')).toHaveAttribute('aria-pressed', 'true');
  await gallery.locator('[data-option="layout:horizontal"]').click();
  await expect(gallery.getByTestId('chart-preview').locator('.recharts-bar-rectangle').first()).toBeVisible();
  await gallery.getByRole('button', { name: 'Full' }).click();
  await gallery.getByTestId('add-to-dashboard').click();
  await expect(gallery).toBeHidden();

  const tile = page.getByTestId('widget-bar-1');
  await expect(tile).toBeVisible();
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toHaveAttribute('data-status', 'fresh');
  await expect(tile.locator('.recharts-surface')).toBeVisible();
  await expect(tile.locator('.cr-frame-ref')).toHaveText(/weighted_outflows_30d@\d+/);
  // The new tile is selected and the inspector shows it; the spec carries its binding and its dress.
  await expect(tile).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('tab-source').click();
  const scroller = page.locator('.cr-source-host .cm-scroller');
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByTestId('source-editor')).toContainText('"evil-bar@1"');
  await expect(page.getByTestId('source-editor')).toContainText('"gradient"');
  if (SHOTS) {
    await page.getByTestId('tab-widget').click();
    await page.waitForTimeout(1500);
    await tile.screenshot({ path: `${SHOTS}/tile-bar.png` });
  }
});

test('a block without the value cannot size a chart, and the gallery says why', async ({ page }) => {
  // Only the entity, no value: nothing to size a chart with.
  const table = page.getByTestId('widget-outflow-table').getByTestId('treasury-grid');
  const rows = table.locator('tbody tr');
  await rows.nth(3).scrollIntoViewIfNeeded();
  const a = (await rows.nth(0).locator('td[data-column="entity_id"]').boundingBox())!;
  const b = (await rows.nth(3).locator('td[data-column="maturity_bucket"]').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await rows.nth(1).locator('td[data-column="entity_id"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Chart selection' }).click();
  const gallery = page.getByTestId('chart-gallery');
  await expect(gallery.locator('[data-ok="true"]')).toHaveCount(0);
  await expect(gallery.locator('[data-slot="chart-refused"]')).toContainText('include the value column');
  await page.keyboard.press('Escape');
  await expect(gallery).toBeHidden();
});
