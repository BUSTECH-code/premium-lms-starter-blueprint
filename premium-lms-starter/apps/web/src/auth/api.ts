/**
 * API client.
 * - Always sends cookies (`credentials: 'include'`) — tokens live in httpOnly
 *   cookies and are never readable from JavaScript.
 * - On 401 (except for auth endpoints themselves) attempts ONE silent refresh
 *   with single-flight concurrency control, then retries the request.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

const NO_REFRESH_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];

export async function apiFetch<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok) {
    return body as T;
  }

  const payload = body as
    | { error?: { code?: string; message?: string; details?: unknown } }
    | null;
  const error = new ApiError(
    response.status,
    payload?.error?.code ?? 'unknown_error',
    payload?.error?.message ?? 'Something went wrong. Please try again.',
    payload?.error?.details,
  );

  if (
    response.status === 401 &&
    allowRefresh &&
    !NO_REFRESH_PATHS.some((prefix) => path.startsWith(prefix))
  ) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return apiFetch<T>(path, init, false);
    }
  }

  throw error;
}

export interface AuthUserResponse {
  user: import('./permissions.js').SessionUser & { createdAt: string };
}

export const authApi = {
  async me(): Promise<AuthUserResponse['user']> {
    const data = await apiFetch<AuthUserResponse>('/api/auth/me');
    return data.user;
  },
  async login(email: string, password: string): Promise<AuthUserResponse['user']> {
    const data = await apiFetch<AuthUserResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return data.user;
  },
  async register(name: string, email: string, password: string): Promise<AuthUserResponse['user']> {
    const data = await apiFetch<AuthUserResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    return data.user;
  },
  async logout(): Promise<void> {
    await apiFetch<void>('/api/auth/logout', { method: 'POST' }, false);
  },
};
