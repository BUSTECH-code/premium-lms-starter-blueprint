import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { createTestApp, login, register, type TestApp } from './helpers.js';

let testApp: TestApp | undefined;

afterEach(async () => {
  await testApp?.close();
  testApp = undefined;
});

describe('security headers', () => {
  it('sets baseline hardening headers and disables caching of API responses', async () => {
    testApp = await createTestApp();
    const res = await request(testApp.app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('adds HSTS in production-like environments only', async () => {
    testApp = await createTestApp();
    const dev = await request(testApp.app).get('/api/health');
    expect(dev.headers['strict-transport-security']).toBeUndefined();
    await testApp.close();

    testApp = await createTestApp({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-test-secret-at-least-32-characters!!',
      DB_PATH: 'memory:',
      WEB_ORIGIN: 'https://academy.example.com',
    });
    const prod = await request(testApp.app).get('/api/health');
    expect(prod.headers['strict-transport-security']).toContain('max-age=');
  });
});

describe('cookie security flags', () => {
  it('uses httpOnly + SameSite and no Secure flag in development/test', async () => {
    testApp = await createTestApp();
    const { res } = await register(testApp.app, { email: 'flags@example.com' });
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))!;
    const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))!;
    expect(access).toMatch(/HttpOnly/i);
    expect(access).not.toMatch(/Secure/i);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=Strict/i);
  });

  it('forces the Secure attribute in production', async () => {
    testApp = await createTestApp({
      NODE_ENV: 'production',
      JWT_SECRET: 'production-test-secret-at-least-32-characters!!',
      DB_PATH: 'memory:',
      WEB_ORIGIN: 'https://academy.example.com',
    });
    const { res } = await register(testApp.app, { email: 'secure@example.com' });
    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith(`${ACCESS_COOKIE_NAME}=`))).toMatch(/Secure/i);
    expect(cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`))).toMatch(/Secure/i);
  });
});

describe('CORS', () => {
  it('allows configured origins with credentials and reflects no others', async () => {
    testApp = await createTestApp();

    const allowed = await request(testApp.app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(testApp.app)
      .get('/api/health')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    expect(denied.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers preflight requests for allowed origins only', async () => {
    testApp = await createTestApp();

    const preflight = await request(testApp.app)
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(preflight.headers['access-control-allow-headers']).toContain('Content-Type');

    const evilPreflight = await request(testApp.app)
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evilPreflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CSRF origin check on state-changing requests', () => {
  it('rejects mutations from unrecognised origins', async () => {
    testApp = await createTestApp();
    const res = await request(testApp.app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'anyone@example.com', password: 'irrelevant-password' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('origin_not_allowed');
  });

  it('allows mutations from configured origins and from non-browser clients', async () => {
    testApp = await createTestApp();

    const configured = await request(testApp.app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'anyone@example.com', password: 'irrelevant-password' });
    expect(configured.status).toBe(401); // origin passed; credentials rejected

    const noOrigin = await request(testApp.app)
      .post('/api/auth/login')
      .send({ email: 'anyone@example.com', password: 'irrelevant-password' });
    expect(noOrigin.status).toBe(401);
  });

  it('allows proxied requests whose Origin matches X-Forwarded-Host', async () => {
    testApp = await createTestApp();
    const res = await request(testApp.app)
      .post('/api/auth/login')
      .set('Origin', 'https://preview-5173.example.app')
      .set('X-Forwarded-Host', 'preview-5173.example.app')
      .send({ email: 'anyone@example.com', password: 'irrelevant-password' });
    expect(res.status).toBe(401); // origin check passed
  });

  it('does not let a forged X-Forwarded-Host bypass a mismatched Origin', async () => {
    testApp = await createTestApp();
    const res = await request(testApp.app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('X-Forwarded-Host', 'attacker.example')
      .send({ email: 'anyone@example.com', password: 'irrelevant-password' });
    expect(res.status).toBe(403);
  });

  it('never blocks safe methods', async () => {
    testApp = await createTestApp();
    const res = await request(testApp.app)
      .get('/api/health')
      .set('Origin', 'https://anything.example');
    expect(res.status).toBe(200);
  });
});

describe('error contract safety', () => {
  it('never returns stack traces or internal details for 401/403/404', async () => {
    testApp = await createTestApp();
    const unauthorised = await request(testApp.app).get('/api/admin/users');
    const forbidden = await request(testApp.app)
      .get('/api/admin/users')
      .set('Cookie', 'lms_at=invalid');
    const notFound = await request(testApp.app).get('/api/nope');

    for (const res of [unauthorised, forbidden, notFound]) {
      expect(res.body).toHaveProperty('error.code');
      expect(res.body).toHaveProperty('error.message');
      expect(JSON.stringify(res.body)).not.toMatch(/stack|at Object|\/home\/|node_modules/i);
    }
  });

  it('login failures do not reveal whether the account exists', async () => {
    testApp = await createTestApp();
    await register(testApp.app, { email: 'real@example.com' });

    const real = (await login(testApp.app, 'real@example.com', 'wrong-password-x')).res;
    const fake = (await login(testApp.app, 'ghost@example.com', 'wrong-password-x')).res;

    expect(real.status).toBe(fake.status);
    expect(real.body.error).toEqual(fake.body.error);
    expect(real.body.error.message).toBe('Invalid email or password.');
  });
});
