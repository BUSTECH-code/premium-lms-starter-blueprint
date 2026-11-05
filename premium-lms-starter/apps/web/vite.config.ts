import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server configuration.
// - `host: true` + `allowedHosts: true` so the sandbox preview host can reach it.
// - `/api` is proxied to the API process (same-origin cookies work unchanged).
// - `xfwd: true` forwards X-Forwarded-* so the API origin check can recognise
//   requests that arrived through this proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
        changeOrigin: true,
        xfwd: true,
      },
    },
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
});
