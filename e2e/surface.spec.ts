/**
 * The surface, driven end to end.
 *
 * The unit tests prove the engine. They cannot prove that the engine is wired
 * to anything — that a quick fix reaches the CodeMirror document rather than
 * React's mirror of it, that switching a tab swaps the validation column for
 * the right one, that a pill is actually a replace-widget and not styled text.
 * Every one of those has been a real defect in this build, and none of them is
 * visible from a `vitest` run.
 *
 * These run against the production bundle, because what ships is the thing
 * worth testing.
 */

import { expect, test, type Page } from '@playwright/test';

const EDITOR = '.cm-content';
const VALUE = '.mdl-value';

/**
 * Fail the test on anything the page logs as an error, not just on assertions.
 *
 * With one exception, and it is not a loosening: this suite runs the bundle with
 * no registry behind it, so the workspace probe to `/api/artifacts` is *expected*
 * to fail. That failure is the offline path being taken, which `persistence.spec`
 * covers from the other side. Everything else — including any page error — still
 * fails the test.
 */
async function watchConsole(page: Page): Promise<string[]> {
  const errors: string[] = [];

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // A resource-load failure does not name the URL in its text, so the filter
    // has to come off the message's location. Matching on the text alone would
    // have excused any 500 from anywhere.
    const url = m.location().url || '';
    if (/\/api\//.test(url) && /Failed to load resource/.test(m.text())) return;
    errors.push(`${m.text()} ${url}`.trim());
  });
  return errors;
}

async function openFile(page: Page, name: string) {
  await page.getByRole('button', { name: `${name}.yaml`, exact: false }).first().click();
  await expect(page.locator('.mdl-tab[data-current="true"]').first()).toContainText(name);
}

/** A measure in the registry tree, scoped past the file item that contains it. */
function measure(page: Page, name: string) {
  return page.locator('.mdl-tree-measure', { has: page.locator('.mdl-tree-name', { hasText: name }) });
}

/** The line holding a given snippet of the document. */
function line(page: Page, text: string) {
  return page.locator('.cm-line', { hasText: text }).first();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(EDITOR)).toBeVisible();
});

// ---------------------------------------------------------------------------

test.describe('boot', () => {
  test('renders the three columns with the calibrated figures', async ({ page }) => {
    await expect(page.locator('.mdl-col-registry')).toBeVisible();
    await expect(page.locator('.mdl-col-editor')).toBeVisible();
    await expect(page.locator('.mdl-col-validation')).toBeVisible();

    // The spec's headline numbers. If the fixture calibration drifts, the
    // surface is still "working" and completely wrong.
    await expect(page.locator('.mdl-col-registry')).toContainText('$284,120,000');
    await expect(page.locator(VALUE).first()).toHaveText('118.4%');
  });

  test('loads without a console error', async ({ page }) => {
    const errors = await watchConsole(page);
    await page.reload();
    await expect(page.locator(EDITOR)).toBeVisible();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('serves its own typeface rather than fetching one', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
        external.push(url);
      }
    });
    await page.reload();
    await expect(page.locator(EDITOR)).toBeVisible();

    expect(external, 'the prototype must run with no network').toEqual([]);
    // Tabular figures are what make the dense numeric columns scannable, so
    // Inter actually has to be the font in use, not just the one requested.
    await page.waitForFunction(() => document.fonts.check('600 24px Inter'));
  });

  test('renders references as pills, not as styled text', async ({ page }) => {
    const pill = page.locator('.cm-pill').first();
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('role', 'button');
    // A replace-widget occupies zero characters of the document, which is what
    // makes the range atomic. Styled text would still be selectable inside.
    expect(await page.locator('.cm-pill').count()).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------

test.describe('navigation', () => {
  test('opens a measure from the registry tree', async ({ page }) => {
    await measure(page, 'lcr_headroom').click();
    await expect(page.locator(VALUE).first()).toHaveText('$44,220,000');
    await expect(page.locator('.cm-mdl-active-line').first()).toBeVisible();
  });

  test('names a document by its own name, not by everything inside it', async ({ page }) => {
    // A treeitem takes its accessible name from its contents unless told
    // otherwise, which would make a document announce as every measure and
    // value it holds, read as one string.
    await expect(page.getByRole('treeitem', { name: 'liquidity_pit.yaml', exact: true })).toBeVisible();
    await expect(page.getByRole('group', { name: /liquidity_pit/ })).toBeVisible();
  });

  test('filters the tree', async ({ page }) => {
    const search = page.locator('.mdl-search');
    await search.fill('vol');
    await expect(measure(page, 'lcr_vol_30d')).toBeVisible();
    await expect(measure(page, 'hqla_total')).toHaveCount(0);
    await search.fill('');
    await expect(measure(page, 'hqla_total')).toBeVisible();
  });

  test('every document opens and shows the surface it needs', async ({ page }) => {
    await openFile(page, 'irrbb_eve');
    await expect(page.locator(VALUE).first()).toBeVisible();

    // A rule set is verified by coverage, not by a scalar.
    await openFile(page, 'fr2052a_product_id');
    await expect(page.locator('.mdl-col-validation')).toContainText('Coverage');

    // A rate table is verified by the assumptions it states.
    await openFile(page, 'lcr_outflow_rates');
    await expect(page.locator('.mdl-col-validation')).toContainText('Assumptions');

    await openFile(page, 'fr2052a_outflows');
    await expect(page.locator(VALUE).first()).toBeVisible();

    // A report is verified by the rows that would be filed.
    await openFile(page, 'fr2052a_submission');
    await expect(page.locator('.mdl-col-validation')).toContainText('Rows to file');

    // A monitor is verified by what its thresholds did.
    await openFile(page, 'fr2052a_variance');
    await expect(page.locator('.mdl-col-validation')).toContainText('Per threshold');
  });
});

// ---------------------------------------------------------------------------

test.describe('the loop', () => {
  test('an edit moves the number', async ({ page }) => {
    await measure(page, 'lcr_buffer').click();
    await expect(page.locator(VALUE).first()).toHaveText('124.0%');

    // `lcr_buffer` is `lcr_pct * 1.0473`. Change the coefficient and the value
    // has to follow within the same loop.
    await line(page, '* 1.0473').click();
    await page.keyboard.press('End');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type('2.0');

    // 236.9%, not 236.8% — the coefficient multiplies the full-precision ratio
    // rather than the 118.4% the panel rounds it to for display.
    await expect(page.locator(VALUE).first()).toHaveText('236.9%');
  });

  test('a broken expression holds the last good value rather than blanking', async ({ page }) => {
    await measure(page, 'lcr_buffer').click();
    await line(page, '* 1.0473').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' *');

    // §8.6: an author needs to remember what the number was to judge what it
    // becomes, so the panel holds it dimmed rather than showing an em dash.
    await expect(page.locator(VALUE).first()).toHaveText('124.0%');
    await expect(page.locator('.mdl-col-validation')).toContainText(/out of date/);
  });

  test('switching the test data moves every number', async ({ page }) => {
    const value = page.locator(VALUE).first();
    await expect(value).toHaveText('118.4%');
    await page.locator('#mdl-fixture').selectOption('stress');
    await expect(value).not.toHaveText('118.4%');
    await page.locator('#mdl-fixture').selectOption('nominal');
    await expect(value).toHaveText('118.4%');
  });

  test('reports the real loop time, not a placeholder', async ({ page }) => {
    await expect(page.locator('.mdl-problems-bar')).toContainText(/updated in \d+ms/);
  });
});

// ---------------------------------------------------------------------------

test.describe('problems and fixes', () => {
  test('lists diagnostics with their codes and lines', async ({ page }) => {
    const problems = page.locator('.mdl-problem');
    expect(await problems.count()).toBeGreaterThan(0);
    await expect(problems.first().locator('.mdl-problem-code')).toHaveText(/KEEL\d{3}/);
  });

  test('a fix edits the document and clears the diagnostic it came from', async ({ page }) => {
    const first = page.locator('.mdl-problem').first();
    const code = (await first.locator('.mdl-problem-code').textContent())!;
    const where = (await first.locator('.mdl-problem-where').textContent())!;
    const identity = `${code} ${where}`;

    const problems = () =>
      page.locator('.mdl-problem').evaluateAll((els) =>
        els.map(
          (e) =>
            `${e.querySelector('.mdl-problem-code')?.textContent} ` +
            `${e.querySelector('.mdl-problem-where')?.textContent}`,
        ),
      );

    expect(await problems()).toContain(identity);
    const textBefore = await page.locator(EDITOR).innerText();

    await first.locator('.mdl-fix').click();

    // The fix has to reach the CodeMirror document. Routing it through React's
    // copy of the text was a real defect: the strip cleared, the editor did not.
    expect(await page.locator(EDITOR).innerText()).not.toBe(textBefore);
    // A fix may legitimately surface a new problem — an inserted stub still
    // needs filling in. What it may not do is leave the one it answered.
    await expect.poll(problems).not.toContain(identity);

    // And it has to be undoable as one edit.
    await page.locator(EDITOR).click();
    await page.keyboard.press('Control+z');
    await expect.poll(problems).toContain(identity);
    expect(await page.locator(EDITOR).innerText()).toBe(textBefore);
  });

  test('clicking a problem moves the cursor to its line', async ({ page }) => {
    await page.locator('.mdl-problem-where').first().click();
    await expect(page.locator('.cm-mdl-active-line').first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe('the compiled plan', () => {
  test('shows a plan for every execution target', async ({ page }) => {
    await openFile(page, 'fr2052a_submission');

    await page.getByRole('tab', { name: 'SQL' }).click();
    const sql = page.locator('.mdl-plan');
    await expect(sql).toContainText('WITH base AS');
    await expect(sql).toContainText('12 CFR 249.32');

    await page.getByRole('tab', { name: 'Polars' }).click();
    await expect(page.locator('.mdl-plan')).toContainText('import polars as pl');

    await page.getByRole('tab', { name: 'PySpark' }).click();
    await expect(page.locator('.mdl-plan')).toContainText('from pyspark.sql import functions as F');
  });

  test('lists what it files, and opens each where it is defined', async ({ page }) => {
    await openFile(page, 'fr2052a_submission');

    // A report's measures live in its view, not in the report. Counting two
    // in the header and showing none beneath reads as a bug, because it is one.
    await expect(measure(page, 'weighted_outflows_30d')).toBeVisible();
    await measure(page, 'weighted_outflows_30d').click();

    // Following the reference has to land in the *other* document, with the
    // editor mounted and scrolled to the definition.
    await expect(page.locator('.mdl-tab[data-current="true"]').first())
      .toContainText('fr2052a_outflows');
    await expect(page.locator(EDITOR)).toContainText('weighted_outflows_30d');
    await expect(page.locator('.cm-mdl-active-line').first()).toBeVisible();
  });

  test('files rows at the grain of the form', async ({ page }) => {
    await openFile(page, 'fr2052a_submission');
    await expect(page.locator('.mdl-col-validation')).toContainText('reg.fr2052a_daily');
    expect(await page.locator('.mdl-report-row').count()).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------

test.describe('classification', () => {
  test('shows which rule fired and how much notional it moved', async ({ page }) => {
    await openFile(page, 'fr2052a_product_id');
    const column = page.locator('.mdl-col-validation');
    await expect(column).toContainText('O.D.1');
    await expect(column).toContainText(/\$[\d,]+/);
  });

  test('an unmapped segment surfaces on the tricky fixture', async ({ page }) => {
    await openFile(page, 'fr2052a_product_id');
    await page.locator('#mdl-fixture').selectOption('edge');
    // The `edge` fixture carries a PUBLIC_SECTOR segment no rule matches, and
    // the rule set has no blind catch-all to absorb it.
    await expect(page.locator('.mdl-col-validation')).toContainText(/unmapped|no rule|Unmatched|unmatched/i);
  });
});

// ---------------------------------------------------------------------------

test.describe('every combination', () => {
  test('each document survives each fixture', async ({ page }) => {
    const errors = await watchConsole(page);
    const files = [
      'liquidity_pit', 'irrbb_eve', 'fr2052a_product_id',
      'lcr_outflow_rates', 'fr2052a_outflows', 'fr2052a_submission',
      'fr2052a_variance',
    ];

    // Eighteen combinations, and the ones that break are never the ones you
    // check by hand — `edge` carries zeros, nulls and a segment no rule maps,
    // which is exactly what a division or a lookup falls over on.
    for (const f of files) {
      await openFile(page, f);
      for (const fixture of ['nominal', 'edge', 'stress']) {
        await page.locator('#mdl-fixture').selectOption(fixture);
        await expect(page.locator('.mdl-col-validation')).toBeVisible();
        await expect(page.locator(EDITOR)).toBeVisible();
        // A surface that renders nothing is not a surface that survived.
        expect(
          (await page.locator('.mdl-col-validation').innerText()).length,
          `${f} on ${fixture}`,
        ).toBeGreaterThan(40);
      }
    }

    expect(errors).toEqual([]);
  });
});

test.describe('variance', () => {
  test('reports what each threshold did, not just the alerts', async ({ page }) => {
    await openFile(page, 'fr2052a_variance');
    const column = page.locator('.mdl-col-validation');

    // The "no threshold" column is the point: a monitor with no breaches and a
    // monitor with no coverage look identical without it.
    await expect(column).toContainText('no threshold');
    await expect(column).toContainText('HARD-USD');
    await expect(column).toContainText('SIGMA-30');
    await expect(column).toContainText('Worst first');
  });

  test('shows a plan for every execution target', async ({ page }) => {
    await openFile(page, 'fr2052a_variance');

    await page.getByRole('tab', { name: 'SQL' }).click();
    const sql = page.locator('.mdl-plan');
    // The frame that excludes today is the single most consequential detail.
    await expect(sql).toContainText('ROWS BETWEEN 30 PRECEDING AND 1 PRECEDING');
    await expect(sql).toContainText('STDDEV_SAMP');

    await page.getByRole('tab', { name: 'Polars' }).click();
    await expect(page.locator('.mdl-plan')).toContainText('rolling_std');

    await page.getByRole('tab', { name: 'PySpark' }).click();
    await expect(page.locator('.mdl-plan')).toContainText('rowsBetween(-30, -1)');
  });

  test('says so when a threshold stops firing', async ({ page }) => {
    await openFile(page, 'fr2052a_variance');
    await expect(page.locator('.mdl-problem', { hasText: 'KEEL095' })).toHaveCount(0);

    // Push the hard limit far out of reach. The control is now silent, and
    // silence has to be reported rather than read as health.
    await line(page, 'limit: 1000000').click();
    await page.keyboard.press('End');
    await page.keyboard.type('00');

    await expect(page.locator('.mdl-problem', { hasText: 'KEEL095' })).toBeVisible();
    await expect(page.locator('.mdl-problem', { hasText: 'KEEL095' })).toContainText('never fires');
  });
});

test.describe('layout', () => {
  test('remembers a resized column across a reload', async ({ page }) => {
    const registry = page.locator('.mdl-col-registry');
    const before = (await registry.boundingBox())!.width;

    const handle = page.getByRole('separator', { name: 'Resize measures panel' });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await registry.boundingBox())!.width;
    expect(Math.abs(after - before)).toBeGreaterThan(40);

    await page.reload();
    await expect(page.locator(EDITOR)).toBeVisible();
    expect(Math.abs((await registry.boundingBox())!.width - after)).toBeLessThan(4);
  });
});
