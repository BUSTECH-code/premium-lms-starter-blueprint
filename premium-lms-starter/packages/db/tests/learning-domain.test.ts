import { describe, expect, it } from 'vitest';
import {
  canLessonProgressTransition,
  canonicalAnswers,
  classifyEventSequence,
  courseProgressPercent,
  emptyProgressSnapshot,
  firstIncompleteLessonId,
  gradeObjectiveQuiz,
  isSequentialLessonUnlocked,
  nextLessonId,
  previousLessonId,
  reduceLessonProgress,
  toPublicQuestions,
  type GradableQuestion,
  type OrderedLesson,
} from '../src/index.js';

const now = '2026-11-05T10:00:00.000Z';

const lessons: OrderedLesson[] = [
  {
    id: 'l1',
    title: 'Video',
    kind: 'video',
    moduleId: 'm1',
    moduleTitle: 'Module one',
    modulePosition: 1,
    lessonPosition: 1,
    durationSeconds: '4',
  },
  {
    id: 'l2',
    title: 'Reading',
    kind: 'text',
    moduleId: 'm1',
    moduleTitle: 'Module one',
    modulePosition: 1,
    lessonPosition: 2,
    durationSeconds: '180',
  },
  {
    id: 'l3',
    title: 'Quiz',
    kind: 'quiz',
    moduleId: 'm2',
    moduleTitle: 'Module two',
    modulePosition: 2,
    lessonPosition: 1,
    durationSeconds: '300',
  },
  {
    id: 'l4',
    title: 'Download',
    kind: 'download',
    moduleId: 'm2',
    moduleTitle: 'Module two',
    modulePosition: 2,
    lessonPosition: 2,
    durationSeconds: '120',
  },
];

function question(id: string, correctIds: string[], kind: GradableQuestion['kind'] = 'single_choice'): GradableQuestion {
  return {
    id,
    kind,
    prompt: `Question ${id}`,
    points: 1,
    choices: [
      { id: 'a', text: 'Alpha', isCorrect: correctIds.includes('a') },
      { id: 'b', text: 'Bravo', isCorrect: correctIds.includes('b') },
      { id: 'c', text: 'Charlie', isCorrect: correctIds.includes('c') },
    ],
  };
}

describe('lesson progress state machine', () => {
  it('allows only not_started → in_progress/completed and in_progress → completed', () => {
    expect(canLessonProgressTransition('not_started', 'in_progress')).toBe(true);
    expect(canLessonProgressTransition('not_started', 'completed')).toBe(true);
    expect(canLessonProgressTransition('in_progress', 'completed')).toBe(true);
    expect(canLessonProgressTransition('in_progress', 'in_progress')).toBe(false);
    expect(canLessonProgressTransition('completed', 'in_progress')).toBe(false);
    expect(canLessonProgressTransition('completed', 'completed')).toBe(false);
  });

  it('never completes a lesson from start, position or 100% playback', () => {
    const start = reduceLessonProgress(
      emptyProgressSnapshot(),
      { eventType: 'start', progressPercent: 0 },
      now,
    );
    expect(start.outcome).toBe('applied');
    expect(start.state.status).toBe('in_progress');

    const watched = reduceLessonProgress(
      start.state,
      { eventType: 'position', progressPercent: 100, positionSeconds: 42 },
      now,
    );
    expect(watched.outcome).toBe('applied');
    expect(watched.state.status).toBe('in_progress');
    expect(watched.state.progressPercent).toBe(100);
    expect(watched.state.playbackPositionSeconds).toBe(42);
    expect(watched.state.completedAt).toBeNull();
    expect(watched.state.completionSource).toBeNull();
  });

  it('completes only on explicit complete or server quiz_passed, and completed is terminal', () => {
    const explicit = reduceLessonProgress(
      emptyProgressSnapshot(),
      { eventType: 'complete', progressPercent: 100 },
      now,
    );
    expect(explicit.state.status).toBe('completed');
    expect(explicit.state.completionSource).toBe('explicit');
    expect(explicit.state.completedAt).toBe(now);

    const quizPass = reduceLessonProgress(
      emptyProgressSnapshot(),
      { eventType: 'quiz_passed' },
      now,
    );
    expect(quizPass.state.status).toBe('completed');
    expect(quizPass.state.completionSource).toBe('quiz_pass');

    const afterCompletion = reduceLessonProgress(
      explicit.state,
      { eventType: 'position', progressPercent: 10, positionSeconds: 1 },
      now,
    );
    expect(afterCompletion.outcome).toBe('ignored');
    expect(afterCompletion.reason).toBe('completed_is_terminal');
    expect(afterCompletion.state).toEqual(explicit.state);
  });

  it('keeps progress and playback monotonic, and classifies stale sequences', () => {
    const first = reduceLessonProgress(
      emptyProgressSnapshot(),
      { eventType: 'position', progressPercent: 55, positionSeconds: 10 },
      now,
    );
    const lower = reduceLessonProgress(
      first.state,
      { eventType: 'position', progressPercent: 12, positionSeconds: 4 },
      now,
    );
    expect(lower.state.progressPercent).toBe(55);
    expect(lower.state.playbackPositionSeconds).toBe(10);
    expect(classifyEventSequence(3, 4)).toBe('fresh');
    expect(classifyEventSequence(4, 4)).toBe('stale');
    expect(classifyEventSequence(5, 4)).toBe('stale');
  });
});

describe('sequential unlock rules', () => {
  it('locks a lesson until ALL earlier lessons are completed', () => {
    const statuses = { l1: 'completed', l2: 'completed', l3: 'not_started' } as const;
    expect(isSequentialLessonUnlocked(lessons, statuses, 'l1').locked).toBe(false);
    expect(isSequentialLessonUnlocked(lessons, statuses, 'l2').locked).toBe(false);
    expect(isSequentialLessonUnlocked(lessons, statuses, 'l3').locked).toBe(false);
    expect(isSequentialLessonUnlocked(lessons, statuses, 'l4')).toEqual({
      locked: true,
      requiresLessonId: 'l3',
      requiresLessonTitle: 'Quiz',
    });
    expect(isSequentialLessonUnlocked(lessons, { l1: 'in_progress' }, 'l2')).toEqual({
      locked: true,
      requiresLessonId: 'l1',
      requiresLessonTitle: 'Video',
    });
    expect(isSequentialLessonUnlocked(lessons, {}, 'unknown').locked).toBe(true);
  });

  it('computes progress, suggested lesson and neighbours across module order', () => {
    const statuses = { l1: 'completed', l2: 'completed' } as const;
    expect(courseProgressPercent(lessons, statuses)).toBe(50);
    expect(firstIncompleteLessonId(lessons, statuses)).toBe('l3');
    expect(firstIncompleteLessonId(lessons, {
      l1: 'completed',
      l2: 'completed',
      l3: 'completed',
      l4: 'completed',
    })).toBe('l1');
    expect(nextLessonId(lessons, 'l2')).toBe('l3');
    expect(nextLessonId(lessons, 'l4')).toBeNull();
    expect(previousLessonId(lessons, 'l3')).toBe('l2');
    expect(previousLessonId(lessons, 'l1')).toBeNull();
  });
});

describe('objective quiz grading', () => {
  const questions = [
    question('q1', ['a']),
    question('q2', ['b']),
    question('q3', ['c']),
    question('q4', ['a']),
    question('q5', ['b']),
  ];

  it('strips answer keys from all public question DTOs', () => {
    const publicQuestions = toPublicQuestions(questions);
    expect(publicQuestions).toHaveLength(5);
    expect(JSON.stringify(publicQuestions)).not.toContain('isCorrect');
    for (const item of publicQuestions) {
      for (const choice of item.choices) {
        expect(Object.keys(choice).sort()).toEqual(['id', 'text']);
      }
    }
  });

  it('canonicalises selections, dropping unknown ids/order/duplicates', () => {
    const canonical = canonicalAnswers(questions, {
      q1: ['b', 'a', 'a', 'unknown'],
      q2: ['b'],
      unknown: ['a'],
    });
    expect(canonical).toEqual({ q1: ['a', 'b'], q2: ['b'] });
  });

  it('grades objective kinds and enforces the 80% pass threshold', () => {
    const allCorrect = {
      q1: ['a'],
      q2: ['b'],
      q3: ['c'],
      q4: ['a'],
      q5: ['b'],
    };
    const fourOfFive = { ...allCorrect, q5: ['a'] };
    const threeOfFive = { ...fourOfFive, q4: ['c'] };
    const perfect = gradeObjectiveQuiz(questions, allCorrect, 80);
    const threshold = gradeObjectiveQuiz(questions, fourOfFive, 80);
    const below = gradeObjectiveQuiz(questions, threeOfFive, 80);

    expect(perfect.scorePercent).toBe(100);
    expect(perfect.passed).toBe(true);
    expect(threshold.scorePercent).toBe(80);
    expect(threshold.passed).toBe(true);
    expect(below.scorePercent).toBe(60);
    expect(below.passed).toBe(false);
    expect(perfect.perQuestion.every((result) => result.correct)).toBe(true);
    expect(perfect.perQuestion[0]).toEqual({
      questionId: 'q1',
      correct: true,
      earnedPoints: 1,
      possiblePoints: 1,
    });
  });

  it('requires the exact correct set for multiple-choice questions', () => {
    const multiple = question('qm', ['a', 'b'], 'multiple_choice');
    const exact = gradeObjectiveQuiz([multiple], { qm: ['b', 'a'] }, 80);
    const partial = gradeObjectiveQuiz([multiple], { qm: ['a'] }, 80);
    expect(exact.scorePercent).toBe(100);
    expect(exact.passed).toBe(true);
    expect(partial.scorePercent).toBe(0);
    expect(partial.passed).toBe(false);
  });

  it('rejects empty quizzes and invalid passing scores', () => {
    expect(() => gradeObjectiveQuiz([], {}, 80)).toThrow(/no questions/);
    expect(() => gradeObjectiveQuiz(questions, {}, 0)).toThrow(/Invalid passing score/);
    expect(() => gradeObjectiveQuiz(questions, {}, 101)).toThrow(/Invalid passing score/);
    expect(() => gradeObjectiveQuiz(questions, {}, 80.5)).toThrow(/Invalid passing score/);
  });
});
