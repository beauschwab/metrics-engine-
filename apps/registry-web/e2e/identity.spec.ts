/**
 * The identity mode, from the author's chair (ADR-57).
 *
 * A registry with KEEL_REQUIRE_IDENTITY=1 refuses writes that carry no
 * asserted identity. This spec runs the surface against exactly that — with
 * the dev proxy deliberately NOT asserting one — and checks the refusal is
 * survivable: the save fails with the control named, nothing crashes, and the
 * author keeps their text. The happy path (a write with the header) and the
 * agent refusal are proved at the API in the same spec, where a browser adds
 * nothing.
 *
 * Own registry + preview on OS-assigned ports, same reasons as
 * persistence.spec: shared state makes failures intermittent and
 * misattributed.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const dir = mkdtempSync(join(tmpdir(), 'keel-identity-e2e-'));
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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const registryPort = await freePort();
  const previewPort = await freePort();
  API = `http://127.0.0.1:${registryPort}`;
  APP = `http://127.0.0.1:${previewPort}`;

  start('npx', ['tsx', '../../packages/registry/index.ts'], {
    KEEL_PORT: String(registryPort),
    KEEL_SQLITE_FILE: join(dir, 'registry.db'),
    KEEL_REQUIRE_IDENTITY: '1',
    KEEL_IDENTITY_HEADER: 'x-keel-identity',
  });
  await waitFor(`${API}/api/health`);

  // The preview proxy asserts nothing — KEEL_DEV_IDENTITY is deliberately
  // unset, which is the misconfiguration the refusal exists to catch.
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

test('an identity-less save fails naming the control, and the author keeps their text', async ({ page }) => {
  await page.goto(APP);
  await page.locator('.mdl-modeswitch[data-mode="yaml"]').click();
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n# identity spec edit');

  // The debounced save fires and is refused; the surface reports it rather
  // than crashing or silently pretending.
  const state = page.locator('[data-testid="mdl-save-state"]');
  await expect(state).toHaveText('save failed', { timeout: 10_000 });
  await expect(state).toHaveAttribute('title', /KEEL_REQUIRE_IDENTITY/);

  // The author's text is still theirs.
  await expect(editor).toContainText('# identity spec edit');
});

test('the same write goes through with an asserted identity, and never for an agent', async () => {
  const doc = await (await fetch(`${API}/api/artifacts/liquidity_pit`)).json() as { body: string };

  const anonymous = await fetch(`${API}/api/artifacts/liquidity_pit`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: `${doc.body}\n# x`, message: 'x' }),
  });
  expect(anonymous.status).toBe(403);

  const asserted = await fetch(`${API}/api/artifacts/liquidity_pit`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-keel-identity': 'alice' },
    body: JSON.stringify({ body: `${doc.body}\n# x`, message: 'x' }),
  });
  expect(asserted.status).toBe(200);

  // An agent identity is refused whatever the mode — the HTTP door holds the
  // same line as the tool surface (ADR-56/57).
  const agent = await fetch(`${API}/api/artifacts/liquidity_pit`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-keel-identity': 'agent:lg-registry' },
    body: JSON.stringify({ body: `${doc.body}\n# y`, message: 'y' }),
  });
  expect(agent.status).toBe(403);
  expect(((await agent.json()) as { error: string }).error).toMatch(/agent identity/);
});
