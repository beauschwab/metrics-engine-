/**
 * The editor itself.
 *
 * This is the half of the prototype that no unit test can reach. A pill is a
 * CodeMirror replace-widget backed by an atomic range: it has to delete as one
 * unit, reveal its text when the cursor needs to be inside it, and put that
 * text back when the cursor leaves. Every one of those is a decoration/state
 * interaction that only exists once a real editor is mounted in a real
 * document, and every one of them broke at least once getting here.
 */

import { expect, test, type Page } from '@playwright/test';

const EDITOR = '.cm-content';

function line(page: Page, text: string) {
  return page.locator('.cm-line', { hasText: text }).first();
}

function measure(page: Page, name: string) {
  return page.locator('.mdl-tree-measure', { has: page.locator('.mdl-tree-name', { hasText: name }) });
}

/**
 * These specs drive the YAML editor, so they say so.
 *
 * Form mode is the default now — the mode that needs no YAML is the one a new
 * author should meet first — and every spec here was implicitly relying on the
 * text editor being the only surface. Switching explicitly is the honest fix:
 * a test that reaches for `.cm-content` is a test about the text editor.
 */
async function openYaml(page: Page) {
  await page.locator('.mdl-modeswitch[data-mode="yaml"]').click();
  await expect(page.locator(EDITOR)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await openYaml(page);
});

// ---------------------------------------------------------------------------

test.describe('pills', () => {
  test('carry their state in the class, so colour is derived not decorative', async ({ page }) => {
    await expect(page.locator('.cm-pill-resolved').first()).toBeVisible();

    // The state switcher is the design's own demonstration surface — every
    // state has to be reachable and has to actually change the rendering.
    for (const state of ['unresolved', 'deprecated', 'restricted', 'stale', 'circular']) {
      await page.locator('#mdl-state').selectOption(state);
      await expect(page.locator(`.cm-pill-${state}`).first()).toBeVisible();
    }
    await page.locator('#mdl-state').selectOption('resolved');
  });

  test('cross and delete as one unit rather than a character at a time', async ({ page }) => {
    await measure(page, 'lcr_buffer').click();
    await line(page, '* 1.0473').click();

    // Read the document off the rendered lines rather than `innerText`, which
    // inserts its own artefacts around widgets and blank lines.
    const doc = () =>
      page.locator('.cm-line').evaluateAll((els) => els.map((e) => e.textContent).join('\n'));
    const before = await doc();
    expect(before).toContain('⟨lcr_pct⟩ * 1.0473');

    // Home lands at the first non-space character, which is the start of the
    // pill. One ArrowRight has to clear the whole reference — if the range
    // were not atomic the cursor would stop between `l` and `c`.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Backspace');

    const after = await doc();
    expect(after).toContain(' * 1.0473');
    // A half-eaten `lcr_pc` is the failure this exists to catch.
    expect(after).not.toMatch(/lcr_pc(?!t)/);

    // And the whole reference comes back as one undo, not seven.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(doc).toContain('⟨lcr_pct⟩ * 1.0473');
  });

  test('reveal their text when opened, and take an edit', async ({ page }) => {
    await measure(page, 'lcr_buffer').click();
    const target = line(page, '* 1.0473');
    await target.click();

    const pill = target.locator('.cm-pill').first();
    await expect(pill).toBeVisible();
    await pill.dblclick();

    // Opening a pill puts the raw name back in the document so it can be
    // edited. Without this the atomic range makes the name unreachable — the
    // cursor can never get inside it.
    await expect(target).toContainText('lcr_pct');
    await expect(target.locator('.cm-pill')).toHaveCount(0);
  });

  test('peek opens the definition inline without leaving the line', async ({ page }) => {
    await measure(page, 'lcr_buffer').click();
    const pill = line(page, '* 1.0473').locator('.cm-pill').first();
    await pill.click({ modifiers: ['Alt'] });

    // A block widget from a ViewPlugin used to wipe the whole decoration set;
    // the peek pane has to come from a StateField, and the pills have to
    // survive it.
    await expect(page.locator('.cm-mdl-peek, .mdl-peek').first()).toBeVisible();
    expect(await page.locator('.cm-pill').count()).toBeGreaterThan(3);
  });

  test('command-click navigates to the definition', async ({ page }) => {
    await measure(page, 'lcr_buffer').click();
    const pill = line(page, '* 1.0473').locator('.cm-pill').first();
    await pill.click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.mdl-value').first()).toHaveText('118.4%');
  });
});

// ---------------------------------------------------------------------------

test.describe('keyboard', () => {
  test('⌘↑ and ⌘↓ move between measures', async ({ page }) => {
    await measure(page, 'hqla_total').click();
    await page.locator(EDITOR).click();
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    await expect(page.locator('.mdl-value').first()).toHaveText('$312,400,000');
    await page.keyboard.press('ControlOrMeta+ArrowUp');
    await expect(page.locator('.mdl-value').first()).toHaveText('$284,120,000');
  });

  test('⌘N inserts a measure template', async ({ page }) => {
    const before = await page.locator('.mdl-tree-measure').count();
    await page.locator(EDITOR).click();
    await page.keyboard.press('ControlOrMeta+n');
    await expect(page.locator('.mdl-tree-measure')).toHaveCount(before + 1);
  });

  test('⌘. opens the action menu for what the cursor is on', async ({ page }) => {
    await measure(page, 'lcr_buffer').click();
    await line(page, '* 1.0473').click();
    await page.keyboard.press('ControlOrMeta+Period');
    const menu = page.locator('.cm-mdl-actions, .mdl-actions, [role="menu"]').first();
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});

// ---------------------------------------------------------------------------

test.describe('completion', () => {
  test('offers values that exist in the data for a where clause', async ({ page }) => {
    await measure(page, 'hqla_total').click();
    const where = line(page, 'where:');
    await where.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' and entity_id = ');

    const options = page.locator('.cm-tooltip-autocomplete li');
    await expect(options.first()).toBeVisible({ timeout: 5000 });
    // Completing against the fixture is what makes a predicate that matches
    // nothing hard to write by accident.
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('BANK_');
  });
});

// ---------------------------------------------------------------------------

test.describe('gutters and marks', () => {
  test('marks the lines a diagnostic points at', async ({ page }) => {
    await expect(page.locator('.cm-mdl-sev-gutter').first()).toBeVisible();
    await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
  });

  test('squiggles the text, not the key above it', async ({ page }) => {
    // A folded block scalar keeps its text a line below its key. Pointing the
    // diagnostic at the key put the squiggle above the code it was about.
    const marked = page.locator('.cm-lintRange').first();
    await expect(marked).toBeVisible();
    const text = await marked.innerText();
    expect(text.trim().endsWith(':')).toBe(false);
  });
});
