import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * These tests are not unit tests: each one spawns a real MCP server as a
     * child process and talks to it over stdio. On a warm machine a case takes
     * a second or two; on a cold one — a fresh `npm ci`, nothing in tsx's
     * cache, which is every CI run — the same case takes longer than vitest's
     * 5s default, and the failure reads as a product bug rather than as a
     * bound that was never meant to apply here.
     *
     * The root `vite.config.ts` used to cover `mcp/**` with 30s. When the
     * engine moved to its own package that config went with it and this one
     * silently inherited the default, which is how a deployment-gate test
     * started timing out at 5152ms with nothing wrong in it. Same bounds as
     * `chartroom-mcp`, which does the same thing for the same reason.
     */
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
