import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/permissions.js';
import { Alert, Badge, Button, Spinner } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

interface LearningSummary {
  href: string;
  progressPercent: number;
  completedLessons: number;
  totalLessons: number;
  completionStatus: string;
  criteriaVersion: number | null;
  gradebookAverage: number | null;
  gradebookAttempts: number;
}

interface EnrollmentItem {
  enrollmentId: string;
  course: { id: string; slug: string; title: string; status: string; href: string };
  status: string;
  enrolledAt: string;
  completedAt: string | null;
  /** Present on Phase 3 API responses; tolerated as absent for older caches. */
  learning?: LearningSummary;
}

function learningOf(item: EnrollmentItem): LearningSummary {
  return (
    item.learning ?? {
      href: `/learn/${item.course.slug}`,
      progressPercent: 0,
      completedLessons: 0,
      totalLessons: 0,
      completionStatus: 'in_progress',
      criteriaVersion: null,
      gradebookAverage: null,
      gradebookAttempts: 0,
    }
  );
}

/** Account page: session info plus the learner's enrolled courses dashboard. */
export function AccountPage() {
  const { user, logout } = useAuth();
  const [enrollments, setEnrollments] = useState<EnrollmentItem[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await apiFetch<{ items: EnrollmentItem[] }>('/api/me/enrollments');
        if (!cancelled) setEnrollments(result.items);
      } catch (err) {
        if (!cancelled) {
          setLibraryError(err instanceof ApiError ? err.message : 'Could not load your courses.');
          setEnrollments([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  const activeCourses = (enrollments ?? []).filter(
    (item) => learningOf(item).completionStatus !== 'completed',
  ).length;
  const completedLessons = (enrollments ?? []).reduce(
    (total, item) => total + learningOf(item).completedLessons,
    0,
  );
  const totalLessons = (enrollments ?? []).reduce(
    (total, item) => total + learningOf(item).totalLessons,
    0,
  );
  const gradebookAverages = (enrollments ?? [])
    .map((item) => learningOf(item).gradebookAverage)
    .filter((value): value is number => value !== null);
  const overallAverage =
    gradebookAverages.length > 0
      ? Math.round(
          (gradebookAverages.reduce((total, value) => total + value, 0) /
            gradebookAverages.length) *
            100,
        ) / 100
      : null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>{user.name}</h1>
        </div>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </header>

      <section className="panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Continue learning</p>
            <h2>Your courses</h2>
          </div>
          <Link className="button secondary" to="/courses">
            Browse the catalogue
          </Link>
        </div>

        {(enrollments ?? []).length > 0 && !libraryError ? (
          <div className="dashboard-stats" aria-label="Learning summary">
            <div>
              <p className="eyebrow">Active courses</p>
              <p className="stat-value">{activeCourses}</p>
            </div>
            <div>
              <p className="eyebrow">Lessons completed</p>
              <p className="stat-value">
                {completedLessons}/{totalLessons}
              </p>
            </div>
            <div>
              <p className="eyebrow">Average best score</p>
              <p className="stat-value">
                {overallAverage === null ? '—' : `${overallAverage}%`}
              </p>
            </div>
          </div>
        ) : null}

        {enrollments === null ? (
          <Spinner label="Loading your courses…" />
        ) : libraryError ? (
          <Alert>{libraryError}</Alert>
        ) : enrollments.length === 0 ? (
          <div className="empty-state">
            <p className="muted">You are not enrolled in any courses yet.</p>
            <Link className="button secondary" to="/courses">
              Browse the catalogue
            </Link>
          </div>
        ) : (
          <ul className="enrollment-list">
            {enrollments.map((item) => {
              const learning = learningOf(item);
              return (
                <li key={item.enrollmentId} className="enrollment-row">
                  <div className="enrollment-main">
                    <div className="enrollment-title-row">
                      <Link to={item.course.href}>{item.course.title}</Link>
                      <Badge>
                        {learning.completionStatus === 'completed' ? 'Complete' : item.status}
                      </Badge>
                    </div>
                    <p className="muted">
                      Enrolled {formatDate(item.enrolledAt)} · {learning.completedLessons} of{' '}
                      {learning.totalLessons} lessons · Gradebook average{' '}
                      {learning.gradebookAverage === null
                        ? '—'
                        : `${learning.gradebookAverage}%`}
                      {item.course.status === 'withdrawn' ? ' · course withdrawn' : ''}
                    </p>
                    <div
                      className="progress-track small"
                      role="progressbar"
                      aria-label={`${item.course.title} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={learning.progressPercent}
                    >
                      <div
                        className="progress-fill"
                        style={{ width: `${learning.progressPercent}%` }}
                      />
                    </div>
                  </div>
                  <Link className="button secondary" to={learning.href}>
                    {learning.progressPercent > 0 ? 'Continue learning' : 'Open course'}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Profile</h2>
        <dl className="detail-grid">
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Account status</dt>
            <dd className="capitalize">{user.status}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd className="badge-row">
              {user.roles.length > 0 ? (
                user.roles.map((role) => <Badge key={role}>{role}</Badge>)
              ) : (
                <span className="muted">None</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <h2>Permissions</h2>
        {user.permissions.length > 0 ? (
          <ul className="permission-list">
            {user.permissions.map((permission) => (
              <li key={permission}>
                <code>{permission}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            This account currently holds no elevated permissions — everything beyond your own
            learning area requires a grant from an administrator.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>What's live</h2>
        <p className="muted">
          Catalogue browsing, purchase with the simulated payment provider, automatic enrolment,
          the sequential course player, explicit lesson completion, objective quiz grading and a
          server-side gradebook are live. Certificates are deliberately not issued in this phase.
        </p>
        <Link className="button secondary" to="/courses">
          Browse the catalogue
        </Link>
        {can(user, 'users.read') ? (
          <Link className="button secondary" to="/admin">
            Administration
          </Link>
        ) : null}
      </section>
    </div>
  );
}
