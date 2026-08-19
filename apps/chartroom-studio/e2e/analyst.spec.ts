/**
 * The v2 analyst surface: the board opens read-only under a stated scope, and
 * authoring is a mode you switch into.
 *
 * The assertions that matter here are the ones that would still pass if the
 * controls were painted on. As-of has to change the number *and* the date the
 * frame reports; the explain drawer has to carry the contract's real lineage;
 * the palette has to actually navigate. A control that renders but does not
 * resolve is the exact failure this suite exists to catch.
 */

import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8788';
const HUMAN = { 'content-type': 'application/json', 'x-identity': 'studio-author' };

/*
 * A board that declares a context param and also carries a dangling one. The
 * first gives the context bar something real to bind a chip to; the second is
 * a CTX-01 BLOCK, which is what puts a row in the exception strip. Both come
 * from the spec's own structure, so neither depends on which contracts happen
 * to be approved in the shipped documents.
 */
const SCOPED = {
  chartroom: '0.1',
  dashboard: {
    id: 'scoped-board', title: 'Scoped board',
    pattern: { none: { justification: 'analyst surface e2e fixture' } },
    audience: 'alm-analyst', cadence: 'eod', status: 'draft',
  },
  context: { entity: { dim: 'entity_id', default: 'BANK_US' } },
  layout: { grid: { cols: 12, row_height: 96 } },
  widgets: [
    {
      id: 'scoped-tile', type: 'kpi-tile@1', title: 'HQLA, scoped',
      pos: { x: 0, y: 0, w: 3, h: 2 },
      bind: {
        metric: 'keel://liquidity_pit.hqla_total@1',
        filters: [{ dim: 'entity_id', op: '=', param: 'entity' }],
      },
    },
    {
      id: 'dangling-tile', type: 'kpi-tile@1', title: 'Bound to a context nobody declared',
      pos: { x: 3, y: 0, w: 3, h: 2 },
      bind: {
        metric: 'keel://liquidity_pit.hqla_total@1',
        filters: [{ dim: 'desk_id', op: '=', param: 'desk' }],
      },
    },
  ],
  interactions: [],
};

/*
 * Seeded before any page loads, not inside the tests that use it. The studio
 * fetches the dashboard list once on mount, and `goto('/#/author')` from `/`
 * is a same-document hash change — no reload, so no refetch. A board created
 * after the first navigation would never reach the sidebar.
 */
test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  await request.post(`${API}/api/dashboards`, {
    headers: HUMAN, data: { id: 'scoped-board', title: 'Scoped board' },
  });
  const saved = await request.post(`${API}/api/dashboards/scoped-board/versions`, {
    headers: HUMAN, data: { spec: SCOPED, expectedVersion: null },
  });
  expect([200, 201]).toContain(saved.status());
  await request.dispose();
});

/*
 * Open the monitor through the sidebar, then drop into read mode. Read mode
 * has no dashboard list by design — ⌘K is its navigation — and other specs
 * seed boards that sort ahead of this one, so picking it explicitly is what
 * makes the rest of the file deterministic.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/#/author');
  await page.getByTestId('dash-lcr-monitor').click();
  await expect(page.getByTestId('widget-lcr-tile')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
});

test.describe('read mode is the default', () => {
  test('/ opens on the analyst surface, with no authoring panes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('canvas')).toBeVisible();
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
    await expect(page.getByTestId('mode-toggle')).toHaveText('Read');
    await expect(page.getByTestId('analyst-bar')).toBeVisible();
  });

  test('the mode toggle brings the authoring panes back, and the mode survives a reload', async ({ page }) => {
    await page.getByTestId('mode-toggle').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('mode-toggle')).toHaveText('Author');
    // The mode is a route, so it survives a reload rather than resetting.
    await page.reload();
    await expect(page.getByTestId('sidebar')).toBeVisible();
  });
});

test.describe('the scope actually resolves', () => {
  test('as-of moves every frame to that date, and the numbers move with it', async ({ page }) => {
    const tile = page.getByTestId('widget-lcr-tile');
    await expect(tile).toHaveAttribute('data-status', 'fresh');
    const latest = await tile.locator('.cr-kpi-value').textContent();
    const latestDate = await tile.locator('.cr-frame-asof').textContent();

    // Two weeks back — far enough that the fixture series has moved.
    // Options render latest-first, so index 14 is a fortnight back.
    const options = await page.getByTestId('as-of').locator('option').all();
    const values = await Promise.all(options.map((o) => o.getAttribute('value')));
    const earlier = values[14] as string;
    await page.getByTestId('as-of').selectOption(earlier);

    // The frame reports the date it was evaluated at, not the one requested —
    // and here they agree, which is what makes the number trustworthy.
    await expect(tile.locator('.cr-frame-asof')).toHaveText(earlier);
    expect(earlier).not.toBe(latestDate);
    await expect(tile).toHaveAttribute('data-status', 'fresh');
    await expect(tile.locator('.cr-kpi-value')).not.toHaveText(latest!);

    // The scope strip says what you are reading, and offers the way back.
    await expect(page.getByTestId('scope-label')).toContainText(earlier);
    await expect(page.getByTestId('slo')).toContainText('behind close');
    await page.getByTestId('scope-reset').click();
    await expect(tile.locator('.cr-kpi-value')).toHaveText(latest!);
    await expect(page.getByTestId('slo')).toHaveText('at latest close');
  });

  test('the basis changes the delta without changing the value', async ({ page }) => {
    const tile = page.getByTestId('widget-lcr-tile');
    await expect(tile).toHaveAttribute('data-status', 'fresh');
    const value = await tile.locator('.cr-kpi-value').textContent();

    await page.getByTestId('basis').selectOption('month_end');
    await expect(tile).toHaveAttribute('data-status', 'fresh');
    // Same as-of, so the headline is the same number read against a further
    // reference point — if the value moved, the basis is filtering, not comparing.
    await expect(tile.locator('.cr-kpi-value')).toHaveText(value!);
  });
});

test.describe('exceptions are derived, not decorative', () => {
  test('a clean board says so rather than showing an empty strip', async ({ page }) => {
    // The seeded monitor lints clean, and the control is calm rather than an
    // alert with a zero in it.
    await expect(page.getByTestId('exceptions-toggle')).toHaveAttribute('data-clean', 'true');
    await expect(page.getByTestId('exceptions-panel')).toHaveCount(0);
  });

  test('the strip carries the lint report, and acknowledging hides only that row', async ({ page }) => {
    await page.goto('/#/author');
    await page.getByTestId('dash-scoped-board').click();
    await expect(page.getByTestId('widget-scoped-tile')).toBeVisible();
    await page.keyboard.press('r');

    const panel = page.getByTestId('exceptions-panel');
    await expect(panel).toBeVisible();
    // Two BLOCKs and two WARNs on this fixture; SUGGEST findings are excluded
    // by design, so the strip is not the findings tab with a border on it.
    const rows = panel.locator('.cr-exception');
    await expect(rows).toHaveCount(4);
    await expect(page.getByTestId('exceptions-toggle')).toContainText('4');

    // Blockers sort first, and each row names the rule that produced it — so
    // it is traceable back to the findings tab rather than being a label
    // invented for the strip.
    await expect(rows.nth(0)).toHaveAttribute('data-tone', 'danger');
    await expect(rows.nth(0).locator('.cr-exception-code')).toHaveText('REF-01');
    await expect(rows.nth(1).locator('.cr-exception-code')).toHaveText('CTX-01');
    await expect(rows.nth(1)).toContainText('desk');
    await expect(rows.nth(3)).toHaveAttribute('data-tone', 'warning');

    // Acknowledging retires exactly one row and leaves the rest standing.
    await rows.nth(0).locator('.cr-exception-ack').click();
    await expect(panel.locator('.cr-exception')).toHaveCount(3);
    await expect(page.getByTestId('exceptions-toggle')).toContainText('3');
  });

  test('e hides the strip', async ({ page }) => {
    await page.goto('/#/author');
    await page.getByTestId('dash-scoped-board').click();
    await expect(page.getByTestId('exceptions-panel')).toBeVisible();
    await page.keyboard.press('e');
    await expect(page.getByTestId('exceptions-panel')).toHaveCount(0);
  });
});

test.describe('the context bar', () => {
  test('a declared context param becomes a chip whose values come from the data', async ({ page }) => {
    await page.goto('/#/author');
    await page.getByTestId('dash-scoped-board').click();

    const tile = page.getByTestId('widget-scoped-tile');
    await expect(tile).toHaveAttribute('data-status', 'fresh');
    const scoped = await tile.locator('.cr-kpi-value').textContent();

    // The options are the entities the warehouse actually holds, not a list
    // typed into the studio.
    const chip = page.getByTestId('ctx-entity');
    await expect(chip.locator('option')).toContainText(['BANK_DE']);

    await chip.selectOption('BANK_DE');
    await expect(page.getByTestId('scope-label')).toContainText('BANK_DE');
    await expect(tile).toHaveAttribute('data-status', 'fresh');
    // A different entity is a different number — the chip resolves.
    await expect(tile.locator('.cr-kpi-value')).not.toHaveText(scoped!);
  });
});

test.describe('explain', () => {
  test('the drawer carries the real contract lineage and the compiled query', async ({ page }) => {
    await page.getByTestId('explain-lcr-tile').click();
    const drawer = page.getByTestId('explain-drawer');
    await expect(drawer).toBeVisible();

    // The headline the frame shows, at full precision beside it.
    await expect(page.getByTestId('explain-value')).toHaveText(/\d/);
    // Lineage from the registry: the owning document and its governance state.
    await expect(drawer).toContainText('document:');
    await expect(drawer).toContainText('governance:');
    // The aggregates-only boundary is stated where a reader would look for rows.
    await expect(drawer).toContainText('Aggregates only');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('explain-drawer')).toHaveCount(0);
  });
});

test.describe('the command palette', () => {
  test('⌘K opens, filters and navigates', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();

    await page.getByTestId('palette-query').fill('limit');
    await expect(page.getByTestId('palette-item-0')).toContainText('Limit');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    // It really opened the other board.
    await expect(page.locator('.cr-header-title')).toContainText('Limit');
  });
});

test.describe('changes', () => {
  test('the modal reports a semantic diff against the saved version', async ({ page }) => {
    await page.getByTestId('mode-toggle').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await page.getByTestId('open-changes').click();

    const modal = page.getByTestId('changes-modal');
    await expect(modal).toBeVisible();
    // Untouched board: nothing to report, said plainly.
    await expect(page.getByTestId('changes-empty')).toBeVisible();
    await expect(page.getByTestId('changes-count')).toHaveText('0 changes');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('changes-modal')).toHaveCount(0);
  });
});
