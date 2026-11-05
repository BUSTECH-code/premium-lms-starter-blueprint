import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, SyntheticEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../auth/api.js';
import { Alert, Badge, Button, Spinner } from '../components/ui.js';
import { formatDuration } from '../lib/format.js';
import { learningApi } from './api.js';
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
import { newId, type ProgressSyncDeps } from './progress-sync.js';
import type {
  LessonDetailResponse,
  LessonStatus,
  PlayerLesson,
  PlayerStateResponse,
  ProgressBatchResponse,
  PublicQuizQuestion,
  QuizAttemptResponse,
} from './types.js';
import { useProgressSync } from './useProgressSync.js';

interface CoursePlayerPageProps {
  /** Injectable for offline/reconnect component tests. */
  syncDeps?: ProgressSyncDeps;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function progressStatusText(status: LessonStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'in_progress') return 'In progress';
  return 'Not started';
}

function Curriculum({
  player,
  currentLessonId,
}: {
  player: PlayerStateResponse;
  currentLessonId: string | null;
}) {
  const groups = groupLessonsByModule(player.lessons);
  return (
    <nav className="player-curriculum" aria-label="Curriculum">
      <div className="curriculum-head">
        <h2>Curriculum</h2>
        <span className="muted">{progressSummary(player)}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label="Course progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={player.progressPercent}
      >
        <div className="progress-fill" style={{ width: `${player.progressPercent}%` }} />
      </div>
      {groups.map((group) => (
        <section className="curriculum-group" key={group.id}>
          <h3>
            Module {group.position}: {group.title}
          </h3>
          <ol>
            {group.lessons.map((lesson) => {
              const open = canOpen(lesson);
              const marker = statusSymbol(lesson);
              const label = statusLabel(lesson);
              const inner = (
                <>
                  <span className="lesson-marker" aria-hidden="true">
                    {marker}
                  </span>
                  <span className="lesson-copy">
                    <span className="lesson-title">{lesson.title}</span>
                    <span className="lesson-meta muted">
                      {kindLabel(lesson.kind)} · {formatDuration(lesson.durationSeconds)}
                    </span>
                  </span>
                  <span className="lesson-state muted">{label}</span>
                </>
              );
              return (
                <li key={lesson.id}>
                  {open ? (
                    <Link
                      className={`lesson-row${lesson.id === currentLessonId ? ' current' : ''}`}
                      to={lesson.href}
                      aria-current={lesson.id === currentLessonId ? 'page' : undefined}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <span className="lesson-row locked" aria-disabled="true">
                      {inner}
                      {lesson.requiresLessonTitle ? (
                        <span className="lesson-lock-hint muted">
                          Complete “{lesson.requiresLessonTitle}” first
                        </span>
                      ) : null}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </nav>
  );
}

function Gradebook({ player }: { player: PlayerStateResponse }) {
  const book = player.gradebook;
  return (
    <section className="gradebook-panel" aria-label="Gradebook">
      <h2>Gradebook</h2>
      {book.quizCount === 0 ? (
        <p className="muted">This course has no graded quizzes.</p>
      ) : (
        <>
          <p className="muted">
            {book.gradedQuizCount} of {book.quizCount} quiz
            {book.quizCount === 1 ? '' : 'zes'} attempted · {book.attemptCount} attempt
            {book.attemptCount === 1 ? '' : 's'}
          </p>
          <p className="gradebook-average">
            Average of best scores:{' '}
            <strong>
              {book.averageBestScorePercent === null
                ? '—'
                : `${book.averageBestScorePercent}%`}
            </strong>
          </p>
          <ul className="gradebook-list">
            {book.entries.map((entry) => (
              <li key={entry.quizId}>
                <span>{entry.quizTitle}</span>
                <span className="muted">
                  {entry.bestScorePercent === null
                    ? 'Not attempted'
                    : `Best ${entry.bestScorePercent}%`}
                  {entry.passed ? ' · Passed' : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {player.completion.status === 'completed' ? (
        <p className="small-print muted">
          Course complete. Certificate issuance is not part of this phase.
        </p>
      ) : null}
    </section>
  );
}

function QuizQuestionField({
  question,
  index,
  answers,
  onSingle,
  onToggle,
}: {
  question: PublicQuizQuestion;
  index: number;
  answers: Record<string, string[]>;
  onSingle: (questionId: string, choiceId: string) => void;
  onToggle: (questionId: string, choiceId: string) => void;
}) {
  const selected = answers[question.id] ?? [];
  const multiple = question.kind === 'multiple_choice';
  return (
    <fieldset className="quiz-question">
      <legend>
        <span className="eyebrow">Question {index + 1}</span>
        <span>{question.prompt}</span>
      </legend>
      {multiple ? <p className="muted small-print">Select all that apply.</p> : null}
      <div className="quiz-options">
        {question.choices.map((choice) => (
          <label className="quiz-choice" key={choice.id}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={question.id}
              value={choice.id}
              checked={selected.includes(choice.id)}
              onChange={() =>
                multiple ? onToggle(question.id, choice.id) : onSingle(question.id, choice.id)
              }
            />
            <span>{choice.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function CoursePlayerPage({ syncDeps }: CoursePlayerPageProps = {}) {
  const { slug = '', lessonId } = useParams();
  const navigate = useNavigate();

  const [player, setPlayer] = useState<PlayerStateResponse | null>(null);
  const [detail, setDetail] = useState<LessonDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string[]>>({});
  const [quizResult, setQuizResult] = useState<QuizAttemptResponse | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [refreshingMedia, setRefreshingMedia] = useState(false);
  const [savedPosition, setSavedPosition] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastPositionRef = useRef(0);
  const startedLessonsRef = useRef<Set<string>>(new Set());

  const refreshPlayer = useCallback(async () => {
    const state = await learningApi.getPlayer(slug);
    setPlayer(state);
    return state;
  }, [slug]);

  const handleSynced = useCallback(
    (response: ProgressBatchResponse) => {
      void refreshPlayer().catch(() => undefined);
      const progress = response.progress;
      if (progress) {
        setDetail((previous) =>
          previous
            ? {
                ...previous,
                progress,
                completion: response.courseCompletion ?? previous.completion,
              }
            : previous,
        );
        setSavedPosition(progress.playbackPositionSeconds);
      }
    },
    [refreshPlayer],
  );

  const sync = useProgressSync(lessonId ?? null, {
    deps: syncDeps,
    onSynced: handleSynced,
  });

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      setPageError(null);
      setErrorCode(null);
      setQuizResult(null);
      setQuizAnswers({});
      setQuizError(null);
      setMediaError(null);
      setCompleting(false);
      try {
        const state = await learningApi.getPlayer(slug);
        if (cancelled) return;
        setPlayer(state);
        if (state.lessons.length === 0) {
          setDetail(null);
          return;
        }
        const target =
          lessonId ?? state.suggestedLessonId ?? state.lessons[0]?.id ?? null;
        if (!lessonId && target) {
          navigate(`/learn/${slug}/${target}`, { replace: true });
          return;
        }
        if (!target) {
          setDetail(null);
          return;
        }
        const nextDetail = await learningApi.getLesson(target);
        if (cancelled) return;
        setDetail(nextDetail);
        setSavedPosition(nextDetail.progress.playbackPositionSeconds);
        lastPositionRef.current = 0;
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError) {
          setPageError(error.message);
          setErrorCode(error.code);
        } else {
          setPageError('Could not load this course. Please try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [slug, lessonId, navigate]);

  // Opening a lesson is engagement, never completion (approved Q2).
  useEffect(() => {
    if (!detail || detail.progress.status !== 'not_started') return;
    if (startedLessonsRef.current.has(detail.lesson.id)) return;
    startedLessonsRef.current.add(detail.lesson.id);
    sync.enqueue({ type: 'start', progressPercent: 0 });
  }, [detail, sync.enqueue]);

  useEffect(() => {
    if (completing && sync.status !== 'syncing') setCompleting(false);
  }, [completing, sync.status]);

  const markComplete = useCallback(() => {
    if (!detail || detail.content.kind === 'quiz' || detail.progress.status === 'completed') {
      return;
    }
    setCompleting(true);
    // Explicit completion only. A download, page visit or 100% watched event
    // never sends this event.
    sync.enqueue({ type: 'complete', progressPercent: 100 });
  }, [detail, sync.enqueue]);

  const recordPosition = useCallback(
    (currentSeconds: number, durationSeconds: number, force = false) => {
      if (!detail || detail.progress.status === 'completed') return;
      if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return;
      if (!force && Math.abs(currentSeconds - lastPositionRef.current) < 5) return;
      lastPositionRef.current = currentSeconds;
      const percent =
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.min(100, Math.round((currentSeconds / durationSeconds) * 10000) / 100)
          : 0;
      sync.enqueue({
        type: 'position',
        positionSeconds: currentSeconds,
        progressPercent: percent,
      });
    },
    [detail, sync.enqueue],
  );

  const handleVideoEvent = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>, force = false) => {
      const video = event.currentTarget;
      recordPosition(video.currentTime, video.duration, force);
    },
    [recordPosition],
  );

  const refreshMedia = useCallback(async () => {
    if (!detail) return;
    if (detail.content.kind !== 'video' && detail.content.kind !== 'download') return;
    const kind = detail.content.kind;
    setRefreshingMedia(true);
    setMediaError(null);
    try {
      const purpose = kind === 'video' ? 'stream' : 'download';
      const { media } = await learningApi.refreshMedia(detail.lesson.id, purpose);
      setDetail((previous) =>
        previous ? { ...previous, content: { kind, media } } : previous,
      );
    } catch (error) {
      setMediaError(
        error instanceof ApiError ? error.message : 'Could not refresh the secure media link.',
      );
    } finally {
      setRefreshingMedia(false);
    }
  }, [detail]);

  const setSingleAnswer = useCallback((questionId: string, choiceId: string) => {
    setQuizAnswers((previous) => ({ ...previous, [questionId]: [choiceId] }));
  }, []);

  const toggleAnswer = useCallback((questionId: string, choiceId: string) => {
    setQuizAnswers((previous) => {
      const current = previous[questionId] ?? [];
      const next = current.includes(choiceId)
        ? current.filter((value) => value !== choiceId)
        : [...current, choiceId];
      return { ...previous, [questionId]: next };
    });
  }, []);

  const submitQuiz = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!detail || detail.content.kind !== 'quiz') return;
      const quiz = detail.content.quiz;
      const unanswered = quiz.questions.filter(
        (question) => (quizAnswers[question.id]?.length ?? 0) === 0,
      );
      if (unanswered.length > 0) {
        setQuizError('Answer every question before submitting.');
        return;
      }
      const online = syncDeps?.isOnline?.() ?? navigator.onLine;
      if (!online) {
        setQuizError('You are offline. Reconnect to submit the quiz.');
        return;
      }
      setSubmittingQuiz(true);
      setQuizError(null);
      const submittedLessonId = detail.lesson.id;
      try {
        const result = await learningApi.submitQuiz(submittedLessonId, {
          clientSubmissionId: newId(),
          answers: quizAnswers,
        });
        setQuizResult(result);
        setQuizAnswers({});
        await refreshPlayer();
        // A quiz lesson has no media grant, so refreshing its detail here does
        // not interrupt video playback.
        const nextDetail = await learningApi.getLesson(submittedLessonId);
        setDetail(nextDetail);
      } catch (error) {
        setQuizError(
          error instanceof ApiError ? error.message : 'Could not submit the quiz. Please try again.',
        );
      } finally {
        setSubmittingQuiz(false);
      }
    },
    [detail, quizAnswers, syncDeps, refreshPlayer],
  );

  const resumePlayback = useCallback(() => {
    if (savedPosition === null || !videoRef.current) return;
    videoRef.current.currentTime = savedPosition;
    lastPositionRef.current = savedPosition;
  }, [savedPosition]);

  if (loading) {
    return (
      <div className="page player-page">
        <Spinner label="Opening your course…" />
      </div>
    );
  }

  if (pageError || !player) {
    const locked = errorCode === 'lesson_locked';
    const notEntitled = errorCode === 'not_entitled' || errorCode === 'entitlement_revoked';
    return (
      <div className="full-page-state">
        <div className="panel narrow">
          <p className="eyebrow">{locked ? 'Lesson locked' : notEntitled ? '403' : 'Unavailable'}</p>
          <h1>
            {locked
              ? 'This lesson is locked'
              : notEntitled
                ? 'You don’t have access'
                : errorCode === 'course_not_found' || errorCode === 'lesson_not_found'
                  ? 'Not found'
                  : 'Could not open the course'}
          </h1>
          <p className="muted">{pageError ?? 'This course could not be loaded.'}</p>
          <div className="button-row">
            {player ? (
              <Link
                className="button primary"
                to={suggestedHref(player) ?? '/'}
              >
                Go to your next lesson
              </Link>
            ) : null}
            <Link className="button secondary" to="/">
              Your courses
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (player.lessons.length === 0 || !detail) {
    return (
      <div className="page player-page">
        <div className="empty-state">
          <h1>{player.course.title}</h1>
          <p className="muted">This course has no lessons yet.</p>
          <Link className="button secondary" to="/">
            Back to your courses
          </Link>
        </div>
      </div>
    );
  }

  const currentLesson = findLesson(player.lessons, detail.lesson.id);
  const nextLesson: PlayerLesson | null = findLesson(player.lessons, detail.nextLessonId);
  const nextUnlocked = nextLesson ? canOpen(nextLesson) : false;
  const completed = detail.progress.status === 'completed';
  const quiz = detail.content.kind === 'quiz' ? detail.content.quiz : null;
  const isQuiz = quiz !== null;

  return (
    <div className="page player-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Your courses</Link>
        <span aria-hidden="true"> / </span>
        <Link to={`/courses/${player.course.slug}`}>{player.course.title}</Link>
        <span aria-hidden="true"> / </span>
        <span>Learning</span>
      </nav>

      <header className="player-header">
        <div>
          <p className="eyebrow">Course player</p>
          <h1>{player.course.title}</h1>
          {player.course.summary ? <p className="lede">{player.course.summary}</p> : null}
        </div>
        <div className="player-header-meta">
          <Badge>
            {player.completion.status === 'completed' ? 'Course complete' : 'In progress'}
          </Badge>
          <span className="muted">{progressSummary(player)}</span>
          <span className="muted small-print">
            Completion rules v{player.criteriaVersion} · {player.criteria.quizPassingScorePercent}% quiz pass
          </span>
        </div>
      </header>

      <div className="player-layout">
        <main className="player-main" aria-label="Lesson">
          <header className="lesson-header">
            <p className="eyebrow">
              Lesson {lessonNumber(player.lessons, detail.lesson.id)} of {player.lessons.length} ·
              Module {detail.lesson.modulePosition}: {detail.lesson.moduleTitle}
            </p>
            <h2>{detail.lesson.title}</h2>
            <p className="muted">
              {kindLabel(detail.lesson.kind)} · {formatDuration(detail.lesson.durationSeconds)} ·{' '}
              {progressStatusText(detail.progress.status)}
              {currentLesson?.locked ? ' · Locked' : ''}
            </p>
          </header>

          {mediaError ? <Alert>{mediaError}</Alert> : null}

          {detail.content.kind === 'video' ? (
            <section className="lesson-stage" aria-label="Video lesson">
              <video
                key={detail.content.media.url}
                ref={videoRef}
                className="player-video"
                controls
                preload="metadata"
                playsInline
                src={detail.content.media.url}
                onTimeUpdate={(event) => handleVideoEvent(event)}
                onPause={(event) => handleVideoEvent(event, true)}
                onEnded={(event) => handleVideoEvent(event, true)}
                onError={() =>
                  setMediaError('This video could not be played. Refresh the secure link and try again.')
                }
              >
                Your browser does not support HTML video.
              </video>
              <div className="media-bar">
                <span className="muted">
                  {detail.content.media.fileName} · {formatBytes(detail.content.media.sizeBytes)}
                </span>
                {savedPosition !== null && savedPosition > 0 ? (
                  <Button variant="secondary" onClick={resumePlayback}>
                    Resume from {formatClock(savedPosition)}
                  </Button>
                ) : null}
                <Button variant="ghost" loading={refreshingMedia} onClick={() => void refreshMedia()}>
                  Refresh secure link
                </Button>
              </div>
              <p className="small-print muted">
                Reaching the end does not complete the lesson. Use “Mark complete” when you are ready.
              </p>
            </section>
          ) : null}

          {detail.content.kind === 'text' ? (
            <article className="lesson-prose" aria-label="Lesson notes">
              {detail.content.bodyText}
            </article>
          ) : null}

          {detail.content.kind === 'download' ? (
            <section className="download-card" aria-label="Lesson resource">
              <p className="eyebrow">Secured resource</p>
              <h3>{detail.content.media.fileName}</h3>
              <p className="muted">
                {detail.content.media.mimeType} · {formatBytes(detail.content.media.sizeBytes)}
              </p>
              <a className="button secondary" href={detail.content.media.url} download>
                Open secured download
              </a>
              <Button variant="ghost" loading={refreshingMedia} onClick={() => void refreshMedia()}>
                Refresh secure link
              </Button>
              <p className="small-print muted">
                Downloading this file does not complete the lesson. Use “Mark complete” when ready.
              </p>
            </section>
          ) : null}

          {detail.content.kind === 'quiz' && quiz ? (
            <section className="quiz-stage" aria-label="Quiz">
              <div className="quiz-head">
                <div>
                  <p className="eyebrow">Assessment</p>
                  <h3>{quiz.title}</h3>
                  {quiz.instructions ? <p className="muted">{quiz.instructions}</p> : null}
                </div>
                <div className="quiz-facts muted">
                  <span>Pass mark {quiz.passingScorePercent}%</span>
                  <span>
                    Best {quiz.bestScorePercent === null ? '—' : `${quiz.bestScorePercent}%`} ·{' '}
                    {quiz.attemptCount} attempt{quiz.attemptCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              {quizResult ? (
                <div
                  className={`quiz-result ${quizResult.attempt.passed ? 'passed' : 'failed'}`}
                  role="status"
                >
                  <h3>
                    {quizResult.attempt.passed ? 'Passed' : 'Not passed'} ·{' '}
                    {quizResult.attempt.scorePercent}%
                  </h3>
                  <p className="muted">
                    {quizResult.attempt.pointsEarned} of {quizResult.attempt.pointsPossible} points ·
                    attempt {quizResult.attempt.attemptNo}
                    {quizResult.outcome === 'duplicate' ? ' · duplicate submission ignored' : ''}
                  </p>
                  <ul className="quiz-review">
                    {quizResult.attempt.perQuestion.map((result, index) => (
                      <li key={result.questionId}>
                        Question {index + 1}: {result.correct ? 'Correct' : 'Incorrect'} ·{' '}
                        {result.earnedPoints}/{result.possiblePoints}
                      </li>
                    ))}
                  </ul>
                  <p className="small-print muted">
                    Course gradebook average of best scores:{' '}
                    {quizResult.gradebook.averageBestScorePercent === null
                      ? '—'
                      : `${quizResult.gradebook.averageBestScorePercent}%`}
                    . Answer keys are never shown.
                  </p>
                  <div className="button-row">
                    {quizResult.attempt.passed && nextUnlocked ? (
                      <Link className="button primary" to={nextLesson?.href ?? '#'}>
                        Next lesson
                      </Link>
                    ) : null}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuizResult(null);
                        setQuizAnswers({});
                      }}
                    >
                      Try again
                    </Button>
                  </div>
                </div>
              ) : null}

              {quizError ? <Alert>{quizError}</Alert> : null}
              <form className="quiz-form" onSubmit={(event) => void submitQuiz(event)}>
                {quiz.questions.map((question, index) => (
                  <QuizQuestionField
                    key={question.id}
                    question={question}
                    index={index}
                    answers={quizAnswers}
                    onSingle={setSingleAnswer}
                    onToggle={toggleAnswer}
                  />
                ))}
                <Button type="submit" loading={submittingQuiz} disabled={submittingQuiz}>
                  Submit answers
                </Button>
              </form>
            </section>
          ) : null}

          <div className="lesson-actions">
            {detail.previousLessonHref ? (
              <Link className="button secondary" to={detail.previousLessonHref}>
                Previous lesson
              </Link>
            ) : null}
            {!isQuiz && !completed ? (
              <Button
                loading={completing || sync.status === 'syncing'}
                disabled={
                  completing ||
                  sync.status === 'syncing' ||
                  (sync.status === 'offline' && sync.pendingCompletion)
                }
                onClick={markComplete}
              >
                Mark complete
              </Button>
            ) : null}
            {completed ? (
              <span className="completed-note" role="status">
                ✓ {isQuiz ? 'Passed and completed' : 'Completed'} ·{' '}
                {detail.progress.completionSource === 'quiz_pass' ? 'quiz pass' : 'explicit action'}
              </span>
            ) : null}
            {nextUnlocked ? (
              <Link className="button secondary" to={nextLesson?.href ?? '#'}>
                Next lesson
              </Link>
            ) : nextLesson ? (
              <span className="muted small-print">
                Next lesson unlocks after this one is completed.
              </span>
            ) : null}
          </div>

          <p className="sync-status" role="status" aria-live="polite">
            {sync.status === 'syncing'
              ? 'Saving progress…'
              : (sync.message ?? 'Progress is saved automatically.')}
            {sync.pendingCount > 0 ? ` (${sync.pendingCount} queued)` : ''}
          </p>
        </main>

        <aside className="player-sidebar" aria-label="Course progress and curriculum">
          <details className="curriculum-panel" open>
            <summary>
              <span>Curriculum</span>
              <span className="muted">{progressSummary(player)}</span>
            </summary>
            <Curriculum player={player} currentLessonId={detail.lesson.id} />
          </details>
          <Gradebook player={player} />
        </aside>
      </div>
    </div>
  );
}
