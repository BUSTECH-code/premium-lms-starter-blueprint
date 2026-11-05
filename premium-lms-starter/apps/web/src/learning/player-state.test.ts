import { describe, expect, it } from 'vitest';
import {
  canOpen,
  findLesson,
  formatClock,
  groupLessonsByModule,
  kindLabel,
  lessonNumber,
  progressSummary,
  statusLabel,
  statusSymbol,
  suggestedHref,
} from './player-state.js';
import { LESSON_IDS, makePlayerState } from './test-fixtures.js';

describe('course player presentation helpers', () => {
  const state = makePlayerState({ completedIds: [LESSON_IDS.video] });

  it('groups lessons by module in curriculum order', () => {
    const groups = groupLessonsByModule(state.lessons);
    expect(groups.map((group) => [group.title, group.lessons.length])).toEqual([
      ['Module one', 2],
      ['Module two', 2],
    ]);
    expect(groups[0]?.lessons.map((lesson) => lesson.id)).toEqual([
      LESSON_IDS.video,
      LESSON_IDS.text,
    ]);
  });

  it('labels every completion state with text, not colour alone', () => {
    expect(statusLabel(state.lessons[0]!)).toBe('Completed');
    expect(statusSymbol(state.lessons[0]!)).toBe('✓');
    expect(statusLabel(state.lessons[1]!)).toBe('In progress');
    expect(statusSymbol(state.lessons[1]!)).toBe('◐');
    expect(statusLabel(state.lessons[2]!)).toBe('Locked');
    expect(statusSymbol(state.lessons[2]!)).toBe('—');
    expect(statusLabel(state.lessons[3]!)).toBe('Locked');
    expect(canOpen(state.lessons[0]!)).toBe(true);
    expect(canOpen(state.lessons[1]!)).toBe(true);
    expect(canOpen(state.lessons[2]!)).toBe(false);
  });

  it('maps lesson kinds and finds order/neighbours safely', () => {
    expect(kindLabel('video')).toBe('Video lesson');
    expect(kindLabel('text')).toBe('Reading');
    expect(kindLabel('quiz')).toBe('Quiz');
    expect(kindLabel('download')).toBe('Download');
    expect(findLesson(state.lessons, LESSON_IDS.quiz)?.title).toBe('Check your understanding');
    expect(findLesson(state.lessons, null)).toBeNull();
    expect(lessonNumber(state.lessons, LESSON_IDS.download)).toBe(4);
    expect(lessonNumber(state.lessons, 'missing')).toBe(0);
  });

  it('summarises progress and suggests the first unfinished lesson', () => {
    expect(progressSummary(state)).toBe('1 of 4 lessons complete');
    expect(suggestedHref(state)).toBe(`/learn/${state.course.slug}/${LESSON_IDS.text}`);
    const complete = makePlayerState({
      completedIds: Object.values(LESSON_IDS),
      suggestedLessonId: null,
    });
    expect(progressSummary(complete)).toBe('4 of 4 lessons complete');
    expect(complete.progressPercent).toBe(100);
    expect(complete.completion.status).toBe('completed');
  });

  it('formats saved playback positions as mm:ss / h:mm:ss', () => {
    expect(formatClock(null)).toBe('0:00');
    expect(formatClock(3)).toBe('0:03');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(-5)).toBe('0:00');
  });
});
