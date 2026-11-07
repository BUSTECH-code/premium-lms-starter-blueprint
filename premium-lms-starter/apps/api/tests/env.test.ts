import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EnvironmentError,
  deriveMediaSigningSecret,
  findWorkspaceRoot,
  loadEnv,
  parseEnv,
  readEnvFile,
} from '../src/config/env.js';
import { TEST_PAYSTACK_PUBLIC_KEY, TEST_PAYSTACK_SECRET_KEY } from './helpers.js';

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
    MEDIA_SIGNING_SECRET: 'stage-media-signing-key-9f3a7c1e5b2d8a4f',
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

describe('parseEnv — Paystack (Task 1)', () => {
  const testBase = { NODE_ENV: 'test', DB_PATH: 'memory:' };
  const paystackBase = {
    ...testBase,
    PAYMENT_PROVIDER: 'paystack',
    PAYSTACK_SECRET_KEY: TEST_PAYSTACK_SECRET_KEY,
    PAYSTACK_PUBLIC_KEY: TEST_PAYSTACK_PUBLIC_KEY,
  };
  const stagingBase = {
    NODE_ENV: 'staging',
    DB_PATH: 'memory:',
    JWT_SECRET: 'x'.repeat(40),
    MEDIA_SIGNING_SECRET: 'stage-media-signing-key-9f3a7c1e5b2d8a4f',
    WEB_ORIGIN: 'https://staging.academy.example.com',
  };

  it('enables Paystack with server-owned callback and API URLs', () => {
    const env = parseEnv(paystackBase);
    expect(env.commerce.provider).toBe('paystack');
    expect(env.commerce.simulationEnabled).toBe(false);
    expect(env.paystack.enabled).toBe(true);
    expect(env.paystack.secretKey).toBe(TEST_PAYSTACK_SECRET_KEY);
    expect(env.paystack.publicKey).toBe(TEST_PAYSTACK_PUBLIC_KEY);
    expect(env.paystack.apiBaseUrl).toBe('https://api.paystack.co');
    expect(env.paystack.callbackUrl).toBe('http://localhost:5173/checkout/paystack/callback');
  });

  it('requires both keys, matching modes and non-placeholder values', () => {
    expect(() =>
      parseEnv({ ...testBase, PAYMENT_PROVIDER: 'paystack' }),
    ).toThrow(/PAYSTACK_SECRET_KEY/);
    expect(() =>
      parseEnv({
        ...testBase,
        PAYMENT_PROVIDER: 'paystack',
        PAYSTACK_SECRET_KEY: TEST_PAYSTACK_SECRET_KEY,
      }),
    ).toThrow(/PAYSTACK_PUBLIC_KEY/);
    expect(() =>
      parseEnv({
        ...paystackBase,
        PAYSTACK_PUBLIC_KEY: 'pk_live_lms_unit_live_public_key',
      }),
    ).toThrow(/same test\/live mode/);
    expect(() =>
      parseEnv({ ...paystackBase, PAYSTACK_SECRET_KEY: 'sk_test_placeholder_key_value' }),
    ).toThrow(/placeholder/);
  });

  it('requires live keys and the official API origin in production-like environments', () => {
    expect(() =>
      parseEnv({ ...stagingBase, ...paystackBase, NODE_ENV: 'staging', DB_PATH: 'memory:' }),
    ).toThrow(/Live sk_live_/);
    const env = parseEnv({
      ...stagingBase,
      PAYMENT_PROVIDER: 'paystack',
      PAYSTACK_SECRET_KEY: 'sk_live_lms_unit_live_secret_key',
      PAYSTACK_PUBLIC_KEY: 'pk_live_lms_unit_live_public_key',
    });
    expect(env.paystack.enabled).toBe(true);
    expect(() =>
      parseEnv({
        ...stagingBase,
        PAYMENT_PROVIDER: 'paystack',
        PAYSTACK_SECRET_KEY: 'sk_live_lms_unit_live_secret_key',
        PAYSTACK_PUBLIC_KEY: 'pk_live_lms_unit_live_public_key',
        PAYSTACK_API_BASE_URL: 'https://gateway.example.com',
      }),
    ).toThrow(/https:\/\/api\.paystack\.co/);
  });

  it('rejects callback URLs outside the configured browser origins', () => {
    expect(() =>
      parseEnv({
        ...paystackBase,
        PAYSTACK_CALLBACK_URL: 'https://evil.example/checkout/paystack/callback',
      }),
    ).toThrow(/WEB_ORIGIN/);
    expect(() =>
      parseEnv({
        ...paystackBase,
        PAYSTACK_CALLBACK_URL: 'http://localhost:5173/checkout/something-else',
      }),
    ).toThrow(/checkout\/paystack\/callback/);
  });
});

describe('parseEnv — staging/production hardening', () => {
  const prodBase = {
    NODE_ENV: 'production',
    DB_PATH: '/var/lib/lms/data',
    MEDIA_SIGNING_SECRET: 'production-media-signing-key-9f3a7c1e5b2d8a4f',
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
      MEDIA_SIGNING_SECRET: 'stage-media-signing-key-9f3a7c1e5b2d8a4f',
      WEB_ORIGIN: 'https://staging.academy.example.com',
    };
    expect(parseEnv(base).auth.cookieSecure).toBe(true);
    expect(() => parseEnv({ ...base, COOKIE_SECURE: 'false' })).toThrow(/ALLOW_INSECURE_COOKIES/);
    expect(
      parseEnv({ ...base, COOKIE_SECURE: 'false', ALLOW_INSECURE_COOKIES: 'true' }).auth.cookieSecure,
    ).toBe(false);
  });
});

describe('parseEnv — Phase 4 signed media delivery', () => {
  const testBase = {
    NODE_ENV: 'test',
    DB_PATH: 'memory:',
    JWT_SECRET: 'x'.repeat(40),
  };
  const prodBase = {
    NODE_ENV: 'production',
    DB_PATH: '/var/lib/lms/data',
    JWT_SECRET: 'x'.repeat(40),
    WEB_ORIGIN: 'https://academy.example.com',
  };

  it('derives a deterministic, purpose-separated local media key', () => {
    const env = parseEnv(testBase);
    expect(env.media.signingSecret).toBe(deriveMediaSigningSecret(env.auth.jwtSecret));
    expect(env.media.signingSecret).not.toBe(env.auth.jwtSecret);
    expect(parseEnv(testBase).media.signingSecret).toBe(env.media.signingSecret);
  });

  it('requires a dedicated strong media secret in production-like environments', () => {
    expect(() => parseEnv(prodBase)).toThrow(/MEDIA_SIGNING_SECRET is required/);
    expect(() => parseEnv({ ...prodBase, MEDIA_SIGNING_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => parseEnv({ ...prodBase, MEDIA_SIGNING_SECRET: 'changeme-'.repeat(6) })).toThrow(
      /placeholder/,
    );
    const secret = 'production-media-signing-key-9f3a7c1e5b2d8a4f';
    expect(parseEnv({ ...prodBase, MEDIA_SIGNING_SECRET: secret }).media.signingSecret).toBe(secret);
  });

  it('applies media grant and delivery rate-limit defaults and overrides', () => {
    const env = parseEnv(testBase);
    expect(env.rateLimit.mediaGrant).toEqual({ maxAttempts: 30, windowSeconds: 300 });
    expect(env.rateLimit.mediaContent).toEqual({ maxAttempts: 240, windowSeconds: 300 });
    const overridden = parseEnv({
      ...testBase,
      RATE_LIMIT_MEDIA_GRANT_MAX_ATTEMPTS: '5',
      RATE_LIMIT_MEDIA_CONTENT_MAX_ATTEMPTS: '12',
    });
    expect(overridden.rateLimit.mediaGrant.maxAttempts).toBe(5);
    expect(overridden.rateLimit.mediaContent.maxAttempts).toBe(12);
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
        MEDIA_SIGNING_SECRET: 'production-media-signing-key-9f3a7c1e5b2d8a4f',
      }),
    ).toThrow(/DB_PATH must be set explicitly/);
  });
});
