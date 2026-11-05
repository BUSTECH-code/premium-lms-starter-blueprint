/**
 * Pure lesson-progress state machine — Phase 3 (approved Q2 sequential_explicit).
 *
 * States from docs/architecture/state-machines.md:
 *   not_started → in_progress → completed (completed is terminal)
 *
 * Approved transition rules:
 * - `start` / `position` move not_started → in_progress and update monotonic
 *   progress/playback values. They NEVER complete a lesson, even at 100%.
 * - `complete` (explicit learner action) and `quiz_passed` (server-generated)
 *   move not_started/in_progress → completed. A download or page visit is not
 *   a completion event.
 * - completed → anything is rejected (`ignored`); progress never regresses.
 * - A stale client (sequence <= last accepted sequence for that client) is
 *   ignored before the reducer runs; duplicate client event ids short-circuit
 *   even earlier in the repository.
 *
 * No database or framework dependencies: this module is unit-testable in
 * isolation and is the single source of truth for transition decisions.
 */

export type LessonProgressStatus = 'not_started' | 'in_progress' | 'completed';
export type ClientProgressEventType = 'start' | 'position' | 'complete';
export type ProgressEventType = ClientProgressEventType | 'quiz_passed';
export type CompletionSource = 'explicit' | 'quiz_pass';
export type ProgressOutcome = 'applied' | 'duplicate' | 'stale' | 'ignored' | 'rejected';

export const LESSON_PROGRESS_TRANSITIONS: Readonly<
  Record<LessonProgressStatus, readonly LessonProgressStatus[]>
> = {
  not_started: ['in_progress', 'completed'],
  in_progress: ['completed'],
  completed: [],
};

export function canLessonProgressTransition(
  from: LessonProgressStatus,
  to: LessonProgressStatus,
): boolean {
  return LESSON_PROGRESS_TRANSITIONS[from].includes(to);
}

export interface LessonProgressSnapshot {
  status: LessonProgressStatus;
  progressPercent: number;
  playbackPositionSeconds: number | null;
  completedAt: string | null;
  completionSource: CompletionSource | null;
  revision: number;
  lastEventAt: string | null;
}

export interface ProgressReducerEvent {
  eventType: ProgressEventType;
  /** Client-reported, server-clamped 0..100. Never triggers completion. */
  progressPercent?: number;
  /** Client-reported playback position. Monotonic, never negative. */
  positionSeconds?: number;
}

export interface ProgressReduction {
  outcome: 'applied' | 'ignored';
  reason?: string;
  state: LessonProgressSnapshot;
}

export function emptyProgressSnapshot(): LessonProgressSnapshot {
  return {
    status: 'not_started',
    progressPercent: 0,
    playbackPositionSeconds: null,
    completedAt: null,
    completionSource: null,
    revision: 0,
    lastEventAt: null,
  };
}

function clampPercent(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.min(100, Math.max(0, Math.round((value ?? 0) * 100) / 100));
}

function monotonicPosition(
  current: number | null,
  incoming: number | undefined,
): number | null {
  if (!Number.isFinite(incoming ?? NaN)) return current;
  const next = Math.max(0, Math.round((incoming ?? 0) * 100) / 100);
  return current === null ? next : Math.max(current, next);
}

/**
 * Apply one accepted event to a snapshot. `serverNowIso` is the trusted server
 * timestamp: client wall clocks are never used to decide state or ordering.
 */
export function reduceLessonProgress(
  current: LessonProgressSnapshot,
  event: ProgressReducerEvent,
  serverNowIso: string,
): ProgressReduction {
  const isCompletionEvent =
    event.eventType === 'complete' || event.eventType === 'quiz_passed';

  if (current.status === 'completed') {
    return {
      outcome: 'ignored',
      reason: 'completed_is_terminal',
      state: current,
    };
  }

  if (isCompletionEvent) {
    const target: LessonProgressStatus = 'completed';
    if (!canLessonProgressTransition(current.status, target)) {
      return { outcome: 'ignored', reason: 'invalid_transition', state: current };
    }
    return {
      outcome: 'applied',
      state: {
        status: target,
        progressPercent: 100,
        playbackPositionSeconds: monotonicPosition(
          current.playbackPositionSeconds,
          event.positionSeconds,
        ),
        completedAt: serverNowIso,
        completionSource: event.eventType === 'quiz_passed' ? 'quiz_pass' : 'explicit',
        revision: current.revision + 1,
        lastEventAt: serverNowIso,
      },
    };
  }

  // `start` and `position` are progress events, never completion events.
  const target: LessonProgressStatus =
    current.status === 'not_started' ? 'in_progress' : current.status;
  if (current.status === 'not_started' && !canLessonProgressTransition(current.status, target)) {
    return { outcome: 'ignored', reason: 'invalid_transition', state: current };
  }

  const progressPercent = Math.max(
    current.progressPercent,
    clampPercent(event.progressPercent),
  );
  return {
    outcome: 'applied',
    state: {
      status: target,
      progressPercent: Math.round(progressPercent * 100) / 100,
      playbackPositionSeconds: monotonicPosition(
        current.playbackPositionSeconds,
        event.positionSeconds,
      ),
      completedAt: null,
      completionSource: null,
      revision: current.revision + 1,
      lastEventAt: serverNowIso,
    },
  };
}

/** Server-side conflict rule for offline reconnections and rapid clicks. */
export function classifyEventSequence(
  lastAcceptedSequence: number,
  incomingSequence: number,
): 'fresh' | 'stale' {
  return incomingSequence > lastAcceptedSequence ? 'fresh' : 'stale';
}
