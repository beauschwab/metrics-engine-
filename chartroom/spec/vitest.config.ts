import { defineConfig } from 'vitest/config';

// Without this, vitest walks up and finds the repo root's vite.config.ts,
// whose include patterns are the root app's — and finds nothing here.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
