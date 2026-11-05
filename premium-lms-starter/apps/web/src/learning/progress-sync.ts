/**
 * Hardened offline-safe progress queue (client side).
 *
 * The server is authoritative. Events carry a stable clientEventId (exact-once)
 * and a per-device, per-lesson sequence (stale-event conflict rule). While
 * offline they stay in localStorage; on reconnect they are flushed in sequence
 * order. A SHA-256 queue checksum detects corruption/tampering and quarantines
 * the raw data rather than silently losing it. Each batch carries a SHA-256
 * digest that the API recomputes before any write. Neither digest is a secret
 * or a browser-trust proof: entitlement, unlock, sequence, event shape and
 * state transitions are still enforced on the server.
 */

import { progressBatchChecksum, sha256Hex } from '@lms/shared';
import type {
  ClientProgressEventType,
  ProgressBatchBody,
  ProgressBatchResponse,
  ProgressEventBody,
} from './types.js';

export const PROGRESS_QUEUE_KEY = 'lms.progress.queue.v1';
export const PROGRESS_CHECKSUM_KEY = 'lms.progress.queue.checksum.v1';
export const PROGRESS_QUARANTINE_KEY = 'lms.progress.queue.quarantine.v1';
export const PROGRESS_INTEGRITY_KEY = 'lms.progress.queue.integrity.v1';
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

export interface QuarantineRecord {
  reason: string;
  at: string;
  raw?: string;
  events?: PendingProgressEvent[];
}

export interface QueueIntegrity {
  tampered: boolean;
  reason: string | null;
  at: string | null;
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

function writeRaw(storage: StorageLike, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage quota / privacy mode: fall back to an in-process queue so the
    // current session still works, rather than losing the event silently.
    fallbackStorage ??= new MemoryStorage();
    if (fallbackStorage !== storage) fallbackStorage.setItem(key, value);
  }
}

function writeJson(storage: StorageLike, key: string, value: unknown): void {
  writeRaw(storage, key, JSON.stringify(value));
}

function removeKey(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    fallbackStorage?.removeItem(key);
  }
}

function canonicalQueue(events: PendingProgressEvent[], clientId: string): string {
  const fieldSeparator = '\u001f';
  const eventSeparator = '\u001e';
  const lines = events.map((event) =>
    [
      event.lessonId,
      event.clientId,
      event.clientEventId,
      String(event.sequence),
      event.type,
      event.occurredAt,
      event.progressPercent === undefined ? 'null' : String(event.progressPercent),
      event.positionSeconds === undefined ? 'null' : String(event.positionSeconds),
    ].join(fieldSeparator),
  );
  return ['lms.progress.queue.v1', clientId, ...lines].join(eventSeparator);
}

function queueChecksum(events: PendingProgressEvent[], deps: ProgressSyncDeps): string {
  return sha256Hex(canonicalQueue(events, getClientId(deps)));
}

function quarantineRecord(record: QuarantineRecord, deps: ProgressSyncDeps): void {
  const storage = storageOf(deps);
  const existing = readJson<unknown>(storage, PROGRESS_QUARANTINE_KEY, []);
  const records = Array.isArray(existing) ? (existing as QuarantineRecord[]) : [];
  writeJson(storage, PROGRESS_QUARANTINE_KEY, [...records, record]);
}

function markTampered(reason: string, deps: ProgressSyncDeps): void {
  writeJson(storageOf(deps), PROGRESS_INTEGRITY_KEY, {
    tampered: true,
    reason,
    at: (deps.now ?? (() => new Date().toISOString()))(),
  });
}

function consumeQueueIntegrity(deps: ProgressSyncDeps): QueueIntegrity {
  const storage = storageOf(deps);
  const value = readJson<QueueIntegrity>(storage, PROGRESS_INTEGRITY_KEY, {
    tampered: false,
    reason: null,
    at: null,
  });
  if (value?.tampered) removeKey(storage, PROGRESS_INTEGRITY_KEY);
  return value;
}

export function getQueueIntegrity(deps: ProgressSyncDeps = {}): QueueIntegrity {
  return readJson<QueueIntegrity>(storageOf(deps), PROGRESS_INTEGRITY_KEY, {
    tampered: false,
    reason: null,
    at: null,
  });
}

/** Preserved raw/structured data for support review — never silently discarded. */
export function getQuarantine(deps: ProgressSyncDeps = {}): QuarantineRecord[] {
  const value = readJson<unknown>(storageOf(deps), PROGRESS_QUARANTINE_KEY, []);
  return Array.isArray(value) ? (value as QuarantineRecord[]) : [];
}

export function loadQueue(deps: ProgressSyncDeps = {}): PendingProgressEvent[] {
  const storage = storageOf(deps);
  const raw = storage.getItem(PROGRESS_QUEUE_KEY);
  if (raw === null) {
    saveQueue([], deps);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    quarantineRecord(
      { reason: 'unparseable_queue', at: (deps.now ?? (() => new Date().toISOString()))(), raw },
      deps,
    );
    markTampered('unparseable_queue', deps);
    saveQueue([], deps);
    return [];
  }

  if (!Array.isArray(parsed)) {
    quarantineRecord(
      { reason: 'non_array_queue', at: (deps.now ?? (() => new Date().toISOString()))(), raw },
      deps,
    );
    markTampered('non_array_queue', deps);
    saveQueue([], deps);
    return [];
  }
  const events = parsed as PendingProgressEvent[];
  const checksum = storage.getItem(PROGRESS_CHECKSUM_KEY);
  if (checksum === null) {
    // Backwards-compatible migration for pre-Phase-4 queues.
    saveQueue(events, deps);
    return events;
  }
  if (checksum !== queueChecksum(events, deps)) {
    quarantineRecord(
      {
        reason: 'checksum_mismatch',
        at: (deps.now ?? (() => new Date().toISOString()))(),
        raw,
        events,
      },
      deps,
    );
    markTampered('checksum_mismatch', deps);
    saveQueue([], deps);
    return [];
  }
  return events;
}

export function saveQueue(events: PendingProgressEvent[], deps: ProgressSyncDeps = {}): void {
  const storage = storageOf(deps);
  writeJson(storage, PROGRESS_QUEUE_KEY, events);
  writeRaw(storage, PROGRESS_CHECKSUM_KEY, queueChecksum(events, deps));
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
  writeRaw(storage, PROGRESS_CLIENT_KEY, id);
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
  const batchEvents: ProgressEventBody[] = events.map(
    ({ lessonId: _lessonId, clientId: _clientId, ...event }) => event,
  );
  return {
    clientId,
    events: batchEvents,
    checksum: progressBatchChecksum({ clientId, events: batchEvents }),
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

function quarantineEvents(
  events: PendingProgressEvent[],
  reason: string,
  deps: ProgressSyncDeps,
): void {
  quarantineRecord(
    { reason, at: (deps.now ?? (() => new Date().toISOString()))(), events },
    deps,
  );
}

/**
 * Flush queued events for one lesson. Successful, duplicate, stale and
 * server-rejected events are terminal and removed from the active queue;
 * rejected events are preserved in quarantine for review. Network/5xx failures
 * keep the queue intact and checksummed for the next reconnect.
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
  const integrity = consumeQueueIntegrity(deps);
  if (integrity.tampered) {
    return {
      status: 'rejected',
      processed: 0,
      pending: pendingForLesson(lessonId, deps),
      response: null,
      message: 'Saved progress failed its integrity check and was preserved for review.',
    };
  }

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
    const ids = new Set(chunk.map((event) => event.clientEventId));
    try {
      const response = await send(toBatchBody(chunk));
      lastResponse = response;
      processed += chunk.length;
      const rejected = response.results.find((result) => result.outcome === 'rejected');
      if (rejected) {
        quarantineEvents(chunk, `server_rejected:${rejected.reason ?? 'unknown'}`, deps);
      }
      const fresh = loadQueue(deps);
      saveQueue(
        fresh.filter((event) => !ids.has(event.clientEventId)),
        deps,
      );
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
        // e.g. lesson_locked / authentication: retrying forever cannot help,
        // but the exact events are preserved rather than silently deleted.
        quarantineEvents(chunk, 'terminal_client_error', deps);
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
