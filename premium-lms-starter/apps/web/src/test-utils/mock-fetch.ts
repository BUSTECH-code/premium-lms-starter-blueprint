import { vi } from 'vitest';

/**
 * Minimal fetch stub for component tests: route by URL prefix, JSON in/out,
 * shaped exactly like the API contract (success objects / {error:{code,message}}).
 */
export type FetchRoutes = Record<
  string,
  unknown | ((url: string, init?: RequestInit) => unknown)
>;

/** Route value that makes the stub answer with an error status. */
export function httpError(status: number, code: string, message: string) {
  return { __errorStatus: status, body: { error: { code, message } } };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers({ 'Content-Type': 'application/json' }),
  } as Response;
}

export function stubFetch(routes: FetchRoutes) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        if (handler === undefined) {
          // Explicit `undefined` route = the endpoint answers 404.
          return jsonResponse(404, {
            error: { code: 'not_found', message: 'Resource not found.' },
          });
        }
        if (
          typeof handler === 'object' &&
          handler !== null &&
          '__errorStatus' in (handler as Record<string, unknown>)
        ) {
          const err = handler as { __errorStatus: number; body: unknown };
          return jsonResponse(err.__errorStatus, err.body);
        }
        const body = typeof handler === 'function' ? handler(url, init) : handler;
        return jsonResponse(200, body);
      }
    }
    return jsonResponse(404, {
      error: { code: 'not_found', message: `No stub for ${url}` },
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Signed-out session: /api/auth/me answers 401 like the real API. */
export const ANONYMOUS_ME = httpError(401, 'unauthorized', 'Authentication required.');

export function jsonRequest(init?: RequestInit): Record<string, unknown> | undefined {
  if (!init?.body) return undefined;
  try {
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
