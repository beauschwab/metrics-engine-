import { defineConfig, devices } from '@playwright/test';

/**
 * Studio e2e — the built bundle against a real chartroom-server.
 *
 * The server runs with no registry process behind it, exercising the shipped-
 * documents fallback deliberately: the suite must be hermetic, and the
 * fallback is a first-class mode the header labels, not a degraded one. The
 * SQLite file lives under the OS temp dir, fresh per run, so the dogfood seed
 * runs every time.
 */

const DB = `${process.env.TMPDIR || '/tmp'}/chartroom-e2e-${process.pid}.db`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 30_000,

  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 1000 },
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },

  projects: [{ name: 'chromium' }],

  webServer: [
    {
      // ANTHROPIC_API_KEY is blanked so the chat's no-model degrade path is
      // what the suite exercises, whatever the host env carries.
      command: `CHARTROOM_SQLITE_FILE=${DB} KEEL_API=http://127.0.0.1:9 ANTHROPIC_API_KEY= npx tsx ../chartroom-api/src/index.ts`,
      url: 'http://127.0.0.1:8788/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
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
        'npm run build && npx vite preview --port 4174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
