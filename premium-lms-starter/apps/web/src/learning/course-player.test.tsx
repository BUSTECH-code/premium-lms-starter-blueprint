// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { httpError, stubFetch, type FetchRoutes } from '../test-utils/mock-fetch.js';
import type { ProgressSyncDeps } from './progress-sync.js';
import type { ProgressBatchBody } from './types.js';
import { CoursePlayerPage } from './CoursePlayerPage.js';
import {
  CORRECT_QUIZ_ANSWERS,
  LESSON_IDS,
  SLUG,
  VIEWER_WATERMARK,
  batchFromInit,
  makeDownloadDetail,
  makePlayerState,
  makeProgressBatchResponse,
  makeQuizAttemptResponse,
  makeQuizDetail,
  makeVideoDetail,
  memoryStorage,
} from './test-fixtures.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function renderPlayer(path: string, routes: FetchRoutes, syncDeps?: ProgressSyncDeps) {
  stubFetch(routes);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn/:slug" element={<CoursePlayerPage syncDeps={syncDeps} />} />
        <Route
          path="/learn/:slug/:lessonId"
          element={<CoursePlayerPage syncDeps={syncDeps} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function progressHandler(
  batches: ProgressBatchBody[],
  onComplete?: () => void,
): (url: string, init?: RequestInit) => unknown {
  return (_url, init) => {
    const body = batchFromInit(init);
    batches.push(body);
    const hasComplete = body.events.some((event) => event.type === 'complete');
    if (hasComplete) onComplete?.();
    return makeProgressBatchResponse(body.events, { completed: hasComplete });
  };
}

describe('CoursePlayerPage', () => {
  it('renders sequential curriculum, explicit completion controls and no automatic completion on visit', async () => {
    let completed = false;
    const batches: ProgressBatchBody[] = [];
    const video = LESSON_IDS.video;
    const initialDetail = makeVideoDetail();
    const videoMedia = initialDetail.content.kind === 'video' ? initialDetail.content.media : null;
    renderPlayer(`/learn/${SLUG}/${video}`, {
      [`/api/learning/lessons/${video}/progress/events`]: progressHandler(batches, () => {
        completed = true;
      }),
      [`/api/learning/lessons/${video}/media`]: { media: videoMedia },
      [`/api/learning/lessons/${video}`]: () => makeVideoDetail({ completed }),
      [`/api/learning/courses/${SLUG}`]: () =>
        makePlayerState({ completedIds: completed ? [video] : [] }),
    });

    expect(await screen.findByRole('heading', { name: 'Watch the introduction' })).toBeTruthy();
    expect(screen.getByTestId('player-shell').getAttribute('data-responsive-layout')).toBe(
      'stacked-mobile split-tablet grid-desktop',
    );
    expect(screen.getByTestId('player-header')).toBeTruthy();
    expect(screen.getByTestId('player-layout')).toBeTruthy();
    expect(screen.getByTestId('player-sidebar')).toBeTruthy();
    expect(screen.getByTestId('lesson-stage')).toBeTruthy();
    expect(screen.getByTestId('curriculum-panel')).toBeTruthy();
    expect(screen.getByTestId('gradebook-panel')).toBeTruthy();
    expect(screen.getByTestId('sync-status')).toBeTruthy();
    const watermark = screen.getByTestId('session-watermark');
    expect(watermark.textContent).toContain(VIEWER_WATERMARK.email);
    expect(watermark.textContent).toContain(VIEWER_WATERMARK.sessionRef);
    expect(watermark.querySelector('time')?.getAttribute('datetime')).toBe(
      VIEWER_WATERMARK.issuedAt,
    );
    expect(screen.getByTestId('video-frame').querySelector('video')?.getAttribute('controlslist')).toContain(
      'nodownload',
    );
    expect(screen.getAllByText('Locked').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Complete “Watch the introduction” first/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeTruthy();
    expect(screen.getByText(/Reaching the end does not complete the lesson/)).toBeTruthy();

    await waitFor(() => expect(batches.length).toBeGreaterThan(0));
    expect(batches[0]?.events.map((event) => event.type)).toEqual(['start']);
    expect(batches[0]?.events.some((event) => event.type === 'complete')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));

    expect(await screen.findByText(/✓ Completed/)).toBeTruthy();
    await waitFor(() => expect(batches.length).toBeGreaterThanOrEqual(2));
    expect(batches[1]?.events.map((event) => event.type)).toEqual(['complete']);
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Next lesson' }).length).toBeGreaterThan(0);
    expect(completed).toBe(true);
  });

  it('shows a download without completing it and keeps explicit completion available', async () => {
    const batches: ProgressBatchBody[] = [];
    const download = LESSON_IDS.download;
    renderPlayer(`/learn/${SLUG}/${download}`, {
      [`/api/learning/lessons/${download}/progress/events`]: progressHandler(batches),
      [`/api/learning/lessons/${download}`]: () => makeDownloadDetail(),
      [`/api/learning/courses/${SLUG}`]: () =>
        makePlayerState({ completedIds: [LESSON_IDS.video, LESSON_IDS.text, LESSON_IDS.quiz] }),
    });

    const link = await screen.findByRole('link', { name: 'Open secured download' });
    expect(link.getAttribute('href')).toContain('/api/media/content?grant=');
    expect(screen.getByText(/Downloading this file does not complete the lesson/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeTruthy();
    await waitFor(() => expect(batches.length).toBeGreaterThan(0));
    expect(batches.every((batch) => batch.events.every((event) => event.type !== 'complete'))).toBe(true);
  });

  it('renders a quiz with no answer keys, supports failed and passing retakes, and unlocks the next lesson', async () => {
    let passed = false;
    let attempts = 0;
    const startBatches: ProgressBatchBody[] = [];
    const quiz = LESSON_IDS.quiz;
    const completedIds = () =>
      passed
        ? [LESSON_IDS.video, LESSON_IDS.text, LESSON_IDS.quiz]
        : [LESSON_IDS.video, LESSON_IDS.text];

    const quizHandler = (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        answers: Record<string, string[]>;
      };
      attempts += 1;
      const correct = Object.entries(CORRECT_QUIZ_ANSWERS).every(([questionId, expected]) => {
        const actual = [...(body.answers[questionId] ?? [])].sort();
        return JSON.stringify(actual) === JSON.stringify([...expected].sort());
      });
      passed = correct;
      return makeQuizAttemptResponse({
        passed: correct,
        scorePercent: correct ? 100 : 0,
        attemptNo: attempts,
      });
    };

    renderPlayer(`/learn/${SLUG}/${quiz}`, {
      [`/api/learning/lessons/${quiz}/progress/events`]: progressHandler(startBatches),
      [`/api/learning/lessons/${quiz}/quiz/attempts`]: quizHandler,
      [`/api/learning/lessons/${quiz}`]: () =>
        makeQuizDetail({
          completed: passed,
          gradebookAverage: passed ? 100 : null,
          gradebookAttempts: attempts,
          quizPassed: passed,
        }),
      [`/api/learning/courses/${SLUG}`]: () =>
        makePlayerState({
          completedIds: completedIds(),
          gradebookAverage: passed ? 100 : null,
          gradebookAttempts: attempts,
          quizPassed: passed,
        }),
    });

    expect(await screen.findByRole('heading', { name: 'Checkpoint' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    expect(document.body.innerHTML).not.toContain('isCorrect');
    expect(screen.getByText(/Passing score 80%/)).toBeTruthy();

    // First attempt: all wrong → 0%, no completion.
    fireEvent.click(screen.getByLabelText('Not started'));
    fireEvent.click(screen.getByLabelText('True'));
    fireEvent.click(screen.getByLabelText('Page visit'));
    fireEvent.click(screen.getByLabelText('Download'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));

    expect(await screen.findByText(/Not passed · 0%/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Next lesson' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();

    // Unlimited retake: all correct → 100%, quiz-pass completion.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByLabelText('Completed'));
    fireEvent.click(screen.getByLabelText('False'));
    fireEvent.click(screen.getByLabelText('Explicit mark complete'));
    fireEvent.click(screen.getByLabelText('Passing a quiz'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));

    expect(await screen.findByText(/Passed · 100%/)).toBeTruthy();
    expect(await screen.findAllByRole('link', { name: 'Next lesson' })).not.toHaveLength(0);
    expect(screen.getAllByText(/Average of best scores/).length).toBeGreaterThan(0);
    expect(document.body.innerHTML).not.toContain('isCorrect');
    expect(startBatches.every((batch) => batch.events.every((event) => event.type !== 'complete'))).toBe(true);
  });

  it('queues offline progress and flushes exact-once events after reconnection', async () => {
    let online = false;
    let completed = false;
    let idCounter = 0;
    const batches: ProgressBatchBody[] = [];
    const video = LESSON_IDS.video;
    const syncDeps: ProgressSyncDeps = {
      storage: memoryStorage(),
      isOnline: () => online,
      now: () => '2026-11-05T10:00:00.000Z',
      makeId: () => `offline-${++idCounter}`,
    };

    renderPlayer(
      `/learn/${SLUG}/${video}`,
      {
        [`/api/learning/lessons/${video}/progress/events`]: progressHandler(batches, () => {
          completed = true;
        }),
        [`/api/learning/lessons/${video}`]: () => makeVideoDetail({ completed }),
        [`/api/learning/courses/${SLUG}`]: () =>
          makePlayerState({ completedIds: completed ? [video] : [] }),
      },
      syncDeps,
    );

    expect(await screen.findByRole('button', { name: 'Mark complete' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Offline/)).toBeTruthy());
    expect(batches).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    expect(await screen.findByText(/2 queued/)).toBeTruthy();
    expect(batches).toHaveLength(0);

    online = true;
    window.dispatchEvent(new Event('online'));

    expect(await screen.findByText(/✓ Completed/)).toBeTruthy();
    await waitFor(() => expect(batches).toHaveLength(1));
    expect(batches[0]?.events.map((event) => event.type)).toEqual(['start', 'complete']);
    expect(batches[0]?.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(new Set(batches[0]?.events.map((event) => event.clientEventId)).size).toBe(2);
    expect(batches[0]?.clientId).toMatch(/^web-/);
  });

  it('shows a locked-lesson state with a link back to the next available lesson', async () => {
    renderPlayer(`/learn/${SLUG}/${LESSON_IDS.download}`, {
      [`/api/learning/lessons/${LESSON_IDS.download}`]: httpError(
        403,
        'lesson_locked',
        'Complete “Watch the introduction” before opening this lesson.',
      ),
      [`/api/learning/courses/${SLUG}`]: () => makePlayerState({ completedIds: [] }),
    });

    expect(await screen.findByRole('heading', { name: 'This lesson is locked' })).toBeTruthy();
    expect(screen.getByTestId('player-error-state').getAttribute('data-state')).toBe('error');
    expect(screen.getByText(/Complete “Watch the introduction”/)).toBeTruthy();
    const next = await screen.findByRole('link', { name: 'Go to your next lesson' });
    expect(next.getAttribute('href')).toBe(`/learn/${SLUG}/${LESSON_IDS.video}`);
  });
});
