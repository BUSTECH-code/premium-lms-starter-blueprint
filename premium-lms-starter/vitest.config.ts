import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against package source; compiled dist is only used by the
      // API runtime build.
      '@lms/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
      '@lms/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/db/tests/**/*.test.ts',
      'apps/api/tests/**/*.test.ts',
      'apps/web/src/**/*.test.{ts,tsx}',
    ],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
    root: rootDir,
  },
});
