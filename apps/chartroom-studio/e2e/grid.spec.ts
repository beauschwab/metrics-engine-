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

    // Headers come from meta labels, in the declared order, after the
    // selection column the hook pins at the start.
    const headers = grid.locator('thead th');
    await expect(headers.first()).toHaveAttribute('data-column', 'select');
    await expect(headers.nth(1)).toHaveText('Desk');
    await expect(headers.nth(10)).toHaveText('Notional');
    await expect(headers.nth(14)).toHaveText('Yield');

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
    await expect(headers.nth(1)).toBeInViewport();

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
    // The grouped column moved to the front of the header, after the selection column.
    await expect(grid.locator('thead th').nth(1)).toHaveAttribute('data-column', 'product');
  });

  test('sorts, filters by set and by range, quick-filters, and clears', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    const status = page.getByTestId('status-bar');
    await expect(grid.locator('tbody tr').first()).toBeVisible();
    await expect(status.locator('[data-slot="status-rows"]')).toHaveText(/^50,000 rows$/);

    // A header click sorts — descending first for a measure, v9's default
    // for numbers, so the largest notional leads; the next click flips.
    const notionalHeader = grid.locator('th[data-column="notional"]');
    await notionalHeader.locator('[data-slot="column-header"]').click();
    await expect(notionalHeader).toHaveAttribute('aria-sort', 'descending');
    const first = grid.locator('tbody tr').first();
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^\$[45]\d{3}\.\dM$/);
    await notionalHeader.locator('[data-slot="column-header"]').click();
    await expect(notionalHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^\$1\.0M$/);

    // The set filter lists the six products with counts; keeping only Bond narrows the book.
    await grid.locator('th[data-column="product"]').hover();
    await page.getByRole('button', { name: 'Filter Product' }).click();
    const setFilter = page.locator('[data-slot="filter-popover"][data-column="product"]');
    await expect(setFilter.locator('[data-slot="set-filter-values"] li')).toHaveCount(6);
    // The popover stays under its header when the pointer leaves the header
    // for the popover itself; a hover-only trigger once let it snap to 0,0.
    await setFilter.locator('[data-slot="set-filter-values"] li').last().hover();
    await page.mouse.move(700, 600);
    const anchor = (await grid.locator('th[data-column="product"]').boundingBox())!;
    const box = (await setFilter.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(anchor.y + anchor.height - 2);
    expect(box.y).toBeLessThan(anchor.y + anchor.height + 24);
    expect(Math.abs(box.x - anchor.x)).toBeLessThan(anchor.width + 40);
    await setFilter.getByLabel('Search Product values').fill('Bond');
    await setFilter.getByRole('button', { name: 'Only shown' }).click();
    await page.keyboard.press('Escape');
    await expect(status.locator('[data-slot="status-rows"]')).toHaveText(/^[\d,]+ of 50,000 rows$/);
    const bondRows = await status.locator('[data-slot="status-rows"]').textContent();
    const bondCount = Number(bondRows!.match(/^([\d,]+) of/)![1]!.replace(/,/g, ''));
    expect(bondCount).toBeGreaterThan(7_000);
    expect(bondCount).toBeLessThan(10_000);
    await expect(grid.locator('tbody tr').first().locator('td[data-column="product"]')).toHaveText('Bond');
    await expect(page.getByRole('button', { name: 'Filter Product' })).toHaveAttribute('data-active', 'true');

    // A number range on notional, open at the top.
    await grid.locator('th[data-column="notional"]').hover();
    await page.getByRole('button', { name: 'Filter Notional' }).click();
    const range = page.locator('[data-slot="filter-popover"][data-column="notional"]');
    await range.getByLabel('Notional minimum').fill('1000000000');
    await range.getByRole('button', { name: 'Apply' }).click();
    await page.keyboard.press('Escape');
    const both = await status.locator('[data-slot="status-rows"]').textContent();
    const bothCount = Number(both!.match(/^([\d,]+) of/)![1]!.replace(/,/g, ''));
    expect(bothCount).toBeLessThan(bondCount);
    expect(bothCount).toBeGreaterThan(0);

    // The quick filter narrows further; clearing restores the book.
    await page.getByLabel('Quick filter').fill('CP-0100');
    await expect(status.locator('[data-slot="status-rows"]')).toHaveText(/^\d{1,2} of 50,000 rows$/);
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(status.locator('[data-slot="status-rows"]')).toHaveText(/^50,000 rows$/);
    await expect(page.getByLabel('Quick filter')).toHaveValue('');
  });

  test('pins, hides and resizes from the header menu, and hides from the sidebar', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    await expect(grid.locator('tbody tr').first()).toBeVisible();

    // Pin counterparty to the start: it moves next to the selection column and sticks.
    await grid.locator('th[data-column="counterparty"]').hover();
    await page.getByRole('button', { name: 'Counterparty column menu' }).click();
    await page.getByRole('menuitem', { name: 'Pin to start' }).click();
    const pinned = grid.locator('th[data-column="counterparty"]');
    await expect(pinned).toHaveAttribute('data-pinned', 'start');
    await expect(grid.locator('thead th').nth(1)).toHaveAttribute('data-column', 'counterparty');
    await expect(pinned).toHaveCSS('position', 'sticky');
    await expect(grid.locator('tbody tr').first().locator('td[data-column="counterparty"]')).toHaveCSS('position', 'sticky');

    // Hide the as-of column from its menu; the body follows the header.
    await grid.locator('th[data-column="asOf"]').hover();
    await page.getByRole('button', { name: 'As of column menu' }).click();
    await page.getByRole('menuitem', { name: 'Hide column' }).click();
    await expect(grid.locator('th[data-column="asOf"]')).toHaveCount(0);
    await expect(grid.locator('tbody tr').first().locator('td[data-column="asOf"]')).toHaveCount(0);
    const headerCount = await grid.locator('thead th').count();
    expect(await grid.locator('tbody tr').first().locator('td').count()).toBe(headerCount);

    // The sidebar shows it unchecked and brings it back.
    const sidebar = page.getByTestId('columns-sidebar');
    const asOf = sidebar.getByLabel('Show As of');
    await expect(asOf).toHaveAttribute('data-state', 'unchecked');
    await asOf.click();
    await expect(grid.locator('th[data-column="asOf"]')).toHaveCount(1);

    // Drag the resize handle: the column and its cells widen together.
    const handle = grid.locator('th[data-column="desk"] [data-slot="resize-handle"]');
    const before = (await grid.locator('th[data-column="desk"]').boundingBox())!.width;
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const after = (await grid.locator('th[data-column="desk"]').boundingBox())!.width;
    expect(after).toBeGreaterThan(before + 40);
    const cellWidth = (await grid.locator('tbody tr').first().locator('td[data-column="desk"]').boundingBox())!.width;
    expect(Math.abs(cellWidth - after)).toBeLessThan(2);
  });

  test('selects rows into the status bar, opens a detail panel, switches density, and exports', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    const status = page.getByTestId('status-bar');
    await expect(grid.locator('tbody tr').first()).toBeVisible();

    // Two rows selected: the status bar sums them by their own aggregations.
    await page.getByLabel('Select T000001').check();
    await page.getByLabel('Select T000003').check();
    await expect(status.locator('[data-slot="status-selected"]')).toHaveText(/2 selected/);
    await expect(status.locator('[data-measure="notional"]')).toHaveText(/^Notional \$[\d,]+\.\dM$/);
    await expect(status.locator('[data-measure="yield"]')).toHaveText(/^Yield \d+\.\d\d%$/);
    await expect(grid.locator('tbody tr[data-state="selected"]')).toHaveCount(2);

    // Master-detail under the second row: every field, formatted.
    await page.getByRole('button', { name: 'Show details for T000002' }).click();
    const detail = grid.locator('[data-slot="detail-row"][data-row="T000002"]');
    await expect(detail).toBeVisible();
    await expect(detail.locator('dd')).toHaveCount(15);
    await expect(detail).toContainText('T000002');
    await page.getByRole('button', { name: 'Hide details for T000002' }).click();
    await expect(detail).toHaveCount(0);

    // Density: comfortable rows are taller.
    const compact = (await grid.locator('tbody tr').first().boundingBox())!.height;
    await page.getByRole('button', { name: 'Comfortable rows' }).click();
    await expect(grid).toHaveAttribute('data-density', 'comfortable');
    const comfortable = (await grid.locator('tbody tr').first().boundingBox())!.height;
    expect(comfortable).toBeGreaterThan(compact);

    // The heatmap paints notional cells with the accent mix, nothing else.
    await expect(grid.locator('td[data-column="notional"][data-heat]').first()).toBeVisible();
    await expect(grid.locator('td[data-column="mtm"][data-heat]')).toHaveCount(0);

    // The right-click menu filters by the cell's value.
    await grid.locator('tbody tr').first().locator('td[data-column="desk"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Filter Desk to/ }).click();
    await expect(status.locator('[data-slot="status-rows"]')).toHaveText(/^[\d,]+ of 50,000 rows$/);

    // Export downloads a workbook named after the source.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export to Excel' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^seeded-book-2026-09-28\.xlsx$/);
  });

  test('carries the view in the link, saves and loads it, and refuses a link that does not parse', async ({ page }) => {
    const param = (view: unknown) => Buffer.from(JSON.stringify(view)).toString('base64url');
    const grid = page.getByTestId('treasury-grid');

    // A link with a grouped, sorted view opens grouped and sorted.
    await page.goto(`/#/grid?v=${param({ version: 1, grouping: ['desk'], sorting: [{ id: 'notional', desc: true }] })}`);
    await expect(grid.locator('tbody tr[data-grouped]')).toHaveCount(5);
    await expect(grid.locator('th[data-column="notional"]')).toHaveAttribute('aria-sort', 'descending');
    await expect(page.getByTestId('grid-link-refused')).toHaveCount(0);

    // A change writes the hash; the hash decodes to the new view; a reload keeps it.
    await page.getByTestId('columns-sidebar').getByRole('button', { name: 'Group by Ccy' }).click();
    await expect(page.locator('[data-slot="group-chip"]')).toHaveCount(2);
    const hash = await page.evaluate(() => location.hash);
    const decoded = JSON.parse(Buffer.from(new URL(`http://x/${hash.slice(1)}`).searchParams.get('v')!, 'base64url').toString());
    expect(decoded.grouping).toEqual(['desk', 'currency']);
    expect(decoded.sorting).toEqual([{ id: 'notional', desc: true }]);
    await page.reload();
    await expect(page.locator('[data-slot="group-chip"]')).toHaveCount(2);

    // Save the view under a name; open a clean grid; load it back.
    await page.getByRole('button', { name: 'Saved views' }).click();
    await page.getByLabel('View name').fill('Desk and currency');
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.locator('[data-slot="saved-views"] li')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.goto('/#/grid');
    await expect(page.locator('[data-slot="group-chip"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Saved views' }).click();
    await page.locator('[data-slot="saved-view-load"]', { hasText: 'Desk and currency' }).click();
    await expect(page.locator('[data-slot="group-chip"]')).toHaveCount(2);
    await expect(page).toHaveURL(/#\/grid\?v=/);

    // Reset writes a clean link; delete empties the store.
    await page.getByRole('button', { name: 'Saved views' }).click();
    await page.getByRole('button', { name: 'Delete view Desk and currency' }).click();
    await expect(page.locator('[data-slot="saved-views"] li')).toHaveText(/none yet/);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect(page.locator('[data-slot="group-chip"]')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/grid$/);

    // A link that does not parse is refused, with the reason, and the default renders.
    await page.goto(`/#/grid?v=${param({ version: 1, grouping: ['tradeId'] })}`);
    await expect(page.getByTestId('grid-link-refused')).toContainText('not groupable: tradeId');
    await expect(grid.locator('tbody tr').first().locator('td[data-column="tradeId"]')).toHaveText('T000001');
  });

  test('selects a block of cells by drag, copies it as tab-separated text, and clears it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    const rows = grid.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Drag from the first row's desk to the third row's product: a 3×4 block.
    const from = (await rows.nth(0).locator('td[data-column="desk"]').boundingBox())!;
    const to = (await rows.nth(2).locator('td[data-column="product"]').boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(grid.locator('td[data-selected]')).toHaveCount(12);
    await expect(rows.nth(0).locator('td[data-column="desk"]')).toHaveAttribute('data-selected', 'true');
    await expect(rows.nth(2).locator('td[data-column="product"]')).toHaveAttribute('data-selected', 'true');
    await expect(rows.nth(0).locator('td[data-column="tenorBucket"]')).not.toHaveAttribute('data-selected', 'true');

    // Ctrl+C writes the block as the screen shows it.
    const firstDesk = await rows.nth(0).locator('td[data-column="desk"]').textContent();
    await grid.focus();
    await page.keyboard.press('Control+c');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]!.split('\t').length).toBe(4);
    expect(lines[0]!.split('\t')[0]).toBe(firstDesk);

    // The context menu copies with a header row.
    await rows.nth(1).locator('td[data-column="currency"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy range with headers' }).click();
    const withHeaders = await page.evaluate(() => navigator.clipboard.readText());
    expect(withHeaders.split('\n')[0]).toBe('Desk\tEntity\tCcy\tProduct');

    // Escape clears; the selection column never selects.
    await grid.focus();
    await page.keyboard.press('Escape');
    await expect(grid.locator('td[data-selected]')).toHaveCount(0);
    const sel = (await rows.nth(0).locator('td[data-column="select"]').boundingBox())!;
    await page.mouse.move(sel.x + sel.width - 4, sel.y + sel.height / 2);
    await page.mouse.down();
    await page.mouse.move(sel.x + sel.width - 4, sel.y + 40, { steps: 3 });
    await page.mouse.up();
    await expect(grid.locator('td[data-selected]')).toHaveCount(0);
  });

  test('changes a column\'s aggregation from the header menu; the footer, the subtotals and the link follow', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    await expect(grid.locator('tbody tr').first()).toBeVisible();
    const footerYield = grid.locator('tfoot td[data-column="yield"]');
    await expect(footerYield).not.toHaveText('');
    const weighted = (await footerYield.textContent())!;

    // Yield aggregates as a notional-weighted average by default; choose the plain mean.
    await grid.locator('th[data-column="yield"]').hover();
    await page.getByRole('button', { name: 'Yield column menu' }).click();
    await page.locator('[data-slot="agg-menu"]').hover();
    const choices = page.locator('[data-slot="agg-choices"][data-column="yield"]');
    await expect(choices.getByRole('menuitemradio', { name: 'Weighted average (default)' })).toHaveAttribute('aria-checked', 'true');
    await choices.getByRole('menuitemradio', { name: 'Mean', exact: true }).click();
    await expect(footerYield).not.toHaveText(weighted);
    const mean = (await footerYield.textContent())!;

    // The choice is part of the view: the link carries it, and a group row uses it.
    const hash = await page.evaluate(() => location.hash);
    const decoded = JSON.parse(Buffer.from(new URL(`http://x/${hash.slice(1)}`).searchParams.get('v')!, 'base64url').toString());
    expect(decoded.columnAggs).toEqual({ yield: 'mean' });
    await page.getByTestId('columns-sidebar').getByRole('button', { name: 'Group by Desk' }).click();
    await expect(grid.locator('tbody tr[data-grouped]')).toHaveCount(5);
    await expect(grid.locator('tbody tr[data-grouped]').first().locator('td[data-column="yield"]')).toHaveAttribute('data-cell', 'aggregated');
    await expect(footerYield).toHaveText(mean);

    // A dimension offers no aggregation; restoring the default brings the weighted figure back.
    await grid.locator('th[data-column="counterparty"]').hover();
    await page.getByRole('button', { name: 'Counterparty column menu' }).click();
    await expect(page.locator('[data-slot="agg-menu"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await grid.locator('th[data-column="yield"]').hover();
    await page.getByRole('button', { name: 'Yield column menu' }).click();
    await page.locator('[data-slot="agg-menu"]').hover();
    await choices.getByRole('menuitem', { name: 'Restore default' }).click();
    await expect(footerYield).toHaveText(weighted);
    const restored = JSON.parse(Buffer.from(new URL(`http://x/${(await page.evaluate(() => location.hash)).slice(1)}`).searchParams.get('v')!, 'base64url').toString());
    expect(restored.columnAggs ?? {}).toEqual({});
  });

  test('searches with column tokens, reads the filter bar, and works the set filter\'s none, invert, exclude and only', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    const status = page.getByTestId('status-bar').locator('[data-slot="status-rows"]');
    const count = async () => Number((await status.textContent())!.match(/^([\d,]+)/)![1]!.replace(/,/g, ''));
    await expect(grid.locator('tbody tr').first()).toBeVisible();
    await expect(status).toHaveText(/^50,000 rows$/);

    // Three tokens: a dimension contains, a dimension by its label, a measure compared with a suffix.
    const quick = page.getByLabel('Quick filter');
    await quick.fill('desk:Credit ccy:EUR notional>1bn');
    const bar = page.locator('[data-slot="filter-bar"]');
    await expect(bar.locator('[data-slot="search-chip"]')).toHaveCount(3);
    await expect(bar.locator('[data-slot="search-chip"]').nth(2)).toHaveText(/Notional > 1000000000/);
    await expect(status).toHaveText(/^[\d,]+ of 50,000 rows$/);
    const three = await count();
    expect(three).toBeGreaterThan(0);
    const first = grid.locator('tbody tr').first();
    await expect(first.locator('td[data-column="desk"]')).toHaveText('Credit');
    await expect(first.locator('td[data-column="currency"]')).toHaveText('EUR');
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^\$[1-9]\d{3}\.\dM$/);

    // Removing one chip keeps the others, in the box as typed.
    await bar.getByRole('button', { name: 'Remove ccy:EUR from the search' }).click();
    await expect(quick).toHaveValue('desk:Credit notional>1bn');
    await expect(bar.locator('[data-slot="search-chip"]')).toHaveCount(2);
    expect(await count()).toBeGreaterThan(three);

    // A measure given no number keeps nothing, and the chip says why.
    await quick.fill('notional>abc');
    await expect(status).toHaveText(/^0 of 50,000 rows$/);
    await expect(bar.locator('[data-slot="search-chip"][data-kind="unknown"]')).toHaveCount(1);
    await bar.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(status).toHaveText(/^50,000 rows$/);
    await expect(bar).toHaveCount(0);
    await expect(quick).toHaveValue('');

    // The set filter: none keeps nothing; invert of none is everything; exclude one; only one.
    await grid.locator('th[data-column="product"]').hover();
    await page.getByRole('button', { name: 'Filter Product' }).click();
    const popover = page.locator('[data-slot="filter-popover"][data-column="product"]');
    await popover.getByRole('button', { name: 'None' }).click();
    await expect(status).toHaveText(/^0 of 50,000 rows$/);
    await expect(bar.locator('[data-slot="filter-chip"][data-column="product"]')).toHaveText(/Product: none/);
    await popover.getByRole('button', { name: 'Invert' }).click();
    await expect(status).toHaveText(/^50,000 rows$/);
    await expect(bar).toHaveCount(0);
    await popover.locator('[data-slot="set-filter-values"] li[data-value="Bond"]').hover();
    await popover.getByRole('button', { name: 'Exclude Bond' }).click();
    await expect(status).toHaveText(/^[\d,]+ of 50,000 rows$/);
    const withoutBond = await count();
    expect(withoutBond).toBeGreaterThan(40_000);
    expect(withoutBond).toBeLessThan(43_000);
    await expect(bar.locator('[data-slot="filter-chip"][data-column="product"]')).toHaveText(/Product: .* \+2$/);
    await popover.locator('[data-slot="set-filter-values"] li[data-value="IRS"]').hover();
    await popover.getByRole('button', { name: 'Only IRS' }).click();
    await expect(bar.locator('[data-slot="filter-chip"][data-column="product"]')).toHaveText('Product: IRS');
    await expect(grid.locator('tbody tr').first().locator('td[data-column="product"]')).toHaveText('IRS');
    await page.keyboard.press('Escape');

    // A column filter and a search token share the bar; the link carries both.
    await quick.fill('desk=Rates');
    await expect(bar.locator('[data-slot="filter-chip"], [data-slot="search-chip"]')).toHaveCount(2);
    const hash = await page.evaluate(() => location.hash);
    const decoded = JSON.parse(Buffer.from(new URL(`http://x/${hash.slice(1)}`).searchParams.get('v')!, 'base64url').toString());
    expect(decoded.globalFilter).toBe('desk=Rates');
    expect(decoded.columnFilters).toEqual([{ id: 'product', value: ['IRS'] }]);
  });

  test('formats a measure from the header menu — scale, decimals, accounting negatives — and the link carries it', async ({ page }) => {
    await page.goto('/#/grid');
    const grid = page.getByTestId('treasury-grid');
    const first = grid.locator('tbody tr').first();
    await expect(first).toBeVisible();
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^\$[\d,]+\.\dM$/);
    const openFormat = async (label: string) => {
      await grid.locator(`th[data-column="${label === 'Notional' ? 'notional' : 'mtm'}"]`).hover();
      await page.getByRole('button', { name: `${label} column menu` }).click();
      await page.locator('[data-slot="format-menu"]').hover();
      return page.locator(`[data-slot="format-choices"][data-column="${label === 'Notional' ? 'notional' : 'mtm'}"]`);
    };

    // Notional read in billions, then to two decimals: cells and the grand total follow.
    let choices = await openFormat('Notional');
    await expect(choices.getByRole('menuitemradio', { name: 'Millions' })).toHaveAttribute('aria-checked', 'true');
    await choices.getByRole('menuitemradio', { name: 'Billions' }).click();
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^\$\d+\.\dB$/);
    await expect(grid.locator('tfoot td[data-column="notional"]')).toHaveText(/^\$[\d,]+\.\dB$/);
    choices = await openFormat('Notional');
    await expect(page.locator('[data-slot="format-menu"]')).toHaveText(/Format · custom/);
    await choices.getByRole('menuitemradio', { name: '2 decimals' }).click();
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^\$\d+\.\d{2}B$/);
    const hash = await page.evaluate(() => location.hash);
    const decoded = JSON.parse(Buffer.from(new URL(`http://x/${hash.slice(1)}`).searchParams.get('v')!, 'base64url').toString());
    expect(decoded.columnFormats).toEqual({ notional: { scale: 'bn', dp: 2 } });

    // A negative MTM in accounting parentheses; restoring the default brings the minus back.
    await page.getByLabel('Quick filter').fill('mtm<0');
    await expect(first.locator('td[data-column="mtm"]')).toHaveText(/^-\$[\d.]+M$/);
    choices = await openFormat('MTM');
    await choices.getByRole('menuitemradio', { name: '(1,234)' }).click();
    await expect(first.locator('td[data-column="mtm"]')).toHaveText(/^\(\$[\d.]+M\)$/);
    choices = await openFormat('MTM');
    await choices.getByRole('menuitem', { name: 'Restore default' }).click();
    await expect(first.locator('td[data-column="mtm"]')).toHaveText(/^-\$[\d.]+M$/);

    // A dimension has no format, and a percent offers no scale.
    await grid.locator('th[data-column="desk"]').hover();
    await page.getByRole('button', { name: 'Desk column menu' }).click();
    await expect(page.locator('[data-slot="format-menu"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await grid.locator('th[data-column="yield"]').hover();
    await page.getByRole('button', { name: 'Yield column menu' }).click();
    await page.locator('[data-slot="format-menu"]').hover();
    const pct = page.locator('[data-slot="format-choices"][data-column="yield"]');
    await expect(pct.getByRole('menuitemradio', { name: '2 decimals' })).toHaveAttribute('aria-checked', 'true');
    await expect(pct.getByRole('menuitemradio', { name: 'Billions' })).toHaveCount(0);
  });

  test('serves the same book from DuckDB-WASM: filter, sort and grouping compiled to SQL, children fetched on expand', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/#/grid?s=duckdb');
    const grid = page.getByTestId('treasury-grid');
    const status = page.getByTestId('status-bar');
    // The engine and the book arrive as assets; give them time.
    await expect(page.getByTestId('grid-harness-title')).toHaveText(/50,000 positions as of 2026-09-28 · DuckDB-WASM/, { timeout: 120_000 });
    await expect(grid.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
    await expect(status.locator('[data-slot="status-served"]')).toHaveText(/serves filter, sort, group/);
    await expect(grid.locator('tbody tr').first().locator('td[data-column="tradeId"]')).toHaveText('T000001');

    // A sort is served: the engine orders, the client passes rows through.
    await grid.locator('th[data-column="notional"] [data-slot="column-header"]').click();
    await expect(grid.locator('th[data-column="notional"]')).toHaveAttribute('aria-sort', 'descending');
    await expect(grid.locator('tbody tr').first().locator('td[data-column="notional"]')).toHaveText(/^\$[45]\d{3}\.\dM$/, { timeout: 30_000 });

    // A set filter is served: the status counts what the engine answered against the whole book.
    await grid.locator('th[data-column="product"]').hover();
    await page.getByRole('button', { name: 'Filter Product' }).click();
    const setFilter = page.locator('[data-slot="filter-popover"][data-column="product"]');
    await setFilter.getByLabel('Search Product values').fill('CDS');
    await setFilter.getByRole('button', { name: 'Only shown' }).click();
    await page.keyboard.press('Escape');
    await expect(status.locator('[data-slot="status-rows"]')).toHaveText(/^[\d,]+ of 50,000 rows$/, { timeout: 30_000 });
    await expect(grid.locator('tbody tr').first().locator('td[data-column="product"]')).toHaveText('CDS');

    // Grouping is served a level at a time: five desk nodes with subtotals,
    // and a node's children fetched by its path when it expands.
    await page.getByTestId('columns-sidebar').getByRole('button', { name: 'Group by Desk' }).click();
    const groups = grid.locator('tbody tr[data-grouped]');
    await expect(groups).toHaveCount(5, { timeout: 30_000 });
    const first = groups.first();
    await expect(first.locator('td[data-column="desk"]')).toHaveText(/\(\d{1,2},\d{3}\)$|\(\d{3}\)$/);
    await expect(first.locator('td[data-column="notional"]')).toHaveText(/^\$[\d,]+\.\dM$/);
    await expect(first.locator('td[data-column="yield"]')).toHaveText(/^\d+\.\d\d%$/);
    await expect(first.locator('td[data-column="counterparty"]')).toHaveText('');
    await page.getByTestId('columns-sidebar').getByRole('button', { name: 'Group by Ccy' }).click();
    await expect(page.locator('[data-slot="group-chip"]')).toHaveCount(2);
    await expect(grid.locator('tbody tr[data-grouped]')).toHaveCount(5, { timeout: 30_000 });
    await grid.locator('tbody tr[data-grouped]').first().locator('[data-slot="group-toggle"]').click();
    const children = grid.locator('tbody tr[data-grouped][data-depth="1"]');
    await expect(children.first()).toBeVisible({ timeout: 30_000 });
    expect(await children.count()).toBeGreaterThan(5);
    // The value and the count are two spans; their texts join without a space.
    await expect(children.first().locator('td[data-column="currency"]')).toHaveText(/^[A-Z]{3}\s?\(\d{1,3}(,\d{3})?\)$/);
    // Expanding a currency reaches the leaves, still filtered to CDS.
    await children.first().locator('[data-slot="group-toggle"]').click();
    const leaf = grid.locator('tbody tr[data-depth="2"]:not([data-grouped])').first();
    await expect(leaf).toBeVisible({ timeout: 30_000 });
    await expect(leaf.locator('td[data-column="product"]')).toHaveText('CDS');
    await expect(leaf.locator('td[data-column="tradeId"]')).toHaveText(/^T\d{6}$/);
  });
});
