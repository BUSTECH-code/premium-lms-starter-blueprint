import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider.js';
import { RequireAccess, RequireAuth } from './auth/guards.js';
import { can } from './auth/permissions.js';
import { Button, Spinner } from './components/ui.js';
import { CoursePlayerPage } from './learning/CoursePlayerPage.js';
import { AccountPage } from './pages/AccountPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { CatalogPage } from './pages/CatalogPage.js';
import { CourseDetailPage } from './pages/CourseDetailPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { PaystackCheckoutPage } from './pages/PaystackCheckoutPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { SimulatedCheckoutPage } from './pages/SimulatedCheckoutPage.js';

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
          Back to Learning Center
        </Link>
      </div>
    </div>
  );
}

export function AppShell() {
  const { status, user, logout } = useAuth();

  return (
    <div className="app" data-responsive-layout="stacked-mobile split-tablet grid-desktop">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header" data-testid="app-header" role="banner" aria-label="Site header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="Premium Academy home">
            <span className="brand-mark" aria-hidden="true">
              PA
            </span>
            <span className="brand-name">
              Premium<span className="brand-accent">Academy</span>
            </span>
          </Link>
          <nav className="header-nav" aria-label="Primary navigation">
            <NavLink to="/courses">Course Catalog</NavLink>
            {status === 'authenticated' ? (
              <>
                <NavLink to="/" end>
                  Learning Center
                </NavLink>
                {can(user, 'users.read') ? <NavLink to="/admin">Administration</NavLink> : null}
              </>
            ) : null}
          </nav>
          <div className="header-actions">
            {status === 'loading' ? (
              <Spinner />
            ) : status === 'authenticated' ? (
              <>
                <span className="header-user-pill">{user?.email}</span>
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
        </div>
      </header>

      <main className="app-main" id="main-content" data-testid="app-main">
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            }
          />
          <Route path="/courses" element={<CatalogPage />} />
          <Route path="/courses/:slug" element={<CourseDetailPage />} />
          <Route
            path="/learn/:slug"
            element={
              <RequireAuth>
                <CoursePlayerPage />
              </RequireAuth>
            }
          />
          <Route
            path="/learn/:slug/:lessonId"
            element={
              <RequireAuth>
                <CoursePlayerPage />
              </RequireAuth>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/checkout/preview/:reference"
            element={
              <RequireAuth>
                <SimulatedCheckoutPage />
              </RequireAuth>
            }
          />
          <Route
            path="/checkout/paystack"
            element={
              <RequireAuth>
                <PaystackCheckoutPage />
              </RequireAuth>
            }
          />
          <Route
            path="/checkout/paystack/callback"
            element={
              <RequireAuth>
                <PaystackCheckoutPage />
              </RequireAuth>
            }
          />
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

      <footer className="app-footer" data-testid="app-footer" role="contentinfo">
        <div className="app-footer-inner">
          <span className="muted">
            Premium Academy — secure, accessible learning
          </span>
          <span className="muted">Built for accessible, responsive learning</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
