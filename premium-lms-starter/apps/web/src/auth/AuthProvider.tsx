import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, authApi } from './api.js';
import type { SessionUser } from './permissions.js';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await authApi.me();
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch (error) {
        if (!cancelled) {
          // 401 is the normal signed-out state; anything else is treated the
          // same way at boot (the API remains the authority on each request).
          setUser(null);
          setStatus('anonymous');
          if (!(error instanceof ApiError)) {
            console.warn('Session check failed:', error);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await authApi.login(email, password);
    setUser(me);
    setStatus('authenticated');
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const me = await authApi.register(name, email, password);
    setUser(me);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Local state is cleared even if the network call fails — the server
      // session is revoked independently and cookies are cleared by the API.
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, login, register, logout }),
    [status, user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}

export type { ApiError };
