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
      command: `CHARTROOM_SQLITE_FILE=${DB} KEEL_API=http://127.0.0.1:9 npx tsx ../server/src/index.ts`,
      url: 'http://127.0.0.1:8788/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run build && npx vite preview --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
