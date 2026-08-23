import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.KEEL_API || 'http://127.0.0.1:8787';

// Dev-stand-in for the SSO reverse proxy (ADR-57): with KEEL_DEV_IDENTITY set,
// the proxy asserts that name on every request, through the same header the
// registry reads in production (`KEEL_IDENTITY_HEADER=x-keel-identity`). The
// client itself never chooses the name — that is the entire point.
const IDENTITY = process.env.KEEL_DEV_IDENTITY;
const proxy = {
  '/api': {
    target: API,
    changeOrigin: true,
    ...(IDENTITY ? { headers: { 'x-keel-identity': IDENTITY } } : {}),
  },
};

export default defineConfig({
  plugins: [react()],
  // The fonts are the design system's, not this app's: `keel-design-system`
  // carries the `@font-face` rules that name them, and the studio serves the
  // same directory. One copy, owned by the package that declares it.
  publicDir: '../../packages/design-system/public',
  server: {
    port: 5173,
    // The registry runs as its own process, so `/api` is proxied rather than
    // origin-shared. In production the two sit behind one host, and the client's
    // relative `/api` paths need no change to get there.
    proxy,
  },
  preview: {
    port: 4173,
    proxy,
  },
  // No `test` block: this app has no unit tests. They live with the code they
  // exercise — `packages/engine` owns the engine and conformance suites, which
  // is what moving the engine out of `src/` was for. `e2e/` is Playwright's.
});
