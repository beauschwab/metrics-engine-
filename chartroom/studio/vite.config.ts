import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.CHARTROOM_API || 'http://127.0.0.1:8788';

export default defineConfig({
  plugins: [react()],
  // The studio serves the registry's `public/` rather than keeping its own.
  // Both apps self-host the same two Inter subsets and reference them at
  // `/fonts/...`; a second copy is 204 KB of the same bytes and a second thing
  // to remember when the design system's font stack changes.
  publicDir: '../../public',
  server: {
    port: 5174,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  preview: {
    port: 4174,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
});
