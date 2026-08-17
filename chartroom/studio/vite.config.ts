import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.CHARTROOM_API || 'http://127.0.0.1:8788';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
  preview: {
    port: 4174,
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
});
