import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.KEEL_API || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The registry runs as its own process, so `/api` is proxied rather than
    // origin-shared. In production the two sit behind one host, and the client's
    // relative `/api` paths need no change to get there.
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  test: {
    // `e2e/` belongs to Playwright. Vitest would otherwise collect those specs,
    // load `@playwright/test` outside its own runner and fail on the first
    // `beforeEach` with an error that says nothing about the real cause.
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'mcp/**/*.test.ts'],
    /*
     * The conformance legs run real engines out of process — a DuckDB instance,
     * a Python subprocess, an Iceberg catalogue over SQLite — and vitest runs
     * test files concurrently. Under that contention the default 5s bound
     * measures machine load rather than correctness: a Polars leg that normally
     * takes 200ms timed out once in four full runs while the variance suite was
     * seeding sixty days into DuckDB beside it.
     *
     * A generous bound costs nothing here because nothing in this suite hangs on
     * purpose — a broken engine call throws, it does not wait.
     */
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
