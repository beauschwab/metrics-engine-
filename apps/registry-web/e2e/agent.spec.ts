/**
 * The definition agent rail (ADR-56), against a real registry and no agent
 * service — on purpose. The rail is an instrument an author opens, its
 * composer completions come from the workspace and the open document, and a
 * pointer is a diagnostic the problems strip resolved. With no agent service
 * behind the registry, a message gets the honest unavailable banner while the
 * rest of the surface keeps working (ADR-35) — that banner comes from the
 * registry's own /api/chat proxy, which is part of what this suite proves.
 *
 * This spec brings its own registry and preview server on OS-assigned ports,
 * for the same reason persistence.spec does: sharing state with the offline
 * suite would make failures intermittent and misattributed. KEEL_AGENT_URL is
 * pinned to a port nothing listens on, so a developer's real agent service
 * can never stream model output into an assertion.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const dir = mkdtempSync(join(tmpdir(), 'keel-agent-e2e-'));
const children: ChildProcess[] = [];

let APP = '';
let API = '';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
  });
}

function start(command: string, args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: 'ignore',
    detached: false,
  });
  children.push(child);
  return child;
}

async function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not come up within ${timeoutMs}ms`);
}

// One registry, one preview, several read-only tests — one worker keeps it one
// harness rather than one per worker under fullyParallel.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const registryPort = await freePort();
  const previewPort = await freePort();
  const deadPort = await freePort(); // claimed and released: guaranteed nobody listens
  API = `http://127.0.0.1:${registryPort}`;
  APP = `http://127.0.0.1:${previewPort}`;

  start('npx', ['tsx', '../../packages/registry/index.ts'], {
    KEEL_PORT: String(registryPort),
    KEEL_SQLITE_FILE: join(dir, 'registry.db'),
    KEEL_AGENT_URL: `http://127.0.0.1:${deadPort}`,
  });
  await waitFor(`${API}/api/health`);

  start(
    'npx',
    ['vite', 'preview', '--port', String(previewPort), '--strictPort', '--host', '127.0.0.1'],
    { KEEL_API: API },
  );
  await waitFor(APP);
});

test.afterAll(() => {
  children.forEach((c) => c.kill('SIGTERM'));
  rmSync(dir, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('.mdl-shell')).toBeVisible();
});

test('the rail is an instrument you open, with the authoring journey as its spine', async ({ page }) => {
  // Closed by default — deliberately the opposite of the analyst surface's
  // posture (ADR-55): an author arrives with intent and a document open.
  await expect(page.getByTestId('chat-pane')).toHaveCount(0);
  await page.getByTestId('mdl-agent-toggle').click();
  await expect(page.getByTestId('chat-pane')).toBeVisible();

  // The phase spine orients; intake is where every session starts, and the
  // last phase says out loud whose act the save is.
  await expect(page.getByTestId('rail-phases')).toBeVisible();
  await expect(page.getByTestId('phase-intake')).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('phase-handover')).toContainText('Hand over');

  // The empty state leads with the intake question; the scope chip carries
  // what the agent will read with every message.
  await expect(page.getByTestId('chat-suggestions')).toContainText('What should this definition decide?');
  await expect(page.getByTestId('scope-chip')).toContainText('liquidity_pit');

  // hide puts it away; the toggle brings it back.
  await page.getByTestId('chat-close').click();
  await expect(page.getByTestId('chat-pane')).toHaveCount(0);
  await page.getByTestId('mdl-agent-toggle').click();
  await expect(page.getByTestId('chat-pane')).toBeVisible();
});

test('composer completions come from the commands, the workspace and the open document', async ({ page }) => {
  await page.getByTestId('mdl-agent-toggle').click();
  const input = page.getByTestId('chat-input');

  // `/` opens the command menu, filtered by prefix; Tab accepts the first match.
  await input.fill('/te');
  await expect(page.getByTestId('composer-menu')).toBeVisible();
  await expect(page.getByTestId('menu-item-0')).toContainText('/test');
  await input.press('Tab');
  await expect(input).toHaveValue('/test ');

  // `@` completes from the workspace's documents — a mention offered is a
  // document that actually exists in the lineage.
  await input.fill('explain @fr2052a_pr');
  await expect(page.getByTestId('composer-menu')).toBeVisible();
  await expect(page.getByTestId('menu-item-0')).toContainText('@fr2052a_product_id');

  // …and from the open document's measures.
  await input.fill('trace @lcr');
  await expect(page.getByTestId('composer-menu')).toBeVisible();
  await expect(page.getByTestId('composer-menu')).toContainText('@lcr');
});

test('a diagnostic becomes a pointer, and asking again detaches it', async ({ page }) => {
  // The problems strip is open by default and the shipped workspace carries
  // diagnostics — the ask affordance rides on real rows, not fixtures.
  const ask = page.locator('[data-testid^="ask-KEEL"]').first();
  await expect(ask).toBeVisible();

  // Asking with the rail closed opens it: the question carries its context.
  await ask.click();
  await expect(page.getByTestId('chat-pane')).toBeVisible();
  await expect(ask).toContainText('in chat');
  const chip = page.locator('[data-testid^="pointer-chip-KEEL"]').first();
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('KEEL');

  // A pointer dies where it was born.
  await ask.click();
  await expect(page.locator('[data-testid^="pointer-chip-KEEL"]')).toHaveCount(0);
  await expect(ask).toContainText('ask');
});

test('a message degrades honestly without an agent service, and the surface keeps working', async ({ page }) => {
  await page.getByTestId('mdl-agent-toggle').click();
  await page.getByTestId('chat-input').fill('What does this rule set decide?');
  await page.getByTestId('chat-send').click();

  // The banner is the registry proxy's frame — it names what still works.
  await expect(page.getByTestId('chat-unavailable')).toBeVisible();
  await expect(page.getByTestId('chat-unavailable')).toContainText('deterministic');

  // The rest of the surface is untouched.
  await expect(page.locator('.mdl-problems-bar')).toBeVisible();
});
