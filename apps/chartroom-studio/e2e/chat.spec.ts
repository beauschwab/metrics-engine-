/**
 * The design agent rail (ADR-55), offline mode on purpose: the rail is part
 * of the surface a reader lands on, its composer completions come from the
 * open spec and the registry, and a pointer attached from the canvas is a
 * resolved reference. With no model configured a message gets the honest
 * unavailable banner while the rest of the studio keeps working (ADR-35).
 * The live agent loop is covered by the server's key-gated chat test.
 */

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/author');
  await page.getByTestId('dash-lcr-monitor').click();
  await expect(page.getByTestId('widget-lcr-tile')).toBeVisible();
});

test('the rail is open by default, with the phase spine and the empty state', async ({ page }) => {
  await page.keyboard.press('r');
  await expect(page.getByTestId('chat-pane')).toBeVisible();

  // The phase spine orients; intake is where every session starts.
  await expect(page.getByTestId('rail-phases')).toBeVisible();
  await expect(page.getByTestId('phase-intake')).toHaveAttribute('data-state', 'active');

  // The empty state leads with the question the intake protocol asks.
  await expect(page.getByTestId('chat-suggestions')).toContainText('What should this board decide?');
  // The scope chip carries what the agent will read with every message.
  await expect(page.getByTestId('scope-chip')).toContainText('lcr-monitor');

  // hide puts it away; the header toggle brings it back.
  await page.getByTestId('chat-close').click();
  await expect(page.getByTestId('chat-pane')).toHaveCount(0);
  await page.getByTestId('open-chat').click();
  await expect(page.getByTestId('chat-pane')).toBeVisible();
});

test('composer completions come from the commands, the spec and the registry', async ({ page }) => {
  const input = page.getByTestId('chat-input');

  // `/` opens the command menu, filtered by prefix.
  await input.fill('/li');
  await expect(page.getByTestId('composer-menu')).toBeVisible();
  await expect(page.getByTestId('menu-item-0')).toContainText('/lint');
  // Tab accepts the first match by replacing the token.
  await input.press('Tab');
  await expect(input).toHaveValue('/lint ');

  // `@` completes from the open spec's widgets and the registry's functions —
  // a value offered is a widget or measure that actually exists.
  await input.fill('explain @lcr-t');
  await expect(page.getByTestId('composer-menu')).toBeVisible();
  await expect(page.getByTestId('menu-item-0')).toContainText('@lcr-tile');

  // `#` completes from the pattern catalog.
  await input.fill('compose against #');
  await expect(page.getByTestId('composer-menu')).toBeVisible();
  await expect(page.getByTestId('composer-menu')).toContainText('#');
});

test('a pointer attached from the canvas is a resolved reference', async ({ page }) => {
  await page.keyboard.press('r');

  // ✳ ask attaches the widget; the frame says so, and the chip lands in the
  // composer carrying the widget's type and binding.
  await page.getByTestId('ask-lcr-tile').click();
  await expect(page.getByTestId('widget-lcr-tile')).toHaveAttribute('data-attached', 'true');
  await expect(page.getByTestId('ask-lcr-tile')).toContainText('in chat');
  const chip = page.getByTestId('pointer-chip-lcr-tile');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('@lcr-tile');

  // Asking again detaches — a pointer dies where it was born.
  await page.getByTestId('ask-lcr-tile').click();
  await expect(page.getByTestId('pointer-chip-lcr-tile')).toHaveCount(0);
  await expect(page.getByTestId('widget-lcr-tile')).not.toHaveAttribute('data-attached', 'true');
});

test('a message degrades honestly without a model, and the studio keeps working', async ({ page }) => {
  await page.getByTestId('chat-input').fill('What metrics exist for liquidity?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-unavailable')).toBeVisible();
  await expect(page.getByTestId('chat-unavailable')).toContainText('deterministic');

  // The rest of the studio is untouched — the canvas still renders.
  await expect(page.getByTestId('canvas')).toBeVisible();
});
