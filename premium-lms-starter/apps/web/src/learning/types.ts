/** Typed contract for the Phase 3 learning API (server is authoritative). */

export type LessonKind = 'video' | 'text' | 'quiz' | 'download';
export type LessonStatus = 'not_started' | 'in_progress' | 'completed';
export type CompletionState =
  | 'not_eligible'
  | 'in_progress'
  | 'completed'
  | 'certificate_issued';

export interface LessonProgressSnapshot {
  status: LessonStatus;
  progressPercent: number;
  playbackPositionSeconds: number | null;
  completedAt: string | null;
  completionSource: 'explicit' | 'quiz_pass' | null;
  revision: number;
  lastEventAt: string | null;
}

export interface CourseCompletionView {
  status: CompletionState;
  criteriaVersion: number;
  completedAt: string | null;
  progressPercent: number;
}

export interface GradebookEntry {
  quizId: string;
  lessonId: string;
  quizTitle: string;
  lessonTitle: string;
  bestScorePercent: number | null;
  latestScorePercent: number | null;
  attemptCount: number;
  passed: boolean;
}

export interface GradebookView {
  quizCount: number;
  gradedQuizCount: number;
  attemptCount: number;
  averageBestScorePercent: number | null;
  latestScorePercent: number | null;
  entries: GradebookEntry[];
}

export interface CourseCriteria {
  version: number;
  policy: 'all_required_lessons';
  lessonOrder: 'module_position_then_lesson_position';
  videoCompletion: 'explicit';
  quizPassingScorePercent: number;
}

export interface PlayerLesson {
  id: string;
  title: string;
  kind: LessonKind;
  moduleId: string;
  moduleTitle: string;
  modulePosition: number;
  lessonPosition: number;
  durationSeconds: string | null;
  status: LessonStatus;
  progressPercent: number;
  playbackPositionSeconds: number | null;
  completedAt: string | null;
  locked: boolean;
  requiresLessonTitle: string | null;
  href: string;
}

export interface PlayerStateResponse {
  course: {
    id: string;
    slug: string;
    title: string;
    status: string;
    summary: string | null;
    href: string;
  };
  criteriaVersion: number;
  criteria: CourseCriteria;
  progressPercent: number;
  completion: CourseCompletionView;
  gradebook: GradebookView;
  suggestedLessonId: string | null;
  lessons: PlayerLesson[];
}

export interface MediaGrant {
  url: string;
  expiresAt: string;
  purpose: 'stream' | 'download';
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

export interface PublicQuizChoice {
  id: string;
  text: string;
}

export interface PublicQuizQuestion {
  id: string;
  kind: 'single_choice' | 'multiple_choice' | 'true_false';
  prompt: string;
  points: number;
  choices: PublicQuizChoice[];
}

export interface QuizContent {
  id: string;
  title: string;
  instructions: string | null;
  questions: PublicQuizQuestion[];
  passingScorePercent: number;
  bestScorePercent: number | null;
  latestScorePercent: number | null;
  attemptCount: number;
  passed: boolean;
}

export type LessonContent =
  | { kind: 'video' | 'download'; media: MediaGrant }
  | { kind: 'text'; bodyText: string }
  | { kind: 'quiz'; quiz: QuizContent };

export interface LessonDetailLesson {
  id: string;
  title: string;
  kind: LessonKind;
  moduleId: string;
  moduleTitle: string;
  modulePosition: number;
  lessonPosition: number;
  durationSeconds: string | null;
  courseId: string;
  courseSlug: string;
  href: string;
}

export interface LessonDetailResponse {
  lesson: LessonDetailLesson;
  course: { id: string; slug: string; title: string; href: string };
  criteriaVersion: number;
  progress: LessonProgressSnapshot;
  completion: CourseCompletionView;
  gradebook: GradebookView;
  content: LessonContent;
  nextLessonId: string | null;
  previousLessonId: string | null;
  nextLessonHref: string | null;
  previousLessonHref: string | null;
}

export type ClientProgressEventType = 'start' | 'position' | 'complete';

export interface ProgressEventBody {
  clientEventId: string;
  sequence: number;
  type: ClientProgressEventType;
  occurredAt: string;
  progressPercent?: number;
  positionSeconds?: number;
}

export interface ProgressBatchBody {
  clientId: string;
  events: ProgressEventBody[];
}

export interface ProgressEventResult {
  clientEventId: string;
  outcome: 'applied' | 'duplicate' | 'stale' | 'ignored' | 'rejected';
  reason: string | null;
  state: LessonProgressSnapshot;
}

export interface ProgressBatchResponse {
  lessonId: string;
  results: ProgressEventResult[];
  progress: LessonProgressSnapshot | null;
  courseCompletion: CourseCompletionView | null;
}

export interface QuestionGrade {
  questionId: string;
  correct: boolean;
  earnedPoints: number;
  possiblePoints: number;
}

export interface QuizAttemptView {
  id: string;
  attemptNo: number;
  scorePercent: number;
  pointsEarned: number;
  pointsPossible: number;
  passingScorePercent: number;
  passed: boolean;
  submittedAt: string;
  answers: Record<string, string[]>;
  perQuestion: QuestionGrade[];
}

export interface QuizAttemptResponse {
  outcome: 'submitted' | 'duplicate';
  attempt: QuizAttemptView;
  lessonProgress: LessonProgressSnapshot;
  gradebook: GradebookView;
  courseCompletion: CourseCompletionView;
  courseSlug: string;
  nextLessonId: string | null;
  nextLessonHref: string | null;
}
