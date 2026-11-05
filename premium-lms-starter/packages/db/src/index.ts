export * from './client.js';
export * from './migrate.js';
export * from './rbac.js';
export * from './types.js';

// Repositories — available both flat (createUser, ...) and namespaced
// (users.createUser, ...) to suit call sites.
export * from './repos/users.js';
export * from './repos/sessions.js';
export * from './repos/audit.js';
export * from './repos/catalog.js';
export * from './repos/commerce.js';
export * from './domain/order-state.js';
export * as users from './repos/users.js';
export * as sessions from './repos/sessions.js';
export * as audit from './repos/audit.js';
export * as catalog from './repos/catalog.js';
export * as commerce from './repos/commerce.js';
