import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/permissions.js';
import { PageIntro, StatePanel, Stat } from '../components/editorial.js';
import { Badge, Button, Spinner } from '../components/ui.js';
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

/** Account dashboard: real enrolment, progress and gradebook data. */
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
  const gradebookAttempts = (enrollments ?? []).reduce(
    (total, item) => total + learningOf(item).gradebookAttempts,
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
    <div
      className="page account-page"
      data-testid="account-page"
      data-responsive-layout="stacked-mobile split-tablet grid-desktop"
    >
      <PageIntro
        eyebrow="Learning Center"
        title={user.name}
        lede="Your courses, progress and gradebook in one place."
        className="dashboard-hero"
        testId="dashboard-hero"
        actions={
          <Button variant="secondary" onClick={() => void logout()}>
            Sign out
          </Button>
        }
      />

      {(enrollments ?? []).length > 0 && !libraryError ? (
        <section
          className="panel dashboard-stats"
          aria-label="Learning summary"
          data-testid="dashboard-stats"
        >
          <Stat label="Active courses" value={activeCourses} testId="stat-active-courses" />
          <Stat
            label="Lessons completed"
            value={`${completedLessons}/${totalLessons}`}
            testId="stat-lessons-completed"
          />
          <Stat
            label="Average best score"
            value={overallAverage === null ? '—' : `${overallAverage}%`}
            testId="stat-average-score"
          />
          <Stat
            label="Graded attempts"
            value={gradebookAttempts}
            testId="stat-graded-attempts"
          />
        </section>
      ) : null}

      <section className="panel library-panel" aria-labelledby="library-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">Continue learning</p>
            <h2 id="library-title">Course Library</h2>
          </div>
          <Link className="button secondary" to="/courses">
            Browse the Course Catalog
          </Link>
        </div>

        {enrollments === null ? (
          <StatePanel
            kind="loading"
            title="Loading your courses"
            description="Fetching enrollments, progress and gradebook summaries."
            testId="library-loading-state"
          >
            <Spinner label="Loading your courses…" />
          </StatePanel>
        ) : libraryError ? (
          <StatePanel
            kind="error"
            title="Learning Center unavailable"
            description={libraryError}
            testId="library-error-state"
          />
        ) : enrollments.length === 0 ? (
          <StatePanel
            kind="empty"
            title="No courses yet"
            description="You are not enrolled in any courses yet."
            testId="library-empty-state"
          >
            <Link className="button secondary" to="/courses">
              Browse the Course Catalog
            </Link>
          </StatePanel>
        ) : (
          <ul className="enrollment-list">
            {enrollments.map((item, index) => {
              const learning = learningOf(item);
              const actionLabel = learning.progressPercent > 0 ? 'Continue learning' : 'Open course';
              return (
                <li
                  key={item.enrollmentId}
                  className={`enrollment-row${index === 0 ? ' featured' : ''}`}
                  data-testid="enrollment-row"
                >
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
                    {index === 0 ? (
                      <div className="continue-learning-card" data-testid="continue-learning-card">
                        <span className="muted">Pick up where you left off.</span>
                        <Link className="button secondary" to={learning.href}>
                          {actionLabel}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  {index === 0 ? null : (
                    <Link className="button secondary" to={learning.href}>
                      {actionLabel}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel profile-panel" aria-labelledby="profile-title">
        <h2 id="profile-title">Profile</h2>
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

      <section className="panel permissions-panel" aria-labelledby="permissions-title">
        <h2 id="permissions-title">Permissions</h2>
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

      <section className="panel whats-live-panel" aria-labelledby="included-title">
        <h2 id="included-title">Included capabilities</h2>
        <p className="muted">
          Course Catalog browsing, secure checkout, automatic enrollment, guided lessons,
          explicit lesson completion, objective quiz grading and a reliable gradebook are included.
          Protected resources, session watermarks and a consistent visual system are included too.
          Certificates are deliberately not issued.
        </p>
        <div className="page-actions">
          <Link className="button secondary" to="/courses">
            Browse the Course Catalog
          </Link>
          {can(user, 'users.read') ? (
            <Link className="button secondary" to="/admin">
              Administration
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
