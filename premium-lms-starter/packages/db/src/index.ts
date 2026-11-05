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
export * from './repos/learning.js';
export * from './repos/assessment.js';
export * from './repos/media.js';
export * from './repos/learning-errors.js';
export * from './domain/order-state.js';
export * from './domain/lesson-progress.js';
export * from './domain/quiz-grading.js';
export * from './domain/learning-order.js';
export * as users from './repos/users.js';
export * as sessions from './repos/sessions.js';
export * as audit from './repos/audit.js';
export * as catalog from './repos/catalog.js';
export * as commerce from './repos/commerce.js';
export * as learning from './repos/learning.js';
