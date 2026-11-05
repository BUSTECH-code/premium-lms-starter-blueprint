import { LearningError, type LearningErrorCode } from '@lms/db';
import { AppError, errors, isAppError } from '../lib/errors.js';

const STATUS: Record<LearningErrorCode, number> = {
  course_not_found: 404,
  lesson_not_found: 404,
  quiz_not_found: 404,
  content_not_configured: 404,
  not_entitled: 403,
  entitlement_revoked: 403,
  not_enrolled: 403,
  lesson_locked: 403,
  unsupported_lesson_kind: 400,
  invalid_quiz_submission: 400,
  submission_conflict: 409,
  invalid_transition: 409,
  media_grant_invalid: 403,
  media_grant_expired: 410,
  media_provider_unavailable: 503,
};

/** Map repository/domain errors onto the stable API error contract. */
export function toAppError(error: unknown): AppError {
  if (error instanceof LearningError) {
    return new AppError(STATUS[error.code], error.code, error.message, error.details);
  }
  if (isAppError(error)) return error;
  return errors.internal();
}
