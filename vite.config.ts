import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    // `e2e/` belongs to Playwright. Vitest would otherwise collect those specs,
    // load `@playwright/test` outside its own runner and fail on the first
    // `beforeEach` with an error that says nothing about the real cause.
    include: ['src/**/*.test.ts'],
  },
});
