import { apiFetch } from '../auth/api.js';
import type {
  LessonDetailResponse,
  MediaGrant,
  PlayerStateResponse,
  ProgressBatchBody,
  ProgressBatchResponse,
  QuizAttemptResponse,
} from './types.js';

export const learningApi = {
  getPlayer(slug: string): Promise<PlayerStateResponse> {
    return apiFetch<PlayerStateResponse>(`/api/learning/courses/${encodeURIComponent(slug)}`);
  },
  getLesson(lessonId: string): Promise<LessonDetailResponse> {
    return apiFetch<LessonDetailResponse>(
      `/api/learning/lessons/${encodeURIComponent(lessonId)}`,
    );
  },
  sendProgress(lessonId: string, body: ProgressBatchBody): Promise<ProgressBatchResponse> {
    return apiFetch<ProgressBatchResponse>(
      `/api/learning/lessons/${encodeURIComponent(lessonId)}/progress/events`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
  submitQuiz(
    lessonId: string,
    body: { clientSubmissionId: string; answers: Record<string, string[]> },
  ): Promise<QuizAttemptResponse> {
    return apiFetch<QuizAttemptResponse>(
      `/api/learning/lessons/${encodeURIComponent(lessonId)}/quiz/attempts`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
  refreshMedia(
    lessonId: string,
    purpose: 'stream' | 'download',
  ): Promise<{ media: MediaGrant }> {
    return apiFetch<{ media: MediaGrant }>(
      `/api/learning/lessons/${encodeURIComponent(lessonId)}/media`,
      { method: 'POST', body: JSON.stringify({ purpose }) },
    );
  },
};
