/**
 * Pure sequential-unlock logic — Phase 3 (approved Q2 sequential_explicit).
 * Every lesson is required; a lesson is unlocked only when ALL lessons before
 * it (ordered by module position, then lesson position) are `completed`.
 */

import type { LessonProgressStatus } from './lesson-progress.js';

export type LessonKind = 'video' | 'text' | 'quiz' | 'download';

export interface OrderedLesson {
  id: string;
  title: string;
  kind: LessonKind;
  moduleId: string;
  moduleTitle: string;
  modulePosition: number;
  lessonPosition: number;
  durationSeconds: string | null;
}

export type LessonStatusMap = Record<string, LessonProgressStatus | undefined>;

export interface UnlockResult {
  locked: boolean;
  requiresLessonId?: string;
  requiresLessonTitle?: string;
}

export function statusOf(statuses: LessonStatusMap, lessonId: string): LessonProgressStatus {
  return statuses[lessonId] ?? 'not_started';
}

export function isSequentialLessonUnlocked(
  lessons: readonly OrderedLesson[],
  statuses: LessonStatusMap,
  targetLessonId: string,
): UnlockResult {
  const index = lessons.findIndex((lesson) => lesson.id === targetLessonId);
  if (index < 0) {
    return { locked: true, requiresLessonId: undefined, requiresLessonTitle: undefined };
  }
  for (let i = 0; i < index; i += 1) {
    const previous = lessons[i];
    if (!previous) continue;
    if (statusOf(statuses, previous.id) !== 'completed') {
      return {
        locked: true,
        requiresLessonId: previous.id,
        requiresLessonTitle: previous.title,
      };
    }
  }
  return { locked: false };
}

export function courseProgressPercent(
  lessons: readonly OrderedLesson[],
  statuses: LessonStatusMap,
): number {
  if (lessons.length === 0) return 0;
  const completed = lessons.filter((lesson) => statusOf(statuses, lesson.id) === 'completed').length;
  return Math.round((completed / lessons.length) * 100);
}

/** First unfinished lesson (used for "Continue learning"); falls back to first. */
export function firstIncompleteLessonId(
  lessons: readonly OrderedLesson[],
  statuses: LessonStatusMap,
): string | null {
  const unfinished = lessons.find((lesson) => statusOf(statuses, lesson.id) !== 'completed');
  return unfinished?.id ?? lessons[0]?.id ?? null;
}

/** Next lesson in curriculum order, or null at the end. */
export function nextLessonId(
  lessons: readonly OrderedLesson[],
  currentLessonId: string,
): string | null {
  const index = lessons.findIndex((lesson) => lesson.id === currentLessonId);
  if (index < 0) return null;
  return lessons[index + 1]?.id ?? null;
}

export function previousLessonId(
  lessons: readonly OrderedLesson[],
  currentLessonId: string,
): string | null {
  const index = lessons.findIndex((lesson) => lesson.id === currentLessonId);
  if (index <= 0) return null;
  return lessons[index - 1]?.id ?? null;
}
