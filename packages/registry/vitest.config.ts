import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * The bounds the root `vite.config.ts` used to give `server/**` before this
     * package owned its own config. They are load-bearing in CI rather than
     * here: `live.test.ts` and `query.test.ts` seed a real Flight SQL server
     * and `client-example.test.ts` runs the shipped Python client against a
     * DuckDB it builds first. All three skip themselves when their interpreter
     * is missing — which is the case locally and *not* the case in CI, where
     * `requirements.txt` is installed precisely so they run.
     *
     * So the default 5s would pass every local run and fail the one that
     * matters. Explicit, for that reason.
     */
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
