import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The suite drives the built bundle rather than the dev server, because what
 * we want to know is whether the thing that ships works — a Vite HMR page can
 * hide a production-only failure in chunking or CSS ordering.
 *
 * `CHROMIUM_PATH` exists for environments that already have a Chromium and no
 * route to download another: sandboxes, locked-down CI images, air-gapped
 * machines. Left unset, Playwright resolves its own browser the usual way and
 * this config behaves exactly like a default one. An earlier version of these
 * tests hard-coded a path, which is precisely why they could not be committed.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 30_000,

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    // Desktop only, one canvas at 1600×1000 — the same call the design made.
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },

  projects: [{ name: 'chromium' }],

  webServer: {
    // `--host 127.0.0.1` rather than Vite's default. Vite previews on
    // `localhost`, and Node binds whatever that resolves to first: on a
    // GitHub runner /etc/hosts carries `::1 localhost`, so the server comes
    // up on IPv6 while the `url` below is probed over IPv4 and never
    // answers. The job then dies on a 120s webServer timeout with nothing in
    // the log to say why — vite's progress goes to stdout, which Playwright
    // does not surface, so only the chunk-size warnings on stderr appear.
    // This is why `browser` was red on every run of main while passing
    // locally: a dev container with no IPv6 cannot reproduce it.
    command:
      'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    // Never reuse. A preview server left running from an earlier build serves
    // the old bundle, and the suite passes against code that no longer exists
    // — which happened while writing these tests. A three-second rebuild is
    // cheaper than a green run that means nothing.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
