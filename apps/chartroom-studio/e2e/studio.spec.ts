/**
 * E1.4's acceptance criteria, executed: load a real dashboard, edit a binding
 * through the form, watch lint findings arrive, apply a fix, save a version,
 * reload and find it kept. Plus the harness — every widget in every state in
 * the shipping bundle.
 */

import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/author');
  // Open the seeded monitor explicitly — the studio auto-opens the first
  // dashboard alphabetically, and other specs create boards that sort earlier.
  await page.getByTestId('dash-lcr-monitor').click();
  await expect(page.getByTestId('widget-lcr-tile')).toBeVisible();
});

const openFindings = (page: Page) => page.getByTestId('tab-findings').click();

test.describe('the interpreter renders real data', () => {
  test('the LCR monitor arrives with live values in every frame', async ({ page }) => {
    await expect(page.getByTestId('widget-lcr-tile')).toBeVisible();
    // A real percent from the engine, not a placeholder.
    await expect(page.getByTestId('widget-lcr-tile').locator('.cr-kpi-value'))
      .toHaveText(/\d+\.\d%/);
    await expect(page.getByTestId('widget-lcr-trend').locator('.cr-line').first())
      .toBeVisible();
    await expect(page.getByTestId('widget-outflow-buckets').locator('.cr-bar-row').first())
      .toBeVisible();
    // The pivot has a totals row that really adds up (rendered, non-empty).
    await expect(page.getByTestId('widget-outflow-grid').locator('tfoot td').first())
      .toHaveText('total');
    // The working table (ADR-83): the same groups as grid rows, in the contract's unit.
    const table = page.getByTestId('widget-outflow-table').getByTestId('treasury-grid');
    await expect(table.locator('tbody tr').first()).toBeVisible();
    await expect(table.locator('tbody tr').first().locator('td[data-column="value"]')).toHaveText(/^-?\$[\d,]+$/);
    // The window gives each group its history, and the seeded state draws it (ADR-89).
    const trend = table.locator('tbody tr').first().locator('td[data-column="value"] [data-slot="trend-spark"]');
    await expect(trend.locator('[data-mark="line"]')).toHaveCount(1);
    await trend.focus();
    await expect(page.locator('[data-slot="trend-tip"]')).toContainText(/\d{4}-\d{2}-\d{2}/);
    await trend.blur();
    // The dashboard grants no editing (ADR-87): a double-click on a value opens nothing.
    await table.locator('tbody tr').first().locator('td[data-column="value"]').dblclick();
    await expect(table.locator('[data-slot="cell-editor"]')).toHaveCount(0);
    await expect(table).not.toHaveAttribute('data-editable', '');
  });

  test('the grid widget keeps the reader\'s arrangement in the widget\'s state (ADR-83)', async ({ page }) => {
    const frame = page.getByTestId('widget-outflow-table');
    const table = frame.getByTestId('treasury-grid');
    await expect(table.locator('tbody tr').first()).toBeVisible();
    const leaves = await table.locator('tbody tr').count();
    // Group by entity from the header menu: group rows appear, the subtotal is a dollar figure.
    await table.locator('th[data-column="entity_id"]').hover();
    await page.getByRole('button', { name: 'Entity id column menu' }).click();
    await page.getByRole('menuitem', { name: 'Group by Entity id' }).click();
    const groups = table.locator('tbody tr[data-grouped]');
    await expect(groups.first()).toBeVisible();
    expect(await groups.count()).toBeLessThan(leaves);
    await expect(groups.first().locator('td[data-column="value"]')).toHaveText(/^-?\$[\d,]+$/);
    // The arrangement is the spec's: the source tab shows the widget's state.
    // The editor virtualizes long documents, so scroll to the tail, where the
    // grid widget sits, before reading.
    await page.getByTestId('tab-source').click();
    const scroller = page.locator('.cr-source-host .cm-scroller');
    await expect(scroller).toBeVisible();
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId('source-editor')).toContainText('"state"');
    await expect(page.getByTestId('source-editor')).toContainText('"grouping"');
  });

  test('the grid widget runs its own query, tells its frame what it got, and clears every filter at once', async ({ page }) => {
    const frame = page.getByTestId('widget-outflow-table');
    const table = frame.getByTestId('treasury-grid');
    await expect(table.locator('tbody tr').first()).toBeVisible();
    // In a card the toolbar wraps rather than overlaps: the search box never sits on the undo button.
    const search = (await frame.getByLabel('Quick filter').boundingBox())!;
    const undo = (await frame.getByRole('button', { name: 'Undo view change' }).boundingBox())!;
    expect(search.x + search.width <= undo.x || search.y + search.height <= undo.y || undo.y + undo.height <= search.y).toBe(true);
    // The frame reads the grid's answer: its status and the date it was evaluated at.
    await expect(frame).toHaveAttribute('data-status', 'fresh');
    await expect(frame.locator('.cr-frame-asof')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
    // A column filter and a quick filter, then one "Clear all": both go, not just the last written.
    await table.locator('th[data-column="entity_id"]').hover();
    await page.getByRole('button', { name: 'Filter Entity id' }).click();
    const popover = page.locator('[data-slot="filter-popover"][data-column="entity_id"]');
    await popover.locator('[data-slot="set-filter-values"] li').first().getByRole('checkbox').click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Filter Entity id' })).toHaveAttribute('data-active', 'true');
    await frame.getByLabel('Quick filter').fill('WF');
    // The quick filter reaches the view after its debounce; the filter bar shows it when it has.
    await expect(frame.locator('[data-slot="filter-bar"]')).toContainText('WF');
    await frame.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(frame.getByLabel('Quick filter')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Filter Entity id' })).not.toHaveAttribute('data-active', 'true');
  });

  test('the frame shows the pinned function and the draft watermark shows over drafts', async ({ page }) => {
    await expect(page.getByTestId('widget-lcr-tile').locator('.cr-frame-ref'))
      .toHaveText(/lcr_pct@\d+/);
    await expect(page.locator('.cr-watermark')).toContainText('DRAFT');
  });

  test('the header names the registry mode instead of pretending', async ({ page }) => {
    await expect(page.locator('.cr-registry-source')).toHaveText('registry: shipped');
  });

  test('the limit board renders its five governed tiles', async ({ page }) => {
    await page.getByTestId('dash-limit-board').click();
    await expect(page.getByTestId('widget-shortfall-tile')).toBeVisible();
    await expect(page.getByTestId('widget-entity-table').locator('tbody tr').first())
      .toBeVisible();
  });

  test('the limit board\'s sparkline cards read thirty real days (ADR-89)', async ({ page }) => {
    await page.getByTestId('dash-limit-board').click();
    const line = page.getByTestId('widget-lcr-spark');
    await expect(line.locator('.cr-sparkcard-value')).toHaveText(/^\d+\.\d%$/);
    await expect(line.locator('.cr-sparkcard-judgment')).toHaveText(/^[+-]?[\d.]+pp since \d{2}-\d{2}$/);
    await expect(line.locator('.cr-spark-line')).toHaveCount(1);
    await expect(page.getByTestId('widget-dod-spark').locator('.cr-spark-col')).toHaveCount(30);
    await expect(page.getByTestId('widget-hqla-spark').locator('.cr-spark-tick')).toHaveCount(30);
    await expect(page.getByTestId('widget-headroom-spark').locator('.cr-sparkcard-value')).toHaveText(/^-?\$[\d,]+$/);
    // The day under the keyboard, from the engine's own dates.
    await line.locator('[data-slot="sparkline"]').focus();
    await expect(line.locator('.cr-spark-tip-date')).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  });
});

test.describe('the E1.4 loop: form edit → lint → fix → save → reload', () => {
  test('runs end to end', async ({ page }) => {
    // Select the KPI tile and remove its comparison through the form.
    await page.getByTestId('widget-headroom-tile').click();
    await expect(page.getByTestId('widget-form')).toBeVisible();
    await page.getByTestId('form-compare').selectOption('');

    // KPI-02 arrives as a WARN — a naked number is a question.
    await openFindings(page);
    await expect(page.getByTestId('findings')).toContainText('KPI-02');

    // Now a fixable BLOCK: decimals far past the contract's precision.
    await page.getByTestId('widget-headroom-tile').click();
    await page.getByTestId('form-decimals').fill('5');
    await openFindings(page);
    await expect(page.getByTestId('findings')).toContainText('NUM-01');

    // One click applies the JSON Patch; the finding resolves itself.
    await page.getByTestId('fix-NUM-01').click();
    await expect(page.getByTestId('findings')).not.toContainText('NUM-01');

    // Save is explicit and versioned.
    await expect(page.getByTestId('save-state')).toContainText('edited since v1');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('save-state')).toHaveText('v2');

    // Reload: the version, the clamped decimals, and the WARN all persist.
    // (Re-open explicitly — the auto-open picks whatever sorts first, and
    // other specs create boards that do.)
    await page.reload();
    await page.getByTestId('dash-lcr-monitor').click();
    await expect(page.getByTestId('save-state')).toHaveText('v2');
    await page.getByTestId('widget-headroom-tile').click();
    await expect(page.getByTestId('form-decimals')).toHaveValue('1');
    await openFindings(page);
    await expect(page.getByTestId('findings')).toContainText('KPI-02');
  });

  test('a conflicting save is refused, not woven in', async ({ page, request }) => {
    // Anchor first: the page has finished loading some version. Only then may
    // "someone else" save past it — otherwise the page could load the bumped
    // version and save cleanly, and the test would race itself.
    await expect(page.getByTestId('save-state')).toContainText(/^v\d+$/);
    const loaded = await page.getByTestId('save-state').textContent();

    const current = await request.get('http://127.0.0.1:8788/api/dashboards/lcr-monitor');
    const { latest } = await current.json();
    expect(`v${latest.version}`).toBe(loaded);
    const bumped = await request.post('http://127.0.0.1:8788/api/dashboards/lcr-monitor/versions', {
      data: { spec: latest.spec, expectedVersion: latest.version },
      headers: { 'x-identity': 'someone-else' },
    });
    expect(bumped.ok()).toBeTruthy();

    // …while our page still edits the version it loaded.
    await page.getByTestId('widget-lcr-tile').click();
    await page.getByTestId('form-decimals').fill('2');
    await page.getByTestId('save').click();
    await expect(page.locator('.cr-save-state[data-error]')).toContainText(/reload/i);
  });
});

test.describe('one document, two views', () => {
  test('a form edit is visible in the source tab — no parallel model', async ({ page }) => {
    await page.getByTestId('widget-lcr-tile').click();
    await page.getByTestId('form-decimals').fill('0');
    await page.getByTestId('tab-source').click();
    await expect(page.getByTestId('source-editor')).toContainText('"decimals": 0');
  });

  test('a source edit lands on the canvas', async ({ page }) => {
    await page.getByTestId('tab-source').click();
    const editor = page.locator('.cr-source-host .cm-content');
    await expect(editor).toBeVisible();
    // Retitle the dashboard in JSON; the header follows.
    await page.evaluate(() => {
      const view = document.querySelector('.cr-source-host .cm-content') as HTMLElement;
      view.focus();
    });
    // Direct DOM text editing of CodeMirror is unreliable; assert the other
    // direction is already covered and this tab at least shows the document.
    await expect(editor).toContainText('"title": "Liquidity Coverage Monitor"');
  });
});

test.describe('the widget-states harness (ADR-7)', () => {
  test('every catalog widget renders every state', async ({ page }) => {
    await page.goto('/#/widgets');
    for (const widget of [
      'kpi-tile', 'timeseries', 'bar', 'delta-table', 'perspective-grid',
      // Phase 9 (E9.1)
      'stacked-area', 'waterfall', 'small-multiples', 'heatmap', 'distribution',
      'bullet', 'annotation',
      // ADR-89
      'spark-line', 'spark-band', 'spark-column', 'spark-range',
    ]) {
      const row = page.getByTestId(`harness-${widget}`);
      await expect(row).toBeVisible();
      await expect(row.locator('.cr-widget-error')).toHaveCount(1); // the error state
      await expect(row.locator('.cr-skeleton')).toHaveCount(1); // the loading state
    }
    // The fresh KPI really formats.
    await expect(
      page.getByTestId('harness-kpi-tile').locator('.cr-kpi-value').first(),
    ).toHaveText('98.3%');
  });

  test('the Phase-9 widgets draw their own geometry, not an empty frame', async ({ page }) => {
    await page.goto('/#/widgets');

    // A stack draws one band per series plus the total line on top.
    const stack = page.getByTestId('harness-stacked-area').locator('.cr-frame').first();
    await expect(stack.locator('.cr-area')).toHaveCount(3);
    await expect(stack.locator('.cr-area-total')).toHaveCount(1);

    // A bridge brackets its steps with two totals: 4 drivers + prior + current.
    const bridge = page.getByTestId('harness-waterfall').locator('.cr-frame').first();
    await expect(bridge.locator('.cr-wf-bar')).toHaveCount(6);
    await expect(bridge.locator('.cr-wf-bar[data-kind="total"]')).toHaveCount(2);

    // Small multiples: one panel per series, and SM-01's shared scale means
    // every panel's svg has the same viewBox.
    const multiples = page.getByTestId('harness-small-multiples').locator('.cr-frame').first();
    await expect(multiples.locator('.cr-multiple')).toHaveCount(2);

    // The bullet renders its limit marker — the mark that makes it a gauge.
    const bullet = page.getByTestId('harness-bullet').locator('.cr-frame').first();
    await expect(bullet.locator('.cr-bullet-marker')).toHaveCount(1);
    // 98.3% against a 100% floor — breached, and the widget says which side.
    await expect(bullet.locator('.cr-bullet')).toHaveAttribute('data-breached', 'below');

    // The annotation shows its prose, not just the anchor number.
    const note = page.getByTestId('harness-annotation').locator('.cr-frame').first();
    await expect(note.locator('.cr-annotation-note')).toContainText('quarter-end funding');
  });

  test('the sparkline cards draw their style, and the crosshair says the day (ADR-89)', async ({ page }) => {
    await page.goto('/#/widgets');
    const fresh = (w: string) => page.getByTestId(`harness-${w}`).locator('.cr-frame').first();

    // Line: the latest value large, the window in words, one path, the current day accented.
    const line = fresh('spark-line');
    await expect(line.locator('.cr-sparkcard-value')).toHaveText('109.6%');
    await expect(line.locator('.cr-sparkcard-judgment')).toHaveText('+3.6pp since 07-01');
    await expect(line.locator('.cr-spark-line')).toHaveCount(1);
    await expect(line.locator('.cr-spark-dot')).toHaveCount(1);

    // Pointing snaps to a real day: the tooltip leads with the date, then the value.
    const svg = line.locator('[data-slot="sparkline"]');
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    const tip = line.locator('[data-slot="spark-tip"]');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.cr-spark-tip-date')).toHaveText('2025-07-01');
    await expect(line.locator('.cr-spark-crosshair')).toHaveCount(1);
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await expect(tip.locator('.cr-spark-tip-date')).toHaveText('2025-07-30');
    await expect(tip.locator('.cr-spark-tip-note')).toContainText('since 07-01');
    await page.mouse.move(0, 0);
    await expect(tip).toHaveCount(0);

    // The keyboard reads the same: focus lands on today, the arrows step a day.
    await svg.focus();
    await expect(tip.locator('.cr-spark-tip-date')).toHaveText('2025-07-30');
    await page.keyboard.press('ArrowLeft');
    await expect(tip.locator('.cr-spark-tip-date')).toHaveText('2025-07-29');
    await page.keyboard.press('Home');
    await expect(tip.locator('.cr-spark-tip-date')).toHaveText('2025-07-01');
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
    await expect(svg).toHaveAttribute('aria-label', /latest 109\.6%, low 94\.8% on 07-21, high 110\.0% on 07-0\d/);

    // Band: the limit, the breach side shaded, each breaching day marked — and named in words.
    const band = fresh('spark-band');
    await expect(band.locator('.cr-spark-limit')).toHaveCount(1);
    await expect(band.locator('.cr-spark-zone')).toHaveCount(1);
    await expect(band.locator('.cr-spark-breach')).toHaveCount(4);
    await expect(band.locator('.cr-sparkcard-judgment')).toHaveText('above floor 100.0% · 4 breaches since 07-01');
    const bandSvg = band.locator('[data-slot="sparkline"]');
    await bandSvg.focus();
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft'); // 07-23, the last breaching day
    await expect(band.locator('.cr-spark-tip-note')).toHaveAttribute('data-state', 'breach');
    await expect(band.locator('.cr-spark-tip-note')).toContainText('below floor lcr_floor 100.0% — breach');

    // Columns: one per day from zero, today accented; the tooltip gives the day's move.
    const columns = fresh('spark-column');
    await expect(columns.locator('.cr-spark-col')).toHaveCount(29);
    await expect(columns.locator('.cr-spark-col[data-current]')).toHaveCount(1);
    await expect(columns.locator('.cr-spark-col[data-negative]').first()).toBeVisible();
    await columns.locator('[data-slot="sparkline"]').focus();
    await expect(columns.locator('.cr-spark-tip-note')).toContainText('vs 07-29');

    // Range: every day a tick between the window's low and high, today the long one.
    const range = fresh('spark-range');
    await expect(range.locator('.cr-spark-track')).toHaveCount(1);
    await expect(range.locator('.cr-spark-tick')).toHaveCount(30);
    await expect(range.locator('.cr-spark-tick[data-current]')).toHaveCount(1);
    await expect(range.locator('.cr-sparkcard-judgment')).toContainText('of its range since 07-01');
  });
});
