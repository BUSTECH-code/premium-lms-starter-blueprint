import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvironmentError, findWorkspaceRoot, loadEnv, parseEnv, readEnvFile } from '../src/config/env.js';

describe('parseEnv — development/test defaults', () => {
  it('generates a strong ephemeral secret when none is provided', () => {
    const env = parseEnv({ NODE_ENV: 'test', DB_PATH: 'memory:' });
    expect(env.auth.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(env.auth.cookieSecure).toBe(false);
    expect(env.nodeEnv).toBe('test');
    expect(env.isProductionLike).toBe(false);
    // two parses must not share the same generated secret
    const other = parseEnv({ NODE_ENV: 'test', DB_PATH: 'memory:' });
    expect(other.auth.jwtSecret).not.toBe(env.auth.jwtSecret);
  });

  it('applies documented development defaults', () => {
    const env = parseEnv({ NODE_ENV: 'development' });
    expect(env.port).toBe(4000);
    expect(env.auth.accessTokenTtlSeconds).toBe(900);
    expect(env.auth.refreshTokenTtlSeconds).toBe(604_800);
    expect(env.rateLimit.login.maxAttempts).toBe(5);
    expect(env.rateLimit.loginPerIp.maxAttempts).toBe(20); // 4× per-email ceiling
    expect(env.allowedOrigins).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(env.db.path).toBe('./.data/dev');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => parseEnv({ NODE_ENV: 'qa' })).toThrow(EnvironmentError);
  });

  it('rejects malformed WEB_ORIGIN entries', () => {
    expect(() => parseEnv({ NODE_ENV: 'test', WEB_ORIGIN: 'not a url' })).toThrow(/invalid origin/);
    expect(() => parseEnv({ NODE_ENV: 'test', WEB_ORIGIN: 'ftp://files.example' })).toThrow(/http/);
    expect(() => parseEnv({ NODE_ENV: 'test', WEB_ORIGIN: '' })).toThrow(/at least one origin/);
  });
});

describe('parseEnv — commerce (Phase 2)', () => {
  const stagingBase = {
    NODE_ENV: 'staging',
    DB_PATH: 'memory:',
    JWT_SECRET: 'x'.repeat(40),
    WEB_ORIGIN: 'https://staging.academy.example.com',
  };
  const testBase = { NODE_ENV: 'test', DB_PATH: 'memory:' };

  it('enables the simulated provider by default outside production-like envs', () => {
    const env = parseEnv(testBase);
    expect(env.commerce.provider).toBe('simulated');
    expect(env.commerce.simulationEnabled).toBe(true);
    expect(env.commerce.currency).toBe('NGN');
    expect(env.commerce.checkoutTtlMinutes).toBe(30);
    expect(env.commerce.webhookSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('keeps simulated payments off in production-like envs without explicit opt-in', () => {
    const env = parseEnv(stagingBase);
    expect(env.commerce.simulationEnabled).toBe(false);
    // Even when disabled, a secret exists so config shape is stable.
    expect(env.commerce.webhookSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('requires a strong webhook secret to opt in on production-like envs', () => {
    const optIn = { ...stagingBase, ALLOW_SIMULATED_PAYMENTS: 'true' };
    expect(() => parseEnv(optIn)).toThrow(/SIMULATED_WEBHOOK_SECRET/);
    expect(() => parseEnv({ ...optIn, SIMULATED_WEBHOOK_SECRET: 'too-short' })).toThrow(
      /32 chars/,
    );
    expect(() =>
      parseEnv({
        ...optIn,
        SIMULATED_WEBHOOK_SECRET: 'a-placeholder-secret-value-at-least-32ch',
      }),
    ).toThrow(/placeholder/i);

    const ok = parseEnv({
      ...optIn,
      SIMULATED_WEBHOOK_SECRET: 'stage-simulated-webhook-key-9f3a7c1e5b2d8a4f',
    });
    expect(ok.commerce.simulationEnabled).toBe(true);
    expect(ok.commerce.webhookSecret).toBe('stage-simulated-webhook-key-9f3a7c1e5b2d8a4f');
  });

  it('validates currency, provider and checkout TTL inputs', () => {
    expect(() => parseEnv({ ...testBase, STORE_CURRENCY: 'naira' })).toThrow(/STORE_CURRENCY/);
    expect(() => parseEnv({ ...testBase, PAYMENT_PROVIDER: 'stripe' })).toThrow();
    expect(() => parseEnv({ ...testBase, CHECKOUT_TTL_MINUTES: '0' })).toThrow();
    expect(() => parseEnv({ ...testBase, CHECKOUT_TTL_MINUTES: '1441' })).toThrow();
    expect(parseEnv({ ...testBase, STORE_CURRENCY: 'usd' }).commerce.currency).toBe('USD');
  });

  it('applies checkout rate-limit defaults and overrides', () => {
    const env = parseEnv(testBase);
    expect(env.rateLimit.checkout.maxAttempts).toBe(30);
    expect(env.rateLimit.checkout.windowSeconds).toBe(300);
    const overridden = parseEnv({ ...testBase, RATE_LIMIT_CHECKOUT_MAX_ATTEMPTS: '5' });
    expect(overridden.rateLimit.checkout.maxAttempts).toBe(5);
  });
});

describe('parseEnv — staging/production hardening', () => {
  const prodBase = {
    NODE_ENV: 'production',
    DB_PATH: '/var/lib/lms/data',
    WEB_ORIGIN: 'https://academy.example.com',
  };

  it('requires an external JWT_SECRET of sufficient strength', () => {
    expect(() => parseEnv({ ...prodBase })).toThrow(/JWT_SECRET is required/);
    expect(() => parseEnv({ ...prodBase, JWT_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => parseEnv({ ...prodBase, JWT_SECRET: 'changeme-'.repeat(6) })).toThrow(/placeholder/);
    expect(() => parseEnv({ ...prodBase, JWT_SECRET: 'x'.repeat(40) })).not.toThrow();
  });

  it('forces secure cookies in production', () => {
    expect(() => parseEnv({ ...prodBase, JWT_SECRET: 'x'.repeat(40), COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE cannot be disabled/,
    );
    const env = parseEnv({ ...prodBase, JWT_SECRET: 'x'.repeat(40) });
    expect(env.auth.cookieSecure).toBe(true);
  });

  it('requires HTTPS origins in production and staging', () => {
    expect(() =>
      parseEnv({ ...prodBase, JWT_SECRET: 'x'.repeat(40), WEB_ORIGIN: 'http://academy.example.com' }),
    ).toThrow(/HTTPS/);
  });

  it('requires an explicit DB_PATH in production', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(40),
        WEB_ORIGIN: 'https://academy.example.com',
      }),
    ).toThrow(/DB_PATH must be set explicitly/);
  });

  it('defaults staging to secure cookies but allows an explicit local override', () => {
    const base = {
      NODE_ENV: 'staging',
      DB_PATH: 'memory:',
      JWT_SECRET: 'x'.repeat(40),
      WEB_ORIGIN: 'https://staging.academy.example.com',
    };
    expect(parseEnv(base).auth.cookieSecure).toBe(true);
    expect(() => parseEnv({ ...base, COOKIE_SECURE: 'false' })).toThrow(/ALLOW_INSECURE_COOKIES/);
    expect(
      parseEnv({ ...base, COOKIE_SECURE: 'false', ALLOW_INSECURE_COOKIES: 'true' }).auth.cookieSecure,
    ).toBe(false);
  });
});

describe('readEnvFile', () => {
  it('parses KEY=VALUE lines, comments and quotes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-env-'));
    const file = path.join(dir, '.env.sample');
    fs.writeFileSync(
      file,
      ['# comment', 'API_PORT=4000', 'WEB_ORIGIN="http://localhost:5173"', "JWT_SECRET=''", 'BROKEN LINE', ''].join(
        '\n',
      ),
    );
    try {
      const values = readEnvFile(file);
      expect(values.API_PORT).toBe('4000');
      expect(values.WEB_ORIGIN).toBe('http://localhost:5173');
      expect(values.JWT_SECRET).toBe('');
      expect(values.BROKEN).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('findWorkspaceRoot', () => {
  it('locates the workspace root from inside the repo', () => {
    const root = findWorkspaceRoot([process.cwd()]);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      workspaces?: string[];
    };
    expect(Array.isArray(pkg.workspaces)).toBe(true);
  });
});

describe('loadEnv', () => {
  it('loads the test environment file and resolves an in-memory database', () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    expect(env.nodeEnv).toBe('test');
    expect(env.db.path).toBe('memory:');
    expect(env.logLevel).toBe('silent');
    expect(env.auth.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('persists a generated development secret across loads', () => {
    const first = loadEnv({ NODE_ENV: 'development' });
    const second = loadEnv({ NODE_ENV: 'development' });
    expect(first.auth.jwtSecret).toBe(second.auth.jwtSecret);
    const root = findWorkspaceRoot([process.cwd()]);
    const secretFile = path.join(root, '.data', 'secrets', 'jwt-secret');
    expect(fs.existsSync(secretFile)).toBe(true);
    // the secret file must not be world-readable
    expect(fs.statSync(secretFile).mode & 0o077).toBe(0);
  });

  it('process environment values override environment files', () => {
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'debug', API_PORT: '4321' });
    expect(env.logLevel).toBe('debug');
    expect(env.port).toBe(4321);
  });

  it('refuses to boot production without deployment secrets', () => {
    expect(() =>
      loadEnv({ NODE_ENV: 'production', WEB_ORIGIN: 'https://academy.example.com' }),
    ).toThrow(/JWT_SECRET is required/);
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://academy.example.com',
        JWT_SECRET: 'a-sufficiently-long-deployment-secret-value!!',
      }),
    ).toThrow(/DB_PATH must be set explicitly/);
  });
});
