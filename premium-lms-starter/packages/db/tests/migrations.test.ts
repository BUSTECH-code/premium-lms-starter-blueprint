import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  defaultMigrationsDir,
  loadMigrations,
  runMigrations,
  type DbClient,
} from '../src/index.js';

const openDbs: DbClient[] = [];

async function openDb(pathValue = 'memory:'): Promise<DbClient> {
  const db = await createDatabase({ driver: 'pglite', path: pathValue });
  openDbs.push(db);
  return db;
}

afterEach(async () => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    await db?.close().catch(() => undefined);
  }
});

describe('migration files', () => {
  it('loads migrations sorted by filename with stable checksums', async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    const versions = migrations.map((m) => m.version);
    expect(versions).toEqual([...versions].sort());
    expect(versions).toContain('0001_init');
    expect(versions).toContain('0002_rbac_seed');
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(migration.sql.length).toBeGreaterThan(0);
    }
    // checksums are deterministic
    const again = await loadMigrations(defaultMigrationsDir());
    expect(again.map((m) => m.checksum)).toEqual(migrations.map((m) => m.checksum));
  });
});

describe('runMigrations', () => {
  it('applies all migrations on a fresh database and records checksums', async () => {
    const db = await openDb();
    const result = await runMigrations(db);

    expect(result.applied).toContain('0001_init');
    expect(result.applied).toContain('0002_rbac_seed');
    expect(result.alreadyApplied).toEqual([]);

    const { rows } = await db.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const files = await loadMigrations();
    expect(rows.map((r) => r.version)).toEqual(files.map((f) => f.version));
    for (const row of rows) {
      const file = files.find((f) => f.version === row.version);
      expect(row.checksum).toBe(file?.checksum);
    }

    const { rows: tables } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = tables.map((t) => t.tablename);
    for (const expected of [
      'users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'sessions',
      'courses', 'modules', 'lessons', 'enrollments', 'orders', 'order_items',
      'payments', 'payment_events', 'entitlements', 'lesson_progress', 'audit_events',
      'schema_migrations',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('is idempotent — a second run applies nothing', async () => {
    const db = await openDb();
    await runMigrations(db);
    const second = await runMigrations(db);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects an applied migration whose file was modified afterwards', async () => {
    const db = await openDb();
    await runMigrations(db);
    await db.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001_init'");
    await expect(runMigrations(db)).rejects.toThrow(/modified after being applied/);
  });

  it('rolls back a failing migration and keeps earlier migrations applied', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lms-migrations-'));
    try {
      await fs.writeFile(
        path.join(dir, '0001_ok.sql'),
        'CREATE TABLE probe_ok (id INTEGER PRIMARY KEY);',
      );
      await fs.writeFile(
        path.join(dir, '0002_broken.sql'),
        'CREATE TABLE probe_broken (id INTEGER PRIMARY KEY);\nSELECT this_function_does_not_exist();',
      );

      const db = await openDb();
      await expect(runMigrations(db, { dir })).rejects.toThrow();

      const { rows: tables } = await db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'probe%'`,
      );
      expect(tables.map((t) => t.tablename)).toEqual(['probe_ok']);

      const { rows: applied } = await db.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      expect(applied.map((r) => r.version)).toEqual(['0001_ok']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('0004_learning_engine', () => {
  it('applies the Phase 3 schema and records the exact file checksum', async () => {
    const db = await openDb();
    const result = await runMigrations(db);
    expect(result.applied).toContain('0004_learning_engine');
    expect(result.alreadyApplied).toEqual([]);

    const migrations = await loadMigrations();
    const file = migrations.find((m) => m.version === '0004_learning_engine');
    expect(file?.checksum).toMatch(/^[0-9a-f]{64}$/);
    const { rows } = await db.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations WHERE version = '0004_learning_engine'",
    );
    expect(rows[0]?.checksum).toBe(file?.checksum);

    const { rows: tables } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = tables.map((table) => table.tablename);
    for (const expected of [
      'course_completion',
      'course_completion_rules',
      'course_gradebook',
      'lesson_content',
      'media_assets',
      'media_asset_grants',
      'progress_client_sequences',
      'progress_events',
      'quiz_attempts',
      'quiz_gradebook',
      'quiz_questions',
      'quizzes',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('detects tampering with the applied learning-engine checksum', async () => {
    const db = await openDb();
    await runMigrations(db);
    await db.query(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0004_learning_engine'",
    );
    await expect(runMigrations(db)).rejects.toThrow(/modified after being applied/);
  });
});
