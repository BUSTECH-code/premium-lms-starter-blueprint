import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const sharedSource = fileURLToPath(
  new URL('../../packages/shared/src/index.ts', import.meta.url),
);
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

// Dev server configuration.
// - `host: true` + `allowedHosts: true` so the sandbox preview host can reach it.
// - `/api` is proxied to the API process (same-origin cookies work unchanged).
// - `xfwd: true` forwards X-Forwarded-* so the API origin check can recognise
//   requests that arrived through this proxy.
export default defineConfig({
  // Root .env.<mode> files hold VITE_* browser config; the web app is launched
  // from apps/web, so point Vite at the workspace root to find them.
  envDir: workspaceRoot,
  plugins: [react()],
  resolve: {
    alias: {
      '@lms/shared': sharedSource,
    },
  },
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
