export * from './client.js';
export * from './migrate.js';
export * from './rbac.js';
export * from './types.js';

// Repositories — available both flat (createUser, ...) and namespaced
// (users.createUser, ...) to suit call sites.
export * from './repos/users.js';
export * from './repos/sessions.js';
export * from './repos/audit.js';
export * as users from './repos/users.js';
export * as sessions from './repos/sessions.js';
export * as audit from './repos/audit.js';
