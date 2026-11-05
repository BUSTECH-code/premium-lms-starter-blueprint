/** Pure presentation helpers for the course player (no domain rules here). */

import type { LessonKind, PlayerLesson, PlayerStateResponse } from './types.js';

export interface ModuleGroup {
  id: string;
  title: string;
  position: number;
  lessons: PlayerLesson[];
}

export function groupLessonsByModule(lessons: readonly PlayerLesson[]): ModuleGroup[] {
  const groups: ModuleGroup[] = [];
  for (const lesson of lessons) {
    let group = groups.find((item) => item.id === lesson.moduleId);
    if (!group) {
      group = {
        id: lesson.moduleId,
        title: lesson.moduleTitle,
        position: lesson.modulePosition,
        lessons: [],
      };
      groups.push(group);
    }
    group.lessons.push(lesson);
  }
  return groups.sort((a, b) => a.position - b.position);
}

export function statusLabel(lesson: PlayerLesson): string {
  if (lesson.locked) return 'Locked';
  if (lesson.status === 'completed') return 'Completed';
  if (lesson.status === 'in_progress') return 'In progress';
  return 'Not started';
}

/** Text markers: completion state is never communicated by colour alone. */
export function statusSymbol(lesson: PlayerLesson): string {
  if (lesson.locked) return '—';
  if (lesson.status === 'completed') return '✓';
  if (lesson.status === 'in_progress') return '◐';
  return '○';
}

export function kindLabel(kind: LessonKind): string {
  switch (kind) {
    case 'video':
      return 'Video lesson';
    case 'text':
      return 'Reading';
    case 'quiz':
      return 'Quiz';
    case 'download':
      return 'Download';
  }
}

export function canOpen(lesson: PlayerLesson): boolean {
  return !lesson.locked;
}

export function findLesson(
  lessons: readonly PlayerLesson[],
  lessonId: string | null | undefined,
): PlayerLesson | null {
  if (!lessonId) return null;
  return lessons.find((lesson) => lesson.id === lessonId) ?? null;
}

export function lessonNumber(lessons: readonly PlayerLesson[], lessonId: string): number {
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  return index < 0 ? 0 : index + 1;
}

export function progressSummary(state: PlayerStateResponse): string {
  const total = state.lessons.length;
  const completed = state.lessons.filter((lesson) => lesson.status === 'completed').length;
  return `${completed} of ${total} lesson${total === 1 ? '' : 's'} complete`;
}

export function suggestedHref(state: PlayerStateResponse): string | null {
  const suggested = findLesson(state.lessons, state.suggestedLessonId);
  return suggested?.href ?? state.lessons[0]?.href ?? null;
}

/** mm:ss (or h:mm:ss) for a saved playback position. */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}
