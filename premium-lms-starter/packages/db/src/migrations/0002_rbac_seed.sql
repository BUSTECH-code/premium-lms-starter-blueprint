-- =============================================================================
-- 0002_rbac_seed.sql — RBAC reference data
--
-- Mirrors packages/db/src/rbac.ts (TypeScript source of truth; a unit test
-- asserts both stay aligned).
--
-- Baseline note: the final permission matrix is OPEN (docs/product/open-
-- requirements.md). Only the permissions grounded in the "potential
-- responsibilities" of docs/product/user-roles.md are seeded. Instructor
-- content permissions are withheld pending O-03. Do not add grants here
-- without an approved product decision.
-- =============================================================================

INSERT INTO roles (key, name, description) VALUES
  ('student',
   'Student',
   'Learner who discovers, purchases and studies courses.'),
  ('instructor',
   'Instructor',
   'Content author / course creator. Content permissions pending approval of the permission matrix (O-03).'),
  ('admin',
   'Administrator',
   'Operations administrator: manages users and roles, reviews audit records.')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description;

INSERT INTO permissions (key, description) VALUES
  ('users.read', 'View user accounts.'),
  ('users.manage_roles', 'Assign or remove roles for user accounts.'),
  ('audit.read', 'Review audit events.')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description;

INSERT INTO role_permissions (role_key, permission_key) VALUES
  ('admin', 'users.read'),
  ('admin', 'users.manage_roles'),
  ('admin', 'audit.read')
ON CONFLICT DO NOTHING;
