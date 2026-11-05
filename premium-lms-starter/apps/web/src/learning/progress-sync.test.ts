import { describe, expect, it, vi } from 'vitest';
import {
  drainProgressEvents,
  enqueueProgressEvent,
  getClientId,
  loadQueue,
  saveQueue,
  type ProgressSyncDeps,
} from './progress-sync.js';
import type { ProgressBatchBody } from './types.js';
import { makeProgressBatchResponse, memoryStorage } from './test-fixtures.js';

function makeDeps(overrides: Partial<ProgressSyncDeps> = {}): ProgressSyncDeps {
  let counter = 0;
  return {
    storage: memoryStorage(),
    isOnline: () => true,
    now: () => '2026-11-05T10:00:00.000Z',
    makeId: () => `event-${++counter}`,
    ...overrides,
  };
}

function responseFor(body: ProgressBatchBody) {
  return makeProgressBatchResponse(body.events, {
    completed: body.events.some((event) => event.type === 'complete'),
  });
}

describe('offline progress-sync queue', () => {
  it('persists a stable client id, monotonic per-lesson sequence and exact event ids', async () => {
    const deps = makeDeps();
    const first = enqueueProgressEvent({ lessonId: 'L1', type: 'start' }, deps);
    const second = enqueueProgressEvent(
      { lessonId: 'L1', type: 'position', progressPercent: 42, positionSeconds: 12 },
      deps,
    );
    const otherLesson = enqueueProgressEvent({ lessonId: 'L2', type: 'start' }, deps);

    expect(first.clientId).toBe(getClientId(deps));
    expect(second.clientId).toBe(first.clientId);
    expect([first.sequence, second.sequence, otherLesson.sequence]).toEqual([1, 2, 1]);
    expect(new Set([first.clientEventId, second.clientEventId, otherLesson.clientEventId]).size).toBe(3);
    expect(loadQueue(deps)).toHaveLength(3);

    const send = vi.fn(async (body: ProgressBatchBody) => responseFor(body));
    const result = await drainProgressEvents('L1', send, deps);
    expect(result.status).toBe('synced');
    expect(result.processed).toBe(2);
    expect(result.pending).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0]?.[0];
    expect(body?.clientId).toBe(first.clientId);
    expect(body?.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(body?.events.map((event) => event.clientEventId)).toEqual([
      first.clientEventId,
      second.clientEventId,
    ]);
    expect(body?.events.every((event) => !('lessonId' in event) && !('clientId' in event))).toBe(true);
    expect(loadQueue(deps).map((event) => event.lessonId)).toEqual(['L2']);
  });

  it('queues while offline and flushes the exact same batch on reconnect', async () => {
    let online = false;
    const deps = makeDeps({ isOnline: () => online });
    const start = enqueueProgressEvent({ lessonId: 'L1', type: 'start' }, deps);
    const complete = enqueueProgressEvent(
      { lessonId: 'L1', type: 'complete', progressPercent: 100 },
      deps,
    );
    const send = vi.fn(async (body: ProgressBatchBody) => responseFor(body));

    const offline = await drainProgressEvents('L1', send, deps);
    expect(offline.status).toBe('offline');
    expect(offline.pending).toBe(2);
    expect(send).not.toHaveBeenCalled();
    expect(loadQueue(deps)).toHaveLength(2);

    online = true;
    const synced = await drainProgressEvents('L1', send, deps);
    expect(synced.status).toBe('synced');
    expect(synced.processed).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0]?.[0];
    expect(body?.events.map((event) => event.type)).toEqual(['start', 'complete']);
    expect(body?.events.map((event) => event.clientEventId)).toEqual([
      start.clientEventId,
      complete.clientEventId,
    ]);
    expect(loadQueue(deps)).toHaveLength(0);

    const again = await drainProgressEvents('L1', send, deps);
    expect(again.status).toBe('idle');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retains the queue after network errors, retrying with unchanged exact-once ids', async () => {
    const deps = makeDeps();
    const first = enqueueProgressEvent({ lessonId: 'L1', type: 'start' }, deps);
    const second = enqueueProgressEvent(
      { lessonId: 'L1', type: 'position', progressPercent: 25 },
      deps,
    );
    const send = vi
      .fn<(body: ProgressBatchBody) => Promise<ReturnType<typeof responseFor>>>()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockImplementationOnce(async (body) => responseFor(body));

    const failed = await drainProgressEvents('L1', send, deps);
    expect(failed.status).toBe('error');
    expect(loadQueue(deps)).toHaveLength(2);

    const recovered = await drainProgressEvents('L1', send, deps);
    expect(recovered.status).toBe('synced');
    expect(send).toHaveBeenCalledTimes(2);
    const b1 = send.mock.calls[0]?.[0];
    const b2 = send.mock.calls[1]?.[0];
    expect(b2?.events.map((event) => event.clientEventId)).toEqual(
      b1?.events.map((event) => event.clientEventId),
    );
    expect(b2?.events.map((event) => event.clientEventId)).toEqual([
      first.clientEventId,
      second.clientEventId,
    ]);
    expect(loadQueue(deps)).toHaveLength(0);
  });

  it('drops terminal 4xx client errors instead of retrying forever', async () => {
    const deps = makeDeps();
    enqueueProgressEvent({ lessonId: 'L1', type: 'complete' }, deps);
    const error = Object.assign(new Error('lesson locked'), { status: 403 });
    const send = vi.fn(async () => {
      throw error;
    });

    const result = await drainProgressEvents('L1', send, deps);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.message).toContain('lesson locked');
    }
    expect(loadQueue(deps)).toHaveLength(0);
    const again = await drainProgressEvents('L1', send, deps);
    expect(again.status).toBe('idle');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('always sends events in ascending sequence order, even from a scrambled queue', async () => {
    const deps = makeDeps();
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      enqueueProgressEvent(
        { lessonId: 'L1', type: 'position', progressPercent: sequence * 10 },
        deps,
      );
    }
    saveQueue([...loadQueue(deps)].reverse(), deps);
    const send = vi.fn(async (body: ProgressBatchBody) => responseFor(body));

    const result = await drainProgressEvents('L1', send, deps);
    expect(result.status).toBe('synced');
    expect(send.mock.calls[0]?.[0].events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });
});
