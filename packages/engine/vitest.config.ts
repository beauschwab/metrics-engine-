import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
