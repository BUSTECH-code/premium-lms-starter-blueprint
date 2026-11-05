import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/permissions.js';
import { Alert, Badge, Button, Spinner } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

interface EnrollmentItem {
  enrollmentId: string;
  course: { id: string; slug: string; title: string; status: string; href: string };
  status: string;
  enrolledAt: string;
  completedAt: string | null;
}

/** Account page: session info plus the learner's enrolled courses library. */
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
        <h2>Your courses</h2>
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
            {enrollments.map((item) => (
              <li key={item.enrollmentId} className="enrollment-row">
                <div>
                  <Link to={item.course.href}>{item.course.title}</Link>
                  <p className="muted">
                    Enrolled {formatDate(item.enrolledAt)}
                    {item.course.status === 'withdrawn' ? ' · course withdrawn' : ''}
                  </p>
                </div>
                <Badge>{item.status}</Badge>
              </li>
            ))}
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
          Catalogue browsing, purchase with the simulated payment provider, automatic enrolment
          and this library are live. The learning environment arrives with the next phase.
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
