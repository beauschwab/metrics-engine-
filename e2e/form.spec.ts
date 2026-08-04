/**
 * Form mode — the same document, edited through controls.
 *
 * The guarantee this mode makes is a round trip: build a rule in the form, flip
 * to YAML, and read exactly what you produced. So the assertions that matter
 * are the ones that cross the boundary — an edit made with a select, read back
 * as text — rather than ones that only check a control rendered.
 *
 * `form.test.ts` proves the document operations. These prove they are wired to
 * something, which is the half a vitest run cannot see.
 */

import { expect, test, type Page } from '@playwright/test';

const FORM = '[data-testid="mdl-form"]';
const EDITOR = '.cm-content';

async function openYaml(page: Page) {
  await page.locator('.mdl-modeswitch[data-mode="yaml"]').click();
  await expect(page.locator(EDITOR)).toBeVisible();
}

async function openForm(page: Page) {
  await page.locator('.mdl-modeswitch[data-mode="form"]').click();
  await expect(page.locator(FORM)).toBeVisible();
}

/** A measure in the registry tree, scoped past the file item that holds it. */
function measure(page: Page, name: string) {
  return page.locator('.mdl-tree-measure', {
    has: page.locator('.mdl-tree-name', { hasText: name }),
  });
}

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(FORM)).toBeVisible();
});

// ---------------------------------------------------------------------------

test.describe('the two modes', () => {
  test('opens in form mode, because that is the one needing no YAML', async ({ page }) => {
    await expect(page.locator(FORM)).toBeVisible();
    await expect(page.locator(EDITOR)).toHaveCount(0);
  });

  test('unmounts the other mode rather than hiding it', async ({ page }) => {
    // A CodeMirror instance parked behind the form still holds a document and
    // still fires effects — two surfaces owning one document is how they drift.
    await openYaml(page);
    await expect(page.locator(FORM)).toHaveCount(0);
    await openForm(page);
    await expect(page.locator(EDITOR)).toHaveCount(0);
  });

  test('remembers the choice across a reload', async ({ page }) => {
    await openYaml(page);
    await page.reload();
    await expect(page.locator(EDITOR)).toBeVisible();
    await expect(page.locator(FORM)).toHaveCount(0);
  });
});

test.describe('the rule, in English', () => {
  test('restates a column-reading measure with its value', async ({ page }) => {
    await measure(page, 'hqla_total').click();
    await expect(page.getByTestId('mdl-form-sentence')).toHaveText(
      'Adds up hqla_eligible_amount, counting only rows where is_encumbered = false. '
      + 'Shown as $284,120,000.',
    );
  });

  test('rewrites itself when the rule changes', async ({ page }) => {
    // The sentence is the check: an author who reads it back and finds it says
    // something they did not mean has caught their own mistake without running
    // anything.
    await measure(page, 'hqla_total').click();
    await field(page, 'How rows are combined').selectOption('avg');
    await expect(page.getByTestId('mdl-form-sentence')).toContainText('Averages hqla_eligible_amount');
  });

  test('names the kind in the badge, not in a type token', async ({ page }) => {
    await measure(page, 'hqla_total').click();
    await expect(page.locator('.mdl-form-badge')).toHaveText('Reads a column');
    await measure(page, 'lcr_pct').click();
    await expect(page.locator('.mdl-form-badge')).toHaveText('Combines measures');
    await measure(page, 'lcr_vol_30d').click();
    await expect(page.locator('.mdl-form-badge')).toHaveText('Looks across dates');
  });
});

test.describe('the round trip', () => {
  test('an edit made in the form is the text the editor shows', async ({ page }) => {
    // The whole guarantee in one assertion.
    await measure(page, 'hqla_total').click();
    await field(page, 'Display name').fill('Eligible HQLA, post-haircut');
    await openYaml(page);
    await expect(page.locator(EDITOR)).toContainText('Eligible HQLA, post-haircut');
  });

  test('keeps the measure intact, list marker and all', async ({ page }) => {
    // Writing `  - name:` back without the `- ` deletes the measure and spills
    // its fields into the one above. The document still parses, so nothing
    // announces the loss — the count is what catches it.
    const before = await page.locator('.mdl-tree-measure').count();
    await measure(page, 'hqla_total').click();
    await field(page, 'Display name').fill('Changed');
    await expect(page.locator('.mdl-tree-measure')).toHaveCount(before);
    await expect(page.locator('.mdl-value').first()).toHaveText('$284,120,000');
  });

  test('a select writes YAML the parser reads back', async ({ page }) => {
    await measure(page, 'hqla_total').click();
    await field(page, 'How the number is shown').selectOption('currency_usd_mm');
    await expect(page.locator('.mdl-value').first()).toHaveText('$284.1M');
    await openYaml(page);
    await expect(page.locator(EDITOR)).toContainText('format: currency_usd_mm');
  });
});

test.describe('the condition builder', () => {
  test('offers only values the test data actually holds', async ({ page }) => {
    // The commonest silent error in metric authoring is a predicate matching
    // nothing — `'Retail'` against a book that says `'RETAIL'` — and it returns
    // a confident zero rather than an error.
    await measure(page, 'hqla_total').click();
    const value = page.getByLabel('Value', { exact: true });
    await expect(value).toBeVisible();
    const options = await value.locator('option').allTextContents();
    expect(options.join(' ')).toMatch(/false/);
    expect(options.join(' ')).toMatch(/true/);
  });

  test('adds and removes a condition, and the number follows', async ({ page }) => {
    await measure(page, 'hqla_total').click();
    const before = await page.locator('.mdl-value').first().textContent();

    await page.getByRole('button', { name: '+ Add a condition' }).click();
    await expect(page.locator('.mdl-condition')).toHaveCount(2);

    await page.getByRole('button', { name: 'Remove condition' }).last().click();
    await expect(page.locator('.mdl-condition')).toHaveCount(1);
    await expect(page.locator('.mdl-value').first()).toHaveText(before || '');
  });

  test('shows a hand-written filter read-only rather than rewriting it', async ({ page }) => {
    // A clause with `in` has no faithful row form. Approximating it would change
    // what the measure counts, silently.
    await openYaml(page);
    await page.locator('.cm-line', { hasText: 'where:' }).first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(" and entity_id in ('BANK_US')");
    await openForm(page);

    await expect(page.getByTestId('mdl-advanced-filter')).toBeVisible();
    await expect(page.getByTestId('mdl-advanced-filter')).toContainText('in (');
    await expect(page.locator('.mdl-form-card')).toContainText('switch to YAML to change it');
  });
});

test.describe('the formula builder', () => {
  test('renders the expression as chips, one per token', async ({ page }) => {
    await measure(page, 'lcr_pct').click();
    const chips = page.locator('[data-testid="mdl-formula"] .mdl-chip');
    await expect(chips.filter({ hasText: 'hqla_total' })).toHaveCount(1);
    await expect(chips.filter({ hasText: 'ƒnullif' })).toHaveCount(1);
  });

  test('clicking a chip removes that token', async ({ page }) => {
    await measure(page, 'lcr_pct').click();
    const chips = page.locator('[data-testid="mdl-formula"] .mdl-chip');
    const before = await chips.count();
    await chips.first().click();
    await expect(chips).toHaveCount(before - 1);
  });

  test('a palette click appends, and the YAML shows it', async ({ page }) => {
    await measure(page, 'lcr_pct').click();
    await page.locator('.mdl-palette').getByRole('button', { name: '+', exact: true }).click();
    await openYaml(page);
    // The editor renders references as replace-widgets, so its text carries the
    // pill glyphs rather than the raw identifiers. Asserting on what is on
    // screen is the point — this is the round trip a user actually reads.
    await expect(page.locator(EDITOR)).toContainText('ƒnullif(⟨net_cash_outflows_30d⟩, 0) +');
  });
});

test.describe('validation, attached to the field it is about', () => {
  test('puts a missing description under Description, not in a banner', async ({ page }) => {
    await measure(page, 'lcr_pct').click();
    const note = page.locator('.mdl-f', { hasText: 'Description' }).locator('.mdl-note');
    await expect(note).toContainText('KEEL030');
    await expect(note).toContainText('needs a description');
  });

  test('marks the field itself, so the eye finds it before it reads', async ({ page }) => {
    await measure(page, 'lcr_pct').click();
    await expect(page.locator('.mdl-f[data-invalid="true"]').first()).toContainText('Description');
  });

  test('offers the specific fix, not a generic one', async ({ page }) => {
    await measure(page, 'lcr_pct').click();
    const fix = page.locator('.mdl-f', { hasText: 'Description' }).getByRole('button');
    await expect(fix).toHaveText('Insert stub');

    await fix.click();
    // And it actually edits the document rather than only clearing the note.
    await openYaml(page);
    await expect(page.locator(EDITOR)).toContainText('description: TODO');
  });

  test('says so when there is nothing to fix', async ({ page }) => {
    // A card with nothing under it reads as "not checked yet" unless it says
    // otherwise.
    await measure(page, 'hqla_total').click();
    await expect(page.locator('.mdl-form-clean')).toHaveText('✓ Nothing to fix');
  });
});

test.describe('renaming', () => {
  test('commits on Enter and carries every reference with it', async ({ page }) => {
    // A rename that rewrites only the name line leaves downstream measures
    // pointing at something that no longer exists. The document still parses.
    await measure(page, 'hqla_total').click();
    await field(page, 'Name').fill('eligible_hqla');
    await field(page, 'Name').press('Enter');

    await openYaml(page);
    await expect(page.locator(EDITOR)).toContainText('name: eligible_hqla');
    // In other measures too — a rename that touched only the name line would
    // leave these pointing at something that no longer exists, and the document
    // would still parse.
    await expect(page.locator(EDITOR)).toContainText('requires: [⟨eligible_hqla⟩');
    await expect(page.locator(EDITOR)).toContainText('100.0 * ⟨eligible_hqla⟩ /');
    await expect(page.locator(EDITOR)).not.toContainText('⟨hqla_total⟩');
  });

  test('reverts on Escape without touching the document', async ({ page }) => {
    await measure(page, 'hqla_total').click();
    await field(page, 'Name').fill('something_else');
    await field(page, 'Name').press('Escape');
    await expect(field(page, 'Name')).toHaveValue('hqla_total');
    await openYaml(page);
    await expect(page.locator(EDITOR)).toContainText('name: hqla_total');
  });
});

test.describe('the kind switch', () => {
  test('swaps which fields the card shows', async ({ page }) => {
    await measure(page, 'hqla_total').click();
    await expect(field(page, 'Column to read')).toBeVisible();

    await page.getByRole('button', { name: /Combine measures/ }).click();
    await expect(page.getByTestId('mdl-formula')).toBeVisible();
    await expect(field(page, 'Column to read')).toHaveCount(0);
  });

  test('hides the rule reference until the measure is under oversight', async ({ page }) => {
    // A citation field on an exploratory metric is a question nobody needs to
    // answer.
    await measure(page, 'gross_outflows_30d').click();
    await expect(field(page, 'Rule it comes from')).toHaveCount(0);

    await field(page, 'Oversight level').selectOption('1');
    await expect(field(page, 'Rule it comes from')).toBeVisible();
  });
});
