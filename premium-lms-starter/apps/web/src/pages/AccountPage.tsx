import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/permissions.js';
import { Badge, Button } from '../components/ui.js';

/**
 * Foundation account page: shows the authenticated session, roles and
 * permissions. Course/library content arrives with later phases — this page
 * deliberately shows only real, verified data.
 */
export function AccountPage() {
  const { user, logout } = useAuth();
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
        <h2>Foundation build</h2>
        <p className="muted">
          Course discovery, your library and the learning environment arrive in the next phases.
          Authentication, roles and the secure session you are using now are live.
        </p>
        {can(user, 'users.read') ? (
          <Link className="button secondary" to="/admin">
            Administration
          </Link>
        ) : null}
      </section>
    </div>
  );
}
