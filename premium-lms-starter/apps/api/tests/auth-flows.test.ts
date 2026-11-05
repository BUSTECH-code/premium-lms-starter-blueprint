import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { verifyPassword } from '../src/auth/passwords.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../src/auth/cookies.js';
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../src/auth/tokens.js';
import {
  DEFAULT_PASSWORD,
  createTestApp,
  login,
  register,
  type TestApp,
} from './helpers.js';

let testApp: TestApp | undefined;

afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});

describe('GET /api/health', () => {
  it('reports readiness', async () => {
    testApp = await createTestApp();
    const res = await request(testApp.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', environment: 'test' });
  });
});

describe('registration', () => {
  it('creates a student account, sets secure session cookies and never leaks the hash', async () => {
    testApp = await createTestApp();
    const { res, jar } = await register(testApp.app, {
      email: 'Ada@Example.com',
      name: 'Ada Lovelace',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('ada@example.com'); // normalised
    expect(res.body.user.roles).toEqual(['student']);
    expect(res.body.user.permissions).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(JSON.stringify(res.body)).not.toContain('$argon2id$');

    // cookies: access + refresh, httpOnly, correct flags
    expect(jar.get(ACCESS_COOKIE_NAME)).toBeTruthy();
    expect(jar.get(REFRESH_COOKIE_NAME)).toBeTruthy();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))!;
    const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))!;
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(access).toMatch(/Path=\//i);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=Strict/i);
    expect(refresh).toMatch(new RegExp(`Path=${REFRESH_COOKIE_PATH.replace(/\//g, '\\/')}`));

    // stored credential is a real argon2id hash
    const { rows } = await testApp.db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      ['ada@example.com'],
    );
    expect(await verifyPassword(rows[0]!.password_hash, 'Ada@Example.com')).toBe(false);
    expect(await verifyPassword(rows[0]!.password_hash, DEFAULT_PASSWORD)).toBe(true);
  });

  it('rejects duplicate registrations', async () => {
    testApp = await createTestApp();
    await register(testApp.app, { email: 'dup@example.com' });
    const second = await register(testApp.app, { email: 'dup@example.com' });
    expect(second.res.status).toBe(409);
    expect(second.res.body.error.code).toBe('email_taken');
  });

  it('validates input server-side', async () => {
    testApp = await createTestApp();

    const badEmail = await request(testApp.app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'not-an-email', password: DEFAULT_PASSWORD });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error.code).toBe('bad_request');
    expect(badEmail.body.error.details.some((d: { path: string }) => d.path === 'email')).toBe(true);

    const shortPassword = await request(testApp.app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'ok@example.com', password: 'short' });
    expect(shortPassword.status).toBe(400);

    const missingName = await request(testApp.app)
      .post('/api/auth/register')
      .send({ email: 'ok@example.com', password: DEFAULT_PASSWORD });
    expect(missingName.status).toBe(400);

    const badJson = await request(testApp.app)
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe('bad_json');
  });
});

describe('login', () => {
  it('authenticates with correct credentials and issues a session', async () => {
    testApp = await createTestApp();
    await register(testApp.app, { email: 'login@example.com' });
    const { res, jar } = await login(testApp.app, 'login@example.com');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('login@example.com');
    expect(jar.get(ACCESS_COOKIE_NAME)).toBeTruthy();
    expect(jar.get(REFRESH_COOKIE_NAME)).toBeTruthy();
  });

  it('returns an identical generic error for unknown email and wrong password', async () => {
    testApp = await createTestApp();
    await register(testApp.app, { email: 'known@example.com' });

    const unknown = (await login(testApp.app, 'nobody@example.com')).res;
    const wrongPassword = (await login(testApp.app, 'known@example.com', 'wrong-password-123')).res;

    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknown.body.error).toEqual(wrongPassword.body.error);
    expect(unknown.body.error.code).toBe('invalid_credentials');
    expect(unknown.body.error.message).toBe('Invalid email or password.');
    expect(JSON.stringify(unknown.body)).not.toContain('nobody@example.com');
  });

  it('blocks suspended accounts only after a correct password', async () => {
    testApp = await createTestApp();
    const { res } = await register(testApp.app, { email: 'suspended@example.com' });
    const userId = res.body.user.id as string;
    await testApp.db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [userId]);

    const wrongPw = (await login(testApp.app, 'suspended@example.com', 'not-the-password')).res;
    expect(wrongPw.status).toBe(401);
    expect(wrongPw.body.error.code).toBe('invalid_credentials');

    const correctPw = (await login(testApp.app, 'suspended@example.com')).res;
    expect(correctPw.status).toBe(403);
    expect(correctPw.body.error.code).toBe('account_suspended');
  });

  it('is rate limited per account+IP with a Retry-After header', async () => {
    testApp = await createTestApp({
      RATE_LIMIT_LOGIN_MAX_ATTEMPTS: '3',
      RATE_LIMIT_LOGIN_WINDOW_SECONDS: '600',
    });
    await register(testApp.app, { email: 'limited@example.com' });

    for (let i = 0; i < 3; i += 1) {
      const attempt = (await login(testApp.app, 'limited@example.com', 'wrong-password')).res;
      expect(attempt.status).toBe(401);
    }
    const denied = (await login(testApp.app, 'limited@example.com', 'wrong-password')).res;
    expect(denied.status).toBe(429);
    expect(denied.body.error.code).toBe('rate_limited');
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('resets the login rate limit after a successful login', async () => {
    testApp = await createTestApp({
      RATE_LIMIT_LOGIN_MAX_ATTEMPTS: '3',
      RATE_LIMIT_LOGIN_WINDOW_SECONDS: '600',
    });
    await register(testApp.app, { email: 'reset@example.com' });

    expect((await login(testApp.app, 'reset@example.com', 'bad-1')).res.status).toBe(401);
    expect((await login(testApp.app, 'reset@example.com', 'bad-2')).res.status).toBe(401);
    expect((await login(testApp.app, 'reset@example.com')).res.status).toBe(200); // resets

    expect((await login(testApp.app, 'reset@example.com', 'bad-1')).res.status).toBe(401);
    expect((await login(testApp.app, 'reset@example.com', 'bad-2')).res.status).toBe(401);
    expect((await login(testApp.app, 'reset@example.com', 'bad-3')).res.status).toBe(401);
    const denied = (await login(testApp.app, 'reset@example.com', 'bad-4')).res;
    expect(denied.status).toBe(429); // only reached after the post-reset budget
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated user', async () => {
    testApp = await createTestApp();
    const { jar } = await register(testApp.app, { email: 'me@example.com' });
    const res = await request(testApp.app)
      .get('/api/auth/me')
      .set('Cookie', jar.header());
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@example.com');
    expect(res.body.user.roles).toEqual(['student']);
  });

  it('rejects missing, garbage and expired access tokens', async () => {
    testApp = await createTestApp();
    const { jar } = await register(testApp.app, { email: 'tokens@example.com' });

    const missing = await request(testApp.app).get('/api/auth/me');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('authentication_required');

    const garbage = await request(testApp.app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=totally-invalid`);
    expect(garbage.status).toBe(401);

    // Expired token that is otherwise perfectly formed (valid session id)
    const { rows: sessionRows } = await testApp.db.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM sessions',
    );
    const key = new TextEncoder().encode(testApp.env.auth.jwtSecret);
    const expired = await new SignJWT({ sid: sessionRows[0]!.id, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sessionRows[0]!.user_id)
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
      .sign(key);
    const expiredRes = await request(testApp.app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_COOKIE_NAME}=${expired}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.code).toBe('invalid_token');
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token on every use', async () => {
    testApp = await createTestApp();
    const { jar } = await register(testApp.app, { email: 'rotate@example.com' });
    const firstRefresh = jar.get(REFRESH_COOKIE_NAME)!;

    const res = await request(testApp.app)
      .post('/api/auth/refresh')
      .set('Cookie', jar.header());
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('rotate@example.com');

    const secondRefresh = res.headers['set-cookie']!
      .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))!
      .split(';')[0]!
      .split('=')[1]!;
    expect(secondRefresh).not.toBe(firstRefresh);
    expect(secondRefresh).toBeTruthy();
  });

  it('detects refresh token reuse, revokes the session and invalidates everything', async () => {
    testApp = await createTestApp();
    const { jar } = await register(testApp.app, { email: 'reuse@example.com' });
    const originalRefresh = jar.get(REFRESH_COOKIE_NAME)!;

    // First refresh succeeds and rotates to a new token
    const first = await request(testApp.app)
      .post('/api/auth/refresh')
      .set('Cookie', jar.header());
    expect(first.status).toBe(200);
    const rotatedRefresh = first.headers['set-cookie']!
      .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))!
      .split(';')[0]!
      .split('=')[1]!;

    // Replaying the ORIGINAL token is reuse → session revoked
    const replay = await request(testApp.app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${originalRefresh}`);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('refresh_token_reuse');

    // The rotated token is now dead too because the session was revoked
    const afterReuse = await request(testApp.app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${rotatedRefresh}`);
    expect(afterReuse.status).toBe(401);

    // And the access token no longer authorises anything
    const me = await request(testApp.app).get('/api/auth/me').set('Cookie', jar.header());
    expect(me.status).toBe(401);

    // Audit trail in the session row
    const { rows } = await testApp.db.query<{ revoked_reason: string }>(
      'SELECT revoked_reason FROM sessions',
    );
    expect(rows.some((r) => r.revoked_reason === 'reuse_detected')).toBe(true);
  });

  it('rejects refresh without a cookie and with an unknown token', async () => {
    testApp = await createTestApp();
    const missing = await request(testApp.app).post('/api/auth/refresh');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('refresh_token_missing');

    const unknown = await request(testApp.app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=unknown-token-value`);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('invalid_refresh_token');
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and is idempotent', async () => {
    testApp = await createTestApp();
    const { jar } = await register(testApp.app, { email: 'logout@example.com' });

    const first = await request(testApp.app).post('/api/auth/logout').set('Cookie', jar.header());
    expect(first.status).toBe(204);
    // cookies cleared
    const cleared = first.headers['set-cookie'] as unknown as string[];
    expect(cleared.some((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=;`))).toBe(true);

    const second = await request(testApp.app).post('/api/auth/logout').set('Cookie', jar.header());
    expect(second.status).toBe(204);

    const me = await request(testApp.app).get('/api/auth/me').set('Cookie', jar.header());
    expect(me.status).toBe(401);

    const refresh = await request(testApp.app)
      .post('/api/auth/refresh')
      .set('Cookie', jar.header());
    expect(refresh.status).toBe(401);
  });

  it('revokes via the refresh cookie even when no access token is presented', async () => {
    testApp = await createTestApp();
    const { jar } = await register(testApp.app, { email: 'logout-expired@example.com' });

    const logout = await request(testApp.app)
      .post('/api/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${jar.get(REFRESH_COOKIE_NAME)!}`);
    expect(logout.status).toBe(204);

    const { rows } = await testApp.db.query<{ revoked_reason: string }>(
      'SELECT revoked_reason FROM sessions',
    );
    expect(rows[0]?.revoked_reason).toBe('logout');
  });
});

describe('session revocation is immediate', () => {
  it('a revoked session invalidates an unexpired access token', async () => {
    testApp = await createTestApp();
    const { jar } = await register(testApp.app, { email: 'revoked@example.com' });

    // healthy request first
    expect((await request(testApp.app).get('/api/auth/me').set('Cookie', jar.header())).status).toBe(200);

    const { rows } = await testApp.db.query<{ id: string }>('SELECT id FROM sessions');
    await testApp.db.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'admin_revoked' WHERE id = $1`,
      [rows[0]!.id],
    );

    const after = await request(testApp.app).get('/api/auth/me').set('Cookie', jar.header());
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('session_revoked');
  });
});

describe('unknown routes', () => {
  it('returns the standard 404 contract', async () => {
    testApp = await createTestApp();
    const res = await request(testApp.app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
