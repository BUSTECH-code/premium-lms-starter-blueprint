/** Deterministic API-shaped fixtures for Phase 3 web component/unit tests. */

import type {
  CompletionState,
  CourseCompletionView,
  GradebookView,
  LessonDetailLesson,
  LessonDetailResponse,
  LessonProgressSnapshot,
  LessonStatus,
  MediaGrant,
  PlayerLesson,
  PlayerStateResponse,
  ProgressBatchBody,
  ProgressBatchResponse,
  ProgressEventBody,
  QuizAttemptResponse,
} from './types.js';
import type { StorageLike } from './progress-sync.js';

export const SLUG = 'learning-course';
export const LESSON_IDS = {
  video: '11111111-1111-4111-8111-111111111111',
  text: '22222222-2222-4222-8222-222222222222',
  quiz: '33333333-3333-4333-8333-333333333333',
  download: '44444444-4444-4444-8444-444444444444',
} as const;

export const QUIZ_QUESTION_IDS = {
  terminal: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  download: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  actions: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
} as const;

export const CORRECT_QUIZ_ANSWERS: Record<string, string[]> = {
  [QUIZ_QUESTION_IDS.terminal]: ['c'],
  [QUIZ_QUESTION_IDS.download]: ['false'],
  [QUIZ_QUESTION_IDS.actions]: ['a', 'b'],
};

export const WRONG_QUIZ_ANSWERS: Record<string, string[]> = {
  [QUIZ_QUESTION_IDS.terminal]: ['a'],
  [QUIZ_QUESTION_IDS.download]: ['true'],
  [QUIZ_QUESTION_IDS.actions]: ['c', 'd'],
};

const MODULE_ONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const MODULE_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const FIXED_NOW = '2026-11-05T10:00:00.000Z';
const FUTURE = '2026-11-05T10:05:00.000Z';

export function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function baseLesson(
  id: string,
  kind: PlayerLesson['kind'],
  title: string,
  moduleId: string,
  moduleTitle: string,
  modulePosition: number,
  lessonPosition: number,
  durationSeconds: string,
): Omit<PlayerLesson, 'status' | 'progressPercent' | 'playbackPositionSeconds' | 'completedAt' | 'locked' | 'requiresLessonTitle' | 'href'> {
  return {
    id,
    title,
    kind,
    moduleId,
    moduleTitle,
    modulePosition,
    lessonPosition,
    durationSeconds,
  };
}

const LESSON_BASE = [
  baseLesson(LESSON_IDS.video, 'video', 'Watch the introduction', MODULE_ONE, 'Module one', 1, 1, '4'),
  baseLesson(LESSON_IDS.text, 'text', 'Read the notes', MODULE_ONE, 'Module one', 1, 2, '180'),
  baseLesson(LESSON_IDS.quiz, 'quiz', 'Check your understanding', MODULE_TWO, 'Module two', 2, 1, '300'),
  baseLesson(LESSON_IDS.download, 'download', 'Download the companion PDF', MODULE_TWO, 'Module two', 2, 2, '120'),
];

export function makeGradebook(
  average: number | null = null,
  attempts = 0,
  passed = false,
): GradebookView {
  return {
    quizCount: 1,
    gradedQuizCount: average === null ? 0 : 1,
    attemptCount: attempts,
    averageBestScorePercent: average,
    latestScorePercent: average,
    entries: [
      {
        quizId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        lessonId: LESSON_IDS.quiz,
        quizTitle: 'Checkpoint',
        lessonTitle: 'Check your understanding',
        bestScorePercent: average,
        latestScorePercent: average,
        attemptCount: attempts,
        passed,
      },
    ],
  };
}

export function makeCompletion(
  status: CompletionState = 'in_progress',
  progressPercent = 0,
): CourseCompletionView {
  return {
    status,
    criteriaVersion: 1,
    completedAt: status === 'completed' ? FIXED_NOW : null,
    progressPercent,
  };
}

export function makeProgress(
  status: LessonStatus = 'not_started',
  overrides: Partial<LessonProgressSnapshot> = {},
): LessonProgressSnapshot {
  return {
    status,
    progressPercent: status === 'completed' ? 100 : 0,
    playbackPositionSeconds: status === 'not_started' ? null : 3,
    completedAt: status === 'completed' ? FIXED_NOW : null,
    completionSource:
      status === 'completed' ? (overrides.completionSource ?? 'explicit') : null,
    revision: status === 'not_started' ? 0 : 1,
    lastEventAt: status === 'not_started' ? null : FIXED_NOW,
    ...overrides,
  };
}

export function makeMediaGrant(purpose: 'stream' | 'download' = 'stream'): MediaGrant {
  return {
    url: `/api/media/content?grant=${'a'.repeat(64)}${purpose === 'download' ? '&download=1' : ''}`,
    expiresAt: FUTURE,
    purpose,
    mimeType: purpose === 'stream' ? 'video/mp4' : 'application/pdf',
    fileName: purpose === 'stream' ? 'Lesson introduction.mp4' : 'Lesson notes.pdf',
    sizeBytes: purpose === 'stream' ? 74162 : 1064,
    durationSeconds: purpose === 'stream' ? 4 : null,
  };
}

export interface PlayerStateOptions {
  completedIds?: readonly string[];
  suggestedLessonId?: string | null;
  gradebookAverage?: number | null;
  gradebookAttempts?: number;
  quizPassed?: boolean;
  completionStatus?: CompletionState;
}

export function makePlayerState(options: PlayerStateOptions = {}): PlayerStateResponse {
  const completed = new Set(options.completedIds ?? []);
  const lessons: PlayerLesson[] = LESSON_BASE.map((lesson, index) => {
    const earlier = LESSON_BASE.slice(0, index);
    const firstIncomplete = earlier.find((item) => !completed.has(item.id));
    const locked = firstIncomplete !== undefined;
    const status: LessonStatus = completed.has(lesson.id)
      ? 'completed'
      : !locked
        ? 'in_progress'
        : 'not_started';
    return {
      ...lesson,
      status,
      progressPercent: status === 'completed' ? 100 : 0,
      playbackPositionSeconds: lesson.id === LESSON_IDS.video ? 3 : null,
      completedAt: status === 'completed' ? FIXED_NOW : null,
      locked,
      requiresLessonTitle: firstIncomplete?.title ?? null,
      href: `/learn/${SLUG}/${lesson.id}`,
    };
  });
  const progressPercent = Math.round((completed.size / lessons.length) * 100);
  const allComplete = completed.size === lessons.length;
  return {
    course: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
      slug: SLUG,
      title: 'Learning Course',
      status: 'published',
      summary: 'A short, sequential learning journey.',
      href: `/learn/${SLUG}`,
    },
    criteriaVersion: 1,
    criteria: {
      version: 1,
      policy: 'all_required_lessons',
      lessonOrder: 'module_position_then_lesson_position',
      videoCompletion: 'explicit',
      quizPassingScorePercent: 80,
    },
    progressPercent,
    completion: makeCompletion(
      options.completionStatus ?? (allComplete ? 'completed' : 'in_progress'),
      progressPercent,
    ),
    gradebook: makeGradebook(
      options.gradebookAverage ?? null,
      options.gradebookAttempts ?? 0,
      options.quizPassed ?? false,
    ),
    suggestedLessonId:
      options.suggestedLessonId === undefined
        ? lessons.find((lesson) => lesson.status !== 'completed')?.id ?? lessons[0]?.id ?? null
        : options.suggestedLessonId,
    lessons,
  };
}

function detailLesson(kind: LessonDetailLesson['kind']): LessonDetailLesson {
  const base = LESSON_BASE.find((lesson) => lesson.kind === kind);
  if (!base) throw new Error(`No fixture lesson for ${kind}`);
  return {
    ...base,
    courseId: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    courseSlug: SLUG,
    href: `/learn/${SLUG}/${base.id}`,
  };
}

interface DetailOptions {
  completed?: boolean;
  playbackPositionSeconds?: number | null;
  gradebookAverage?: number | null;
  gradebookAttempts?: number;
  quizPassed?: boolean;
}

function detailBase(options: DetailOptions = {}) {
  return {
    criteriaVersion: 1,
    progress: makeProgress(options.completed ? 'completed' : 'not_started', {
      playbackPositionSeconds:
        options.playbackPositionSeconds === undefined ? 3 : options.playbackPositionSeconds,
      completionSource: options.completed ? 'explicit' : null,
    }),
    completion: makeCompletion('in_progress', options.completed ? 25 : 0),
    gradebook: makeGradebook(
      options.gradebookAverage ?? null,
      options.gradebookAttempts ?? 0,
      options.quizPassed ?? false,
    ),
    course: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
      slug: SLUG,
      title: 'Learning Course',
      href: `/learn/${SLUG}`,
    },
  };
}

export function makeVideoDetail(options: DetailOptions = {}): LessonDetailResponse {
  return {
    lesson: detailLesson('video'),
    ...detailBase(options),
    content: { kind: 'video', media: makeMediaGrant('stream') },
    nextLessonId: LESSON_IDS.text,
    previousLessonId: null,
    nextLessonHref: `/learn/${SLUG}/${LESSON_IDS.text}`,
    previousLessonHref: null,
  };
}

export function makeTextDetail(options: DetailOptions = {}): LessonDetailResponse {
  return {
    lesson: detailLesson('text'),
    ...detailBase(options),
    content: {
      kind: 'text',
      bodyText: 'Read these notes carefully. Opening this lesson does not complete it.',
    },
    nextLessonId: LESSON_IDS.quiz,
    previousLessonId: LESSON_IDS.video,
    nextLessonHref: `/learn/${SLUG}/${LESSON_IDS.quiz}`,
    previousLessonHref: `/learn/${SLUG}/${LESSON_IDS.video}`,
  };
}

export function makeDownloadDetail(options: DetailOptions = {}): LessonDetailResponse {
  return {
    lesson: detailLesson('download'),
    ...detailBase(options),
    content: { kind: 'download', media: makeMediaGrant('download') },
    nextLessonId: null,
    previousLessonId: LESSON_IDS.quiz,
    nextLessonHref: null,
    previousLessonHref: `/learn/${SLUG}/${LESSON_IDS.quiz}`,
  };
}

export function makeQuizDetail(options: DetailOptions = {}): LessonDetailResponse {
  const base = detailBase({ ...options, completed: options.completed ?? false });
  return {
    lesson: detailLesson('quiz'),
    ...base,
    progress: makeProgress(options.completed ? 'completed' : 'not_started', {
      completionSource: options.completed ? 'quiz_pass' : null,
    }),
    content: {
      kind: 'quiz',
      quiz: {
        id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        title: 'Checkpoint',
        instructions: 'Answer every question. Answer keys are never shown.',
        passingScorePercent: 80,
        bestScorePercent: options.gradebookAverage ?? null,
        latestScorePercent: options.gradebookAverage ?? null,
        attemptCount: options.gradebookAttempts ?? 0,
        passed: options.quizPassed ?? false,
        questions: [
          {
            id: QUIZ_QUESTION_IDS.terminal,
            kind: 'single_choice',
            prompt: 'Which state is terminal for lesson progress?',
            points: 1,
            choices: [
              { id: 'a', text: 'Not started' },
              { id: 'b', text: 'In progress' },
              { id: 'c', text: 'Completed' },
            ],
          },
          {
            id: QUIZ_QUESTION_IDS.download,
            kind: 'true_false',
            prompt: 'A download completes a lesson by itself.',
            points: 1,
            choices: [
              { id: 'true', text: 'True' },
              { id: 'false', text: 'False' },
            ],
          },
          {
            id: QUIZ_QUESTION_IDS.actions,
            kind: 'multiple_choice',
            prompt: 'Select the approved completion actions.',
            points: 1,
            choices: [
              { id: 'a', text: 'Explicit mark complete' },
              { id: 'b', text: 'Passing a quiz' },
              { id: 'c', text: 'Page visit' },
              { id: 'd', text: 'Download' },
            ],
          },
        ],
      },
    },
    nextLessonId: LESSON_IDS.download,
    previousLessonId: LESSON_IDS.text,
    nextLessonHref: `/learn/${SLUG}/${LESSON_IDS.download}`,
    previousLessonHref: `/learn/${SLUG}/${LESSON_IDS.text}`,
  };
}

export function makeProgressBatchResponse(
  events: readonly ProgressEventBody[],
  options: { completed?: boolean; revision?: number } = {},
): ProgressBatchResponse {
  const progress = makeProgress(options.completed ? 'completed' : 'in_progress', {
    revision: options.revision ?? events.length,
  });
  return {
    lessonId: LESSON_IDS.video,
    results: events.map((item) => ({
      clientEventId: item.clientEventId,
      outcome: 'applied',
      reason: null,
      state: progress,
    })),
    progress,
    courseCompletion: makeCompletion('in_progress', options.completed ? 25 : 0),
  };
}

export function makeQuizAttemptResponse(
  options: { passed: boolean; scorePercent: number; attemptNo?: number } = {
    passed: true,
    scorePercent: 100,
  },
): QuizAttemptResponse {
  const gradebook = makeGradebook(options.scorePercent, options.attemptNo ?? 1, options.passed);
  return {
    outcome: 'submitted',
    attempt: {
      id: `attempt-${options.attemptNo ?? 1}`,
      attemptNo: options.attemptNo ?? 1,
      scorePercent: options.scorePercent,
      pointsEarned: options.passed ? 3 : 0,
      pointsPossible: 3,
      passingScorePercent: 80,
      passed: options.passed,
      submittedAt: FIXED_NOW,
      answers: options.passed ? CORRECT_QUIZ_ANSWERS : WRONG_QUIZ_ANSWERS,
      perQuestion: Object.keys(CORRECT_QUIZ_ANSWERS).map((questionId) => ({
        questionId,
        correct: options.passed,
        earnedPoints: options.passed ? 1 : 0,
        possiblePoints: 1,
      })),
    },
    lessonProgress: makeProgress(options.passed ? 'completed' : 'in_progress', {
      completionSource: options.passed ? 'quiz_pass' : null,
    }),
    gradebook,
    courseCompletion: makeCompletion('in_progress', options.passed ? 75 : 50),
    courseSlug: SLUG,
    nextLessonId: LESSON_IDS.download,
    nextLessonHref: `/learn/${SLUG}/${LESSON_IDS.download}`,
  };
}

export function batchFromInit(init?: RequestInit): ProgressBatchBody {
  return JSON.parse(String(init?.body ?? '{}')) as ProgressBatchBody;
}
