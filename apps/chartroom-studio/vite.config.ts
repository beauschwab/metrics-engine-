import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = process.env.CHARTROOM_API || 'http://127.0.0.1:8788';

export default defineConfig({
  // Tailwind is the grid's build (ADR-65); the studio's own sheet is not
  // rewritten by it — see styles.css for what is imported and what is not.
  plugins: [react(), tailwindcss()],
  // The studio serves the registry's `public/` rather than keeping its own.
  // Both apps self-host the same two Inter subsets and reference them at
  // `/fonts/...`; a second copy is 204 KB of the same bytes and a second thing
  // to remember when the design system's font stack changes.
  publicDir: '../../packages/design-system/public',
  server: {
    port: 5174,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  preview: {
    port: 4174,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
});
