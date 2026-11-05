import type { Permission, Role, UserRow } from '@lms/db';

export interface AuthContext {
  user: UserRow;
  roles: Role[];
  permissions: Permission[];
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by the authenticate middleware on protected routes. */
    auth?: AuthContext;
    /** Correlation id for logs. */
    id?: string;
  }
}
