import { useCallback, useEffect, useRef, useState } from 'react';
import { learningApi } from './api.js';
import {
  drainProgressEvents,
  enqueueProgressEvent,
  loadQueue,
  type DrainResult,
  type EnqueueProgressInput,
  type ProgressSyncDeps,
} from './progress-sync.js';
import type { ProgressBatchResponse } from './types.js';

export type SyncStatus = 'idle' | 'syncing' | 'saved' | 'offline' | 'error';

export interface UseProgressSyncOptions {
  deps?: ProgressSyncDeps;
  onSynced?: (response: ProgressBatchResponse) => void;
}

/** React binding for the offline progress queue + reconnect handling. */
export function useProgressSync(lessonId: string | null, options: UseProgressSyncOptions = {}) {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingCompletion, setPendingCompletion] = useState(false);

  const depsRef = useRef(options.deps);
  depsRef.current = options.deps;
  const onSyncedRef = useRef(options.onSynced);
  onSyncedRef.current = options.onSynced;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pendingInfo = useCallback((id: string) => {
    const events = loadQueue(depsRef.current ?? {}).filter((event) => event.lessonId === id);
    return {
      count: events.length,
      hasComplete: events.some((event) => event.type === 'complete'),
    };
  }, []);

  const flush = useCallback(
    async (target: string | null = lessonId): Promise<DrainResult | null> => {
      if (!target) return null;
      setStatus('syncing');
      setMessage(null);
      const result = await drainProgressEvents(
        target,
        (body) => learningApi.sendProgress(target, body),
        depsRef.current ?? {},
      );
      if (!mountedRef.current) return result;
      const info = pendingInfo(target);
      setPendingCount(info.count);
      setPendingCompletion(info.hasComplete);

      if (result.status === 'offline') {
        setStatus('offline');
        setMessage(`Offline — ${result.pending} change(s) saved on this device.`);
      } else if (result.status === 'error' || result.status === 'rejected') {
        setStatus('error');
        setMessage(result.message ?? 'Progress could not be saved.');
      } else {
        setStatus('saved');
        setMessage(
          result.processed > 0
            ? `Saved ${result.processed} progress change${result.processed === 1 ? '' : 's'}.`
            : 'All changes saved.',
        );
        if (result.response) onSyncedRef.current?.(result.response);
      }
      return result;
    },
    [lessonId, pendingInfo],
  );

  const enqueue = useCallback(
    (input: Omit<EnqueueProgressInput, 'lessonId'>) => {
      if (!lessonId) return;
      enqueueProgressEvent({ ...input, lessonId }, depsRef.current ?? {});
      const info = pendingInfo(lessonId);
      setPendingCount(info.count);
      setPendingCompletion(info.hasComplete);
      const online = depsRef.current?.isOnline?.() ?? navigator.onLine;
      if (online) {
        void flush(lessonId);
      } else {
        setStatus('offline');
        setMessage('Offline — progress is saved on this device.');
      }
    },
    [lessonId, flush, pendingInfo],
  );

  useEffect(() => {
    const handleOnline = () => {
      void flush();
    };
    const handleOffline = () => {
      setStatus('offline');
      setMessage('Offline — progress is saved on this device.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (lessonId) {
      const info = pendingInfo(lessonId);
      setPendingCount(info.count);
      setPendingCompletion(info.hasComplete);
      void flush(lessonId);
    }
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [lessonId, flush, pendingInfo]);

  return { enqueue, flush, status, message, pendingCount, pendingCompletion };
}
