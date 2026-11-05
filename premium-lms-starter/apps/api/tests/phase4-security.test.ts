import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { progressBatchChecksum, type CanonicalProgressEvent } from '@lms/shared';
import { api, createTestApp, register, type TestApp } from './helpers.js';
import {
  grantLearningAccess,
  makeFixtureUser,
  seedLearningCourse,
  type LearningCourseSeed,
} from './fixtures.js';

type Jar = Awaited<ReturnType<typeof register>>['jar'];
const CLIENT_ID = 'phase4-security-device';

let test: TestApp;
let learnerJar: Jar;
let learnerId: string;
let seed: LearningCourseSeed;
let videoId: string;

function progressEvent(sequence: number, type: 'start' | 'position' | 'complete') {
  return {
    clientEventId: `phase4-${sequence}-${Math.random().toString(36).slice(2)}`,
    sequence,
    type,
    occurredAt: new Date().toISOString(),
    ...(type === 'position' ? { progressPercent: 25, positionSeconds: 1 } : {}),
  };
}

function progressBatch(lessonId: string, events: ReturnType<typeof progressEvent>[]) {
  const canonical = events as unknown as CanonicalProgressEvent[];
  return {
    clientId: CLIENT_ID,
    events,
    checksum: progressBatchChecksum({ clientId: CLIENT_ID, events: canonical }),
  };
}

beforeAll(async () => {
  test = await createTestApp();
  const instructor = await makeFixtureUser(test.db, { name: 'Phase 4 Instructor' });
  const registration = await register(test.app, { email: 'phase4-learner@example.com' });
  expect(registration.res.status).toBe(201);
  learnerJar = registration.jar;
  learnerId = registration.res.body.user.id as string;
  seed = await seedLearningCourse(test.db, {
    createdBy: instructor.id,
    slug: 'phase4-security-course',
    title: 'Phase 4 Security Course',
  });
  await grantLearningAccess(test.db, learnerId, seed.id);
  const video = seed.lessons.find((lesson) => lesson.kind === 'video');
  if (!video) throw new Error('Phase 4 fixture has no video lesson');
  videoId = video.id;
});

afterAll(async () => {
  await test?.close();
});

describe('Phase 4 signed media delivery and audit', () => {
  it('returns an opaque session watermark and signed URL, then delivers only from an approved context', async () => {
    const detail = await api(test.app, learnerJar).get(`/api/learning/lessons/${videoId}`);
    expect(detail.status).toBe(200);

    const viewer = detail.body.viewer as {
      email: string;
      sessionRef: string;
      issuedAt: string;
    };
    expect(viewer.email).toBe('phase4-learner@example.com');
    expect(viewer.sessionRef).toMatch(/^[0-9a-f]{12}$/);
    expect(Number.isNaN(Date.parse(viewer.issuedAt))).toBe(false);

    const { rows: sessions } = await test.db.query<{ id: string }>(
      'SELECT id::text FROM sessions WHERE user_id = $1',
      [learnerId],
    );
    const rawSessionId = sessions[0]?.id;
    expect(rawSessionId).toBeTruthy();
    expect(JSON.stringify(detail.body)).not.toContain(rawSessionId!);

    const media = detail.body.content.media as { url: string; purpose: string };
    const url = new URL(media.url, 'http://localhost');
    expect([...url.searchParams.keys()].sort()).toEqual([
      'exp',
      'grant',
      'nonce',
      'purpose',
      'sid',
      'sig',
    ]);
    expect(url.searchParams.get('purpose')).toBe('stream');
    expect(url.searchParams.get('sid')).toBe(viewer.sessionRef);
    expect(url.searchParams.get('grant')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('sig')).toMatch(/^[0-9a-f]{64}$/);
    expect(media.url).not.toContain('download=1');

    const approved = await request(test.app)
      .get(media.url)
      .set('Cookie', learnerJar.header())
      .set('Referer', 'http://localhost:5173/learn/phase4-security-course')
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Sec-Fetch-Dest', 'video');
    expect(approved.status).toBe(200);
    expect(approved.headers['cache-control']).toBe('no-store');
    expect(approved.headers['pragma']).toBe('no-cache');
    expect(approved.headers['x-robots-tag']).toContain('noindex');
    expect(approved.headers['cross-origin-resource-policy']).toBe('same-site');

    const hotlink = await request(test.app)
      .get(media.url)
      .set('Cookie', learnerJar.header())
      .set('Referer', 'https://hotlink.example/watch')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Sec-Fetch-Dest', 'video');
    expect(hotlink.status).toBe(403);
    expect(hotlink.body.error.code).toBe('media_hotlink_blocked');

    const tampered = media.url.replace(/sig=[0-9a-f]{64}/, `sig=${'0'.repeat(64)}`);
    const invalidSignature = await request(test.app)
      .get(tampered)
      .set('Cookie', learnerJar.header())
      .set('Referer', 'http://localhost:5173/learn/phase4-security-course')
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Sec-Fetch-Dest', 'video');
    expect(invalidSignature.status).toBe(403);
    expect(invalidSignature.body.error.code).toBe('media_signature_invalid');

    const iframe = await request(test.app)
      .get(media.url)
      .set('Cookie', learnerJar.header())
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Sec-Fetch-Dest', 'iframe');
    expect(iframe.status).toBe(403);
    expect(iframe.body.error.code).toBe('media_hotlink_blocked');

    const { rows: audits } = await test.db.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM audit_events
        WHERE action IN ('media.grant_issued', 'media.content_delivered', 'media.access_denied')`,
    );
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('media.grant_issued');
    expect(actions).toContain('media.content_delivered');
    expect(actions).toContain('media.access_denied');
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(media.url);
    expect(serialized).not.toContain(url.searchParams.get('grant')!);
    expect(serialized).toContain('hotlink_or_embedding');
    expect(serialized).toContain('media_signature_invalid');
  });
});

describe('Phase 4 progressive-sync integrity', () => {
  it('rejects tampered, duplicate and non-ascending progress batches before writing', async () => {
    const body = progressBatch(videoId, [progressEvent(1, 'start'), progressEvent(2, 'position')]);
    const tampered = { ...body, checksum: 'f'.repeat(64) };
    const rejected = await api(test.app, learnerJar)
      .post(`/api/learning/lessons/${videoId}/progress/events`)
      .send(tampered);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('progress_checksum_invalid');

    const duplicates = progressBatch(videoId, [
      { ...progressEvent(1, 'start'), clientEventId: 'phase4-duplicate' },
      { ...progressEvent(2, 'position'), clientEventId: 'phase4-duplicate' },
    ]);
    const duplicate = await api(test.app, learnerJar)
      .post(`/api/learning/lessons/${videoId}/progress/events`)
      .send(duplicates);
    expect(duplicate.status).toBe(400);

    const descending = progressBatch(videoId, [progressEvent(2, 'start'), progressEvent(1, 'position')]);
    const outOfOrder = await api(test.app, learnerJar)
      .post(`/api/learning/lessons/${videoId}/progress/events`)
      .send(descending);
    expect(outOfOrder.status).toBe(400);

    const accepted = await api(test.app, learnerJar)
      .post(`/api/learning/lessons/${videoId}/progress/events`)
      .send(body);
    expect(accepted.status).toBe(200);
    expect(accepted.body.results.map((result: { outcome: string }) => result.outcome)).toEqual([
      'applied',
      'applied',
    ]);

    const { rows: audits } = await test.db.query<{ metadata: unknown }>(
      "SELECT metadata FROM audit_events WHERE action = 'progress.batch_rejected'",
    );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]?.metadata ?? {})).toContain('integrity_digest_mismatch');
  });
});

describe('Phase 4 media rate limits', () => {
  it('limits repeated grant issuance and delivery requests per session', async () => {
    const limited = await createTestApp({
      RATE_LIMIT_MEDIA_GRANT_MAX_ATTEMPTS: '2',
      RATE_LIMIT_MEDIA_CONTENT_MAX_ATTEMPTS: '2',
    });
    try {
      const instructor = await makeFixtureUser(limited.db, { name: 'Rate Limit Instructor' });
      const registration = await register(limited.app, { email: 'phase4-limits@example.com' });
      const jar = registration.jar;
      const userId = registration.res.body.user.id as string;
      const course = await seedLearningCourse(limited.db, {
        createdBy: instructor.id,
        slug: 'phase4-rate-limit-course',
        title: 'Phase 4 Rate Limit Course',
      });
      await grantLearningAccess(limited.db, userId, course.id);
      const lesson = course.lessons.find((item) => item.kind === 'video');
      if (!lesson) throw new Error('rate-limit fixture has no video lesson');

      const grantPath = `/api/learning/lessons/${lesson.id}/media`;
      const first = await api(limited.app, jar).post(grantPath).send({ purpose: 'stream' });
      const second = await api(limited.app, jar).post(grantPath).send({ purpose: 'stream' });
      const third = await api(limited.app, jar).post(grantPath).send({ purpose: 'stream' });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('rate_limited');
      expect(third.headers['retry-after']).toBeTruthy();

      const mediaUrl = first.body.media.url as string;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const delivered = await request(limited.app)
          .get(mediaUrl)
          .set('Cookie', jar.header())
          .set('Referer', 'http://localhost:5173/learn')
          .set('Sec-Fetch-Site', 'same-origin')
          .set('Sec-Fetch-Dest', 'video');
        expect(delivered.status).toBe(200);
      }
      const blocked = await request(limited.app)
        .get(mediaUrl)
        .set('Cookie', jar.header())
        .set('Referer', 'http://localhost:5173/learn')
        .set('Sec-Fetch-Site', 'same-origin')
        .set('Sec-Fetch-Dest', 'video');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('rate_limited');
      expect(blocked.headers['retry-after']).toBeTruthy();
    } finally {
      await limited.close();
    }
  });
});
