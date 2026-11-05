import type { Express } from 'express';
import request from 'supertest';
import { createDatabase, runMigrations, setUserRoles, type DbClient } from '@lms/db';
import { createApp } from '../src/app.js';
import { parseEnv, type Env } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';

export const TEST_JWT_SECRET = 'unit-test-secret-at-least-32-characters-long!!';

export interface TestApp {
  app: Express;
  db: DbClient;
  env: Env;
  close(): Promise<void>;
}

/** Build the full application against a fresh in-memory database. */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const env = parseEnv({
    NODE_ENV: 'test',
    JWT_SECRET: TEST_JWT_SECRET,
    DB_PATH: 'memory:',
    LOG_LEVEL: 'silent',
    WEB_ORIGIN: 'http://localhost:5173,http://127.0.0.1:5173',
    RATE_LIMIT_LOGIN_MAX_ATTEMPTS: '1000',
    RATE_LIMIT_REGISTER_MAX_ATTEMPTS: '1000',
    ...overrides,
  });
  const db = await createDatabase({ driver: 'pglite', path: 'memory:' });
  await runMigrations(db);
  const logger = createLogger('silent');
  const app = createApp({ env, db, logger });
  return { app, db, env, close: () => db.close() };
}

/** Minimal cookie jar — captures Set-Cookie across a request chain. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(res: request.Response): void {
    const header = res.headers['set-cookie'];
    if (!header) return;
    const list = Array.isArray(header) ? header : [header];
    for (const raw of list) {
      const pair = raw.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  clear(): void {
    this.cookies.clear();
  }
}

export interface CredentialsInput {
  name?: string;
  email: string;
  password?: string;
}

export const DEFAULT_PASSWORD = 'correct-horse-battery';

export async function register(app: Express, input: CredentialsInput) {
  const jar = new CookieJar();
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      name: input.name ?? 'Test Student',
      email: input.email,
      password: input.password ?? DEFAULT_PASSWORD,
    });
  jar.absorb(res);
  return { res, jar };
}

export async function login(app: Express, email: string, password = DEFAULT_PASSWORD) {
  const jar = new CookieJar();
  const res = await request(app).post('/api/auth/login').send({ email, password });
  jar.absorb(res);
  return { res, jar };
}

export function api(app: Express, jar?: CookieJar) {
  const req = request(app);
  return jar ? req.set('Cookie', jar.header()) : req;
}

/** Replace a user's roles directly in the database (test setup only). */
export async function setRoles(
  db: DbClient,
  userId: string,
  roleKeys: string[],
): Promise<void> {
  await db.transaction((tx) =>
    setUserRoles(tx, { userId, roleKeys, grantedBy: userId }),
  );
}

/** Promote a user to admin directly in the database (test setup only). */
export async function promoteToAdmin(db: DbClient, userId: string): Promise<void> {
  await setRoles(db, userId, ['admin']);
}
