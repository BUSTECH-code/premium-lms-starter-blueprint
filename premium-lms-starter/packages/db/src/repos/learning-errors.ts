/** Stable, safe error codes shared by learning repositories and API routes. */

export type LearningErrorCode =
  | 'course_not_found'
  | 'not_entitled'
  | 'entitlement_revoked'
  | 'not_enrolled'
  | 'lesson_not_found'
  | 'lesson_locked'
  | 'content_not_configured'
  | 'unsupported_lesson_kind'
  | 'quiz_not_found'
  | 'invalid_quiz_submission'
  | 'submission_conflict'
  | 'invalid_transition'
  | 'media_grant_invalid'
  | 'media_grant_expired'
  | 'media_provider_unavailable';

export class LearningError extends Error {
  readonly code: LearningErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: LearningErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'LearningError';
    this.code = code;
    this.details = details;
  }
}
