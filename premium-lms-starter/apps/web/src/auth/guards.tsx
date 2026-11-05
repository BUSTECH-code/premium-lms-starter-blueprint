import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider.js';
import { routeAllows, type RouteRequirement, type SessionUser } from './permissions.js';
import { Spinner } from '../components/ui.js';

function FullPageLoading() {
  return (
    <div className="full-page-state" role="status" aria-live="polite">
      <Spinner label="Checking your session…" />
    </div>
  );
}

/** Requires a signed-in session; redirects anonymous visitors to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * Requires the signed-in user to satisfy the given role/permission
 * requirement (deny by default). Unauthorised users see a 403 page instead
 * of a redirect, so the URL remains shareable.
 */
export function RequireAccess({
  requirement,
  children,
}: {
  requirement: RouteRequirement;
  children: ReactNode;
}) {
  const { status, user } = useAuth();

  if (status === 'loading') return <FullPageLoading />;
  if (status === 'anonymous' || !routeAllows(user, requirement)) {
    // RequireAuth upstream handles the anonymous redirect; this component is
    // only reached by authenticated users who lack access.
    return <Forbidden />;
  }
  return <>{children}</>;
}

export function Forbidden() {
  return (
    <div className="full-page-state">
      <div className="panel narrow">
        <p className="eyebrow">403</p>
        <h1>You don’t have access to this page</h1>
        <p className="muted">
          Your account does not hold the role or permission required here. If you believe this is a
          mistake, contact an administrator.
        </p>
        <Link className="button secondary" to="/">
          Back to your account
        </Link>
      </div>
    </div>
  );
}

/** Convenience: does the current user satisfy an access requirement? */
export function useAccess(requirement: RouteRequirement): boolean {
  const { user, status } = useAuth();
  if (status !== 'authenticated') return false;
  return routeAllows(user as SessionUser, requirement);
}
