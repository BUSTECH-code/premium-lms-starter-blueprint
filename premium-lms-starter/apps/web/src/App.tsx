import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider.js';
import { RequireAccess, RequireAuth } from './auth/guards.js';
import { can } from './auth/permissions.js';
import { Button, Spinner } from './components/ui.js';
import { AccountPage } from './pages/AccountPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';

function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="full-page-state">
      <div className="panel narrow">
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p className="muted">
          Nothing lives at <code>{location.pathname}</code>.
        </p>
        <Link className="button secondary" to="/">
          Back to your account
        </Link>
      </div>
    </div>
  );
}

function AppShell() {
  const { status, user, logout } = useAuth();

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          Premium<span>Academy</span>
        </Link>
        <nav aria-label="Main">
          {status === 'authenticated' ? (
            <>
              <NavLink to="/" end>
                Account
              </NavLink>
              {can(user, 'users.read') ? <NavLink to="/admin">Administration</NavLink> : null}
            </>
          ) : null}
        </nav>
        <div className="app-header-actions">
          {status === 'loading' ? (
            <Spinner />
          ) : status === 'authenticated' ? (
            <>
              <span className="muted header-user">{user?.email}</span>
              <Button variant="ghost" onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          ) : (
            <Link className="button secondary" to="/login">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <RequireAccess requirement={{ permissions: ['users.read'] }}>
                  <AdminPage />
                </RequireAccess>
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <footer className="app-footer">
        <span className="muted">Premium Academy — foundation build (Phase 1)</span>
      </footer>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
