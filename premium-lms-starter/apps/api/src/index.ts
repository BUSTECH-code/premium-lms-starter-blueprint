import { createDatabase, runMigrations } from '@lms/db';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.logLevel);

  const db = await createDatabase({ driver: env.db.driver, path: env.db.path });
  const migration = await runMigrations(db);
  if (migration.applied.length > 0) {
    logger.info({ applied: migration.applied }, 'database migrations applied');
  }

  const app = createApp({ env, db, logger });
  const server = app.listen(env.port, '0.0.0.0', () => {
    logger.info({ port: env.port, environment: env.nodeEnv }, 'API server listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void db
        .close()
        .catch((error) => logger.error({ err: error }, 'error closing database'))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // Bootstrap failures happen before the structured logger exists; messages are
  // safe by design (EnvironmentError never embeds secret values).
  console.error('API failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
