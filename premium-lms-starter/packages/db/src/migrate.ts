import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbClient } from './client.js';

export interface Migration {
  /** Filename without extension, e.g. `0001_init`. */
  version: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationRunResult {
  applied: string[];
  alreadyApplied: string[];
}

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/**
 * Locate the `@lms/db` package root by walking up from this module. Migrations
 * always load from `<package>/src/migrations`, so development (source),
 * tests (source) and runtime (compiled dist) all read the same SQL files.
 */
export function findPackageRoot(startUrl: string, packageName: string): string {
  let dir = path.dirname(fileURLToPath(startUrl));
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const raw = readFileSync(pkgPath, 'utf8');
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg.name === packageName) return dir;
    } catch {
      // package.json missing or unreadable — keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate package root for ${packageName} from ${startUrl}`);
    }
    dir = parent;
  }
}

export function defaultMigrationsDir(): string {
  return path.join(findPackageRoot(import.meta.url, '@lms/db'), 'src', 'migrations');
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function loadMigrations(dir: string = defaultMigrationsDir()): Promise<Migration[]> {
  const entries = await fs.readdir(dir);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const filename of files) {
    const sql = await fs.readFile(path.join(dir, filename), 'utf8');
    migrations.push({
      version: filename.replace(/\.sql$/, ''),
      filename,
      sql,
      checksum: sha256(sql),
    });
  }
  if (migrations.length === 0) {
    throw new Error(`No .sql migrations found in ${dir}`);
  }
  return migrations;
}

/**
 * Apply pending migrations in filename order. Each migration runs in a single
 * transaction together with its schema_migrations bookkeeping row, so a failure
 * leaves the database exactly as before. Already-applied migrations are
 * verified against their recorded checksum to detect edited history.
 */
export async function runMigrations(
  db: DbClient,
  options: { dir?: string } = {},
): Promise<MigrationRunResult> {
  const migrations = await loadMigrations(options.dir);
  await db.exec(MIGRATIONS_TABLE_DDL);

  const { rows } = await db.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  const applied = new Map(rows.map((row) => [row.version, row.checksum]));

  const result: MigrationRunResult = { applied: [], alreadyApplied: [] };

  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing !== undefined) {
      if (existing !== migration.checksum) {
        throw new Error(
          `Migration ${migration.filename} was modified after being applied ` +
            `(recorded checksum ${existing}, file checksum ${migration.checksum}). ` +
            'Create a new migration instead of editing applied history.',
        );
      }
      result.alreadyApplied.push(migration.version);
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
        [migration.version, migration.checksum],
      );
    });
    result.applied.push(migration.version);
  }

  return result;
}
