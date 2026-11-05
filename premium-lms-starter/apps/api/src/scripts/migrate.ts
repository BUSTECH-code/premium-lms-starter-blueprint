import { createDatabase, runMigrations } from '@lms/db';
import { loadEnv } from '../config/env.js';

/**
 * Explicit migration runner: `npm run migrate` (from the workspace root).
 * The API also applies migrations on boot, so this exists for CI, deployment
 * pipelines and manual control.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const db = await createDatabase({ driver: env.db.driver, path: env.db.path });
  try {
    const result = await runMigrations(db);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
