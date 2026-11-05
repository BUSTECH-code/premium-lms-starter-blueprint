/**
 * Offline-safe progress queue (client side).
 *
 * The server is authoritative. Events carry a stable clientEventId (exact-once)
 * and a per-device, per-lesson sequence (stale-event conflict rule). While
 * offline they stay in localStorage; on reconnect they are flushed in sequence
 * order. A stale client never overwrites newer server progress.
 */

import type {
  ClientProgressEventType,
  ProgressBatchBody,
  ProgressBatchResponse,
  ProgressEventBody,
} from './types.js';

export const PROGRESS_QUEUE_KEY = 'lms.progress.queue.v1';
export const PROGRESS_CLIENT_KEY = 'lms.progress.client-id.v1';
export const PROGRESS_SEQUENCE_KEY = 'lms.progress.sequences.v1';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ProgressSyncDeps {
  storage?: StorageLike;
  isOnline?: () => boolean;
  now?: () => string;
  makeId?: () => string;
}

export interface PendingProgressEvent extends ProgressEventBody {
  lessonId: string;
  clientId: string;
}

export interface EnqueueProgressInput {
  lessonId: string;
  type: ClientProgressEventType;
  progressPercent?: number;
  positionSeconds?: number;
}

export type DrainResult =
  | { status: 'idle'; processed: number; pending: number; response: null }
  | { status: 'offline'; processed: number; pending: number; response: null }
  | { status: 'synced'; processed: number; pending: number; response: ProgressBatchResponse }
  | { status: 'error'; processed: number; pending: number; response: null; message: string }
  | { status: 'rejected'; processed: number; pending: number; response: null; message: string };

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

let fallbackStorage: MemoryStorage | null = null;

function storageOf(deps: ProgressSyncDeps = {}): StorageLike {
  if (deps.storage) return deps.storage;
  try {
    return window.localStorage;
  } catch {
    fallbackStorage ??= new MemoryStorage();
    return fallbackStorage;
  }
}

export function newId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return cryptoObject.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage: StorageLike, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage quota / privacy mode: fall back to an in-process queue so the
    // current session still works, rather than losing the event silently.
    fallbackStorage ??= new MemoryStorage();
    if (fallbackStorage !== storage) fallbackStorage.setItem(key, JSON.stringify(value));
  }
}

export function loadQueue(deps: ProgressSyncDeps = {}): PendingProgressEvent[] {
  const value = readJson<unknown>(storageOf(deps), PROGRESS_QUEUE_KEY, []);
  return Array.isArray(value) ? (value as PendingProgressEvent[]) : [];
}

export function saveQueue(events: PendingProgressEvent[], deps: ProgressSyncDeps = {}): void {
  writeJson(storageOf(deps), PROGRESS_QUEUE_KEY, events);
}

function loadSequences(deps: ProgressSyncDeps = {}): Record<string, number> {
  const value = readJson<unknown>(storageOf(deps), PROGRESS_SEQUENCE_KEY, {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, number>;
}

export function getClientId(deps: ProgressSyncDeps = {}): string {
  const storage = storageOf(deps);
  const existing = storage.getItem(PROGRESS_CLIENT_KEY);
  if (existing && existing.length <= 80) return existing;
  const id = `web-${(deps.makeId ?? newId)()}`;
  try {
    storage.setItem(PROGRESS_CLIENT_KEY, id);
  } catch {
    fallbackStorage ??= new MemoryStorage();
    if (fallbackStorage !== storage) fallbackStorage.setItem(PROGRESS_CLIENT_KEY, id);
  }
  return id;
}

export function enqueueProgressEvent(
  input: EnqueueProgressInput,
  deps: ProgressSyncDeps = {},
): PendingProgressEvent {
  const storage = storageOf(deps);
  const clientId = getClientId(deps);
  const sequences = loadSequences(deps);
  const sequence = (sequences[input.lessonId] ?? 0) + 1;
  sequences[input.lessonId] = sequence;
  writeJson(storage, PROGRESS_SEQUENCE_KEY, sequences);

  const event: PendingProgressEvent = {
    lessonId: input.lessonId,
    clientId,
    clientEventId: (deps.makeId ?? newId)(),
    sequence,
    type: input.type,
    occurredAt: (deps.now ?? (() => new Date().toISOString()))(),
    ...(input.progressPercent !== undefined ? { progressPercent: input.progressPercent } : {}),
    ...(input.positionSeconds !== undefined ? { positionSeconds: input.positionSeconds } : {}),
  };
  const queue = loadQueue(deps);
  queue.push(event);
  saveQueue(queue, deps);
  return event;
}

function toBatchBody(events: PendingProgressEvent[]): ProgressBatchBody {
  const clientId = events[0]?.clientId ?? 'web-unknown';
  return {
    clientId,
    events: events.map(({ lessonId: _lessonId, clientId: _clientId, ...event }) => event),
  };
}

function isTerminalClientError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

function pendingForLesson(lessonId: string, deps: ProgressSyncDeps = {}): number {
  return loadQueue(deps).filter((event) => event.lessonId === lessonId).length;
}

/**
 * Flush queued events for one lesson. Successful, duplicate, stale and
 * server-rejected events are terminal and removed; network/5xx failures keep
 * the queue intact for the next reconnect.
 */
export async function drainProgressEvents(
  lessonId: string,
  send: (body: ProgressBatchBody) => Promise<ProgressBatchResponse>,
  deps: ProgressSyncDeps = {},
): Promise<DrainResult> {
  const isOnline = deps.isOnline ?? (() => navigator.onLine);
  const queued = loadQueue(deps)
    .filter((event) => event.lessonId === lessonId)
    .sort((a, b) => a.sequence - b.sequence);
  const pending = queued.length;

  if (!isOnline()) {
    return { status: 'offline', processed: 0, pending, response: null };
  }
  if (pending === 0) {
    return { status: 'idle', processed: 0, pending: 0, response: null };
  }

  let processed = 0;
  let lastResponse: ProgressBatchResponse | null = null;
  for (let offset = 0; offset < queued.length; offset += 50) {
    const chunk = queued.slice(offset, offset + 50);
    try {
      const response = await send(toBatchBody(chunk));
      lastResponse = response;
      processed += chunk.length;
      const ids = new Set(chunk.map((event) => event.clientEventId));
      const fresh = loadQueue(deps);
      saveQueue(
        fresh.filter((event) => !ids.has(event.clientEventId)),
        deps,
      );
      const rejected = response.results.find((result) => result.outcome === 'rejected');
      if (rejected) {
        return {
          status: 'rejected',
          processed,
          pending: pendingForLesson(lessonId, deps),
          response: null,
          message: rejected.reason ?? 'A progress event was rejected.',
        };
      }
    } catch (error) {
      if (isTerminalClientError(error)) {
        // e.g. lesson_locked / authentication: retrying forever cannot help.
        const ids = new Set(chunk.map((event) => event.clientEventId));
        const fresh = loadQueue(deps);
        saveQueue(
          fresh.filter((event) => !ids.has(event.clientEventId)),
          deps,
        );
        return {
          status: 'rejected',
          processed,
          pending: pendingForLesson(lessonId, deps),
          response: null,
          message:
            error instanceof Error ? error.message : 'Progress could not be saved.',
        };
      }
      return {
        status: 'error',
        processed,
        pending: pendingForLesson(lessonId, deps),
        response: null,
        message: 'Could not sync progress. It will be retried when you reconnect.',
      };
    }
  }

  return {
    status: 'synced',
    processed,
    pending: pendingForLesson(lessonId, deps),
    response: lastResponse as ProgressBatchResponse,
  };
}
