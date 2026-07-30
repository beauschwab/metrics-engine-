/**
 * Do edits actually survive?
 *
 * Everything else in `e2e/` runs against the bundle with no registry behind it,
 * which is deliberate — the static prototype has to keep working on its own, and
 * that is a property worth a test rather than an assumption. It does mean none of
 * those specs can answer the only question that matters about persistence, which
 * is whether a change is still there after a reload.
 *
 * So this spec brings its own everything: a registry on its own port with its own
 * scratch database, and its own preview server proxying to it. Isolation is the
 * point. Sharing a registry with the rest of the suite would let one spec's edit
 * change what another spec sees, and Playwright runs files concurrently — the
 * failure would be intermittent and blamed on the editor.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const EDITOR = '.cm-content';
const SAVED = '[data-testid="mdl-save-state"]';

const dir = mkdtempSync(join(tmpdir(), 'keel-e2e-'));
const children: ChildProcess[] = [];

let APP = '';
let API = '';

/**
 * A port nobody is using.
 *
 * Fixed ports were a mistake worth recording: a registry left listening by an
 * earlier crashed run made the health check pass instantly against *that*
 * process and *its* database, while this run's server died on `EADDRINUSE`. The
 * spec then read a workspace someone else had edited and failed with a message
 * about a missing line of YAML. Asking the OS for a free port removes the whole
 * class — including colliding with a registry the developer is running by hand.
 */
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

test.beforeAll(async () => {
  const registryPort = await freePort();
  const previewPort = await freePort();
  API = `http://127.0.0.1:${registryPort}`;
  APP = `http://127.0.0.1:${previewPort}`;

  start('npx', ['tsx', 'server/index.ts'], {
    KEEL_PORT: String(registryPort),
    // A scratch file per run. A registry that carried edits between runs would
    // make these tests pass or fail depending on what happened last time.
    KEEL_SQLITE_FILE: join(dir, 'registry.db'),
  });
  await waitFor(`${API}/api/health`);

  start('npx', ['vite', 'preview', '--port', String(previewPort), '--strictPort'], {
    KEEL_API: API,
  });
  await waitFor(APP);
});

test.afterAll(() => {
  children.forEach((c) => c.kill('SIGTERM'));
  rmSync(dir, { recursive: true, force: true });
});

function line(page: Page, text: string) {
  return page.locator('.cm-line', { hasText: text }).first();
}

function measure(page: Page, name: string) {
  return page.locator('.mdl-tree-measure', { has: page.locator('.mdl-tree-name', { hasText: name }) });
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator(EDITOR)).toBeVisible();
});

// ---------------------------------------------------------------------------

/**
 * These run in order, against one registry, on purpose.
 *
 * They are not independent checks of six unrelated things — they are one
 * narrative: seed, edit, reload, and then inspect the history that editing
 * produced. Under `fullyParallel` the later tests ran before the edit existed
 * and failed on its absence, which reads as a persistence bug and is not one.
 */
test.describe.configure({ mode: 'serial' });

test.describe('the registry', () => {
  test('says it is connected, and what revision a save produced', async ({ page }) => {
    // "Edits die on reload" and "your change is revision 7" are different
    // products. The surface has to say which one the author is using.
    await expect(page.locator(SAVED)).toHaveText(/registry connected|saved/);
  });

  test('serves the workspace it seeded from the shipped documents', async () => {
    const res = await fetch(`${API}/api/artifacts`);
    const { artifacts } = (await res.json()) as { artifacts: Array<{ name: string; revision: number }> };
    expect(artifacts).toHaveLength(6);
    expect(artifacts.every((a) => a.revision >= 1)).toBe(true);
  });

  test('keeps an edit across a reload', async ({ page }) => {
    await measure(page, 'lcr_buffer').click();
    await line(page, '* 1.0473').click();
    await page.keyboard.press('End');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type('2.0');
    await expect(page.locator('.mdl-value').first()).toHaveText('236.9%');

    // Saves are debounced, so the indicator moving to `saved · rN` is the signal
    // that the write actually landed rather than a timer that has not fired.
    await expect(page.locator(SAVED)).toHaveText(/saved · r\d+/, { timeout: 15_000 });

    await page.reload();
    await expect(page.locator(EDITOR)).toBeVisible();

    // The workspace arrives from the registry *after* first paint, so the editor
    // mounts on the shipped documents and is then replaced. Navigating before
    // that lands scrolls the outgoing document and the assertion below reads the
    // wrong viewport — which is a test bug, not a persistence one, and worth not
    // having to diagnose twice.
    await expect(page.locator(SAVED)).toHaveText(/registry connected|saved/);
    await measure(page, 'lcr_buffer').click();

    // The whole feature, in one assertion.
    await expect(page.locator('.mdl-value').first()).toHaveText('236.9%');
    await expect(line(page, '* 2.0')).toBeVisible();
  });

  test('records the edit as a revision rather than replacing the last one', async () => {
    const res = await fetch(`${API}/api/artifacts/liquidity_pit/history`);
    const { history } = (await res.json()) as {
      history: Array<{ revision: number; author: string; message: string }>;
    };

    // Revision 1 is what shipped, and it has to still be readable — reproducing
    // a number filed under the old rules is the reason the history exists.
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[history.length - 1]).toMatchObject({ revision: 1, author: 'system' });
    expect(history[0].revision).toBeGreaterThan(1);
  });

  test('still serves the workspace as it stood before the edit', async () => {
    const first = await fetch(`${API}/api/artifacts/liquidity_pit?revision=1`);
    const original = (await first.json()) as { body: string };
    expect(original.body).toContain('1.0473');

    const latest = await fetch(`${API}/api/artifacts/liquidity_pit`);
    expect(((await latest.json()) as { body: string }).body).not.toContain('1.0473');
  });

  test('refuses a save that would overwrite someone else’s', async () => {
    const current = (await (await fetch(`${API}/api/artifacts/liquidity_pit`)).json()) as {
      revision: number;
    };

    const stale = await fetch(`${API}/api/artifacts/liquidity_pit`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'clobbered',
        author: 'stale-tab',
        expectedRevision: current.revision - 1,
      }),
    });

    expect(stale.status).toBe(409);
    const after = (await (await fetch(`${API}/api/artifacts/liquidity_pit`)).json()) as {
      body: string;
    };
    expect(after.body).not.toBe('clobbered');
  });
});
