import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const NODE_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

const rawSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  DB_DRIVER: z.literal('pglite').default('pglite'),
  DB_PATH: z.string().min(1).default('./.data/dev'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  ALLOW_INSECURE_COOKIES: z.enum(['true', 'false']).default('false'),
  JWT_SECRET: z.string().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  RATE_LIMIT_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100_000).default(5),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(600),
  RATE_LIMIT_REGISTER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100_000).default(10),
  RATE_LIMIT_REGISTER_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(3600),
  // --- Phase 2: catalogue & commerce ---------------------------------------
  // Currency is an OPEN decision (O-05/O-21); NGN is a development placeholder.
  STORE_CURRENCY: z.string().default('NGN'),
  // The real payment provider is an OPEN decision (O-05). 'simulated' is the
  // only supported value until a provider is approved; production-like
  // environments must opt in explicitly with ALLOW_SIMULATED_PAYMENTS=true.
  PAYMENT_PROVIDER: z.enum(['simulated']).default('simulated'),
  ALLOW_SIMULATED_PAYMENTS: z.enum(['true', 'false']).default('false'),
  SIMULATED_WEBHOOK_SECRET: z.string().optional(),
  // Abandoned-checkout deadline for pending orders.
  CHECKOUT_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  RATE_LIMIT_CHECKOUT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100_000).default(30),
  RATE_LIMIT_CHECKOUT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(300),
});

export interface RateLimitRule {
  maxAttempts: number;
  windowSeconds: number;
}

export interface Env {
  nodeEnv: NodeEnv;
  /** production and staging enforce production-grade security controls. */
  isProductionLike: boolean;
  port: number;
  allowedOrigins: readonly string[];
  trustProxy: boolean;
  db: { driver: 'pglite'; path: string };
  auth: {
    jwtSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    cookieSecure: boolean;
  };
  rateLimit: {
    login: RateLimitRule;
    /** Broader per-IP ceiling that slows password spraying across many accounts. */
    loginPerIp: RateLimitRule;
    register: RateLimitRule;
    /** Order creation / simulated checkout attempts per user. */
    checkout: RateLimitRule;
  };
  commerce: {
    /** Store currency (placeholder pending O-05/O-21). */
    currency: string;
    provider: 'simulated';
    /** True when simulated checkout/webhook endpoints are mounted. */
    simulationEnabled: boolean;
    webhookSecret: string;
    checkoutTtlMinutes: number;
  };
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

const WEAK_SECRET_MARKERS = ['changeme', 'change-me', 'placeholder', 'replace-me', 'replace_with'];
const WEAK_SECRET_EXACT = new Set([
  'secret',
  'password',
  'jwt-secret',
  'jwt_secret',
  'test-secret',
  'dev-secret',
  'example-secret',
]);

/**
 * Pure environment validation. `input` is a plain key/value map (typically
 * `process.env` merged with an environment file). Throws EnvironmentError with
 * a safe, actionable message on any violation.
 *
 * Environment separation rules enforced here:
 * - staging/production: JWT_SECRET must be provided externally, >= 32 chars,
 *   and never a placeholder; DB_PATH must be explicit; cookies are secure;
 *   browser origins must be HTTPS.
 * - development/test: a secret is generated when absent (test: ephemeral per
 *   process; development persistence is handled by loadEnv).
 */
export function parseEnv(input: Record<string, string | undefined>): Env {
  const result = rawSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new EnvironmentError(`Invalid environment configuration — ${details}`);
  }
  const raw = result.data;
  const nodeEnv = raw.NODE_ENV;
  const isProductionLike = nodeEnv === 'production' || nodeEnv === 'staging';

  // --- Browser origins ------------------------------------------------------
  const allowedOrigins = raw.WEB_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (allowedOrigins.length === 0) {
    throw new EnvironmentError('WEB_ORIGIN must list at least one origin');
  }
  for (const origin of allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new EnvironmentError(`WEB_ORIGIN contains an invalid origin: ${origin}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new EnvironmentError(`WEB_ORIGIN must be http(s): ${origin}`);
    }
    if (isProductionLike && parsed.protocol !== 'https:') {
      throw new EnvironmentError(
        `WEB_ORIGIN must use HTTPS in ${nodeEnv}: ${origin}`,
      );
    }
    if (parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '')) {
      // Only scheme://host[:port] origins are allowed (no paths/userinfo).
      throw new EnvironmentError(`WEB_ORIGIN entries must be bare origins: ${origin}`);
    }
  }

  // --- JWT secret -----------------------------------------------------------
  let jwtSecret = raw.JWT_SECRET?.trim() || undefined;
  if (isProductionLike) {
    if (!jwtSecret) {
      throw new EnvironmentError(
        'JWT_SECRET is required in staging/production. Provide it through the deployment secret store — never commit it.',
      );
    }
    if (jwtSecret.length < 32) {
      throw new EnvironmentError('JWT_SECRET must be at least 32 characters in staging/production.');
    }
    const lower = jwtSecret.toLowerCase();
    if (WEAK_SECRET_EXACT.has(lower) || WEAK_SECRET_MARKERS.some((marker) => lower.includes(marker))) {
      throw new EnvironmentError('JWT_SECRET appears to be a placeholder value.');
    }
  } else if (!jwtSecret) {
    jwtSecret = randomBytes(48).toString('base64url');
  }

  // --- Cookie security ------------------------------------------------------
  let cookieSecure: boolean;
  if (nodeEnv === 'production') {
    if (raw.COOKIE_SECURE === 'false') {
      throw new EnvironmentError('COOKIE_SECURE cannot be disabled in production.');
    }
    cookieSecure = true;
  } else if (nodeEnv === 'staging') {
    if (raw.COOKIE_SECURE === 'false') {
      if (raw.ALLOW_INSECURE_COOKIES !== 'true') {
        throw new EnvironmentError(
          'COOKIE_SECURE=false in staging requires an explicit ALLOW_INSECURE_COOKIES=true (local TLS-less staging only).',
        );
      }
      cookieSecure = false;
    } else {
      cookieSecure = true;
    }
  } else {
    cookieSecure = raw.COOKIE_SECURE === 'true';
  }

  // --- Database path --------------------------------------------------------
  if (isProductionLike && input.DB_PATH === undefined) {
    throw new EnvironmentError(
      'DB_PATH must be set explicitly in staging/production (no implicit development default).',
    );
  }

  const loginRule: RateLimitRule = {
    maxAttempts: raw.RATE_LIMIT_LOGIN_MAX_ATTEMPTS,
    windowSeconds: raw.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
  };

  // --- Commerce (Phase 2) ---------------------------------------------------
  const currency = raw.STORE_CURRENCY.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new EnvironmentError('STORE_CURRENCY must be a 3-letter currency code (e.g. NGN).');
  }
  const allowSimulated = raw.ALLOW_SIMULATED_PAYMENTS === 'true';
  const simulationEnabled =
    raw.PAYMENT_PROVIDER === 'simulated' && (!isProductionLike || allowSimulated);

  let webhookSecret = raw.SIMULATED_WEBHOOK_SECRET?.trim() || undefined;
  if (simulationEnabled && isProductionLike) {
    if (!webhookSecret || webhookSecret.length < 32) {
      throw new EnvironmentError(
        'SIMULATED_WEBHOOK_SECRET (>= 32 chars) is required when simulated payments are enabled in staging/production.',
      );
    }
    const lowerSecret = webhookSecret.toLowerCase();
    if (WEAK_SECRET_MARKERS.some((marker) => lowerSecret.includes(marker)) || WEAK_SECRET_EXACT.has(lowerSecret)) {
      throw new EnvironmentError('SIMULATED_WEBHOOK_SECRET appears to be a placeholder value.');
    }
  } else if (!webhookSecret) {
    webhookSecret = randomBytes(48).toString('base64url');
  }

  return Object.freeze({
    nodeEnv,
    isProductionLike,
    port: raw.API_PORT,
    allowedOrigins: Object.freeze([...allowedOrigins]),
    trustProxy: raw.TRUST_PROXY === 'true',
    db: Object.freeze({ driver: raw.DB_DRIVER, path: raw.DB_PATH }),
    auth: Object.freeze({
      jwtSecret,
      accessTokenTtlSeconds: raw.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: raw.REFRESH_TOKEN_TTL_SECONDS,
      cookieSecure,
    }),
    rateLimit: Object.freeze({
      login: Object.freeze(loginRule),
      loginPerIp: Object.freeze({
        maxAttempts: loginRule.maxAttempts * 4,
        windowSeconds: loginRule.windowSeconds,
      }),
      register: Object.freeze({
        maxAttempts: raw.RATE_LIMIT_REGISTER_MAX_ATTEMPTS,
        windowSeconds: raw.RATE_LIMIT_REGISTER_WINDOW_SECONDS,
      }),
      checkout: Object.freeze({
        maxAttempts: raw.RATE_LIMIT_CHECKOUT_MAX_ATTEMPTS,
        windowSeconds: raw.RATE_LIMIT_CHECKOUT_WINDOW_SECONDS,
      }),
    }),
    commerce: Object.freeze({
      currency,
      provider: raw.PAYMENT_PROVIDER,
      simulationEnabled,
      webhookSecret,
      checkoutTtlMinutes: raw.CHECKOUT_TTL_MINUTES,
    }),
    logLevel: raw.LOG_LEVEL,
  });
}

/** Walk up from the given starts to the workspace root (package.json with workspaces). */
export function findWorkspaceRoot(starts: readonly string[]): string {
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
          if (Array.isArray(pkg.workspaces)) return dir;
        } catch {
          // ignore malformed package.json and keep walking
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new EnvironmentError('Could not locate the workspace root (package.json with workspaces).');
}

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). No interpolation. */
export function readEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function resolveDbPath(rawPath: string, root: string): string {
  if (rawPath === 'memory:' || rawPath === ':memory:') return 'memory:';
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath);
}

/**
 * Load environment for the current NODE_ENV.
 *
 * Layering (later wins): `.env.<NODE_ENV>` file at the workspace root, then
 * real process environment (deployment secrets always override files).
 * Development persists an auto-generated JWT secret under `.data/secrets/`
 * (gitignored) so restarts do not invalidate sessions unexpectedly.
 */
export function loadEnv(processEnv: NodeJS.ProcessEnv = process.env): Env {
  const nodeEnvRaw = processEnv.NODE_ENV ?? 'development';
  if (!(NODE_ENVS as readonly string[]).includes(nodeEnvRaw)) {
    throw new EnvironmentError(
      `NODE_ENV must be one of: ${NODE_ENVS.join(', ')} (received "${nodeEnvRaw}")`,
    );
  }
  const nodeEnv = nodeEnvRaw as NodeEnv;
  const root = findWorkspaceRoot([
    process.cwd(),
    path.dirname(fileURLToPath(import.meta.url)),
  ]);

  const merged: Record<string, string | undefined> = {};
  const envFile = path.join(root, `.env.${nodeEnv}`);
  if (fs.existsSync(envFile)) {
    Object.assign(merged, readEnvFile(envFile));
  }
  Object.assign(merged, processEnv);

  if (nodeEnv === 'development' && !merged.JWT_SECRET?.trim()) {
    const secretDir = path.join(root, '.data', 'secrets');
    const secretFile = path.join(secretDir, 'jwt-secret');
    if (fs.existsSync(secretFile)) {
      merged.JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
    } else {
      fs.mkdirSync(secretDir, { recursive: true });
      const secret = randomBytes(48).toString('base64url');
      fs.writeFileSync(secretFile, `${secret}\n`, { mode: 0o600 });
      merged.JWT_SECRET = secret;
    }
  }

  const env = parseEnv(merged);
  return {
    ...env,
    db: { ...env.db, path: resolveDbPath(env.db.path, root) },
  };
}
