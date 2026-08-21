/**
 * The embedded agent chat, offline mode on purpose: the pane opens with its
 * AI-Elements-style components (suggestions, prompt input), and with no model
 * configured a message gets the honest unavailable banner while the rest of
 * the studio keeps working (ADR-35). The live agent loop is covered by the
 * server's key-gated chat test.
 */

import { expect, test } from '@playwright/test';

test('the chat pane opens, offers suggestions, and degrades honestly without a model', async ({ page }) => {
  await page.goto('/#/author');
  await page.getByTestId('dash-lcr-monitor').click();

  await page.getByTestId('open-chat').click();
  await expect(page.getByTestId('chat-pane')).toBeVisible();
  // The pane carries the open dashboard as context.
  await expect(page.getByTestId('chat-pane')).toContainText('lcr-monitor');
  // Suggestions render while the thread is empty.
  await expect(page.getByTestId('chat-suggestions')).toBeVisible();

  // Sending a message reaches the server, which says plainly that no model
  // is configured — a banner, not an error, and not a dead pane.
  await page.getByTestId('chat-input').fill('What metrics exist for liquidity?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-unavailable')).toBeVisible();
  await expect(page.getByTestId('chat-unavailable')).toContainText('deterministic');

  // The rest of the studio is untouched — the canvas still renders.
  await expect(page.getByTestId('canvas')).toBeVisible();

  await page.getByTestId('chat-close').click();
  await expect(page.getByTestId('chat-pane')).toHaveCount(0);
});
