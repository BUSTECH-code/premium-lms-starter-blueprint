import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  audit as auditRepo,
  findUserById,
  getUserAccess,
  isRole,
  listUsers,
  setUserRoles,
  type DbClient,
} from '@lms/db';
import type { Env } from '../config/env.js';
import { errors } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { getValidatedParams, getValidatedQuery, validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { requirePermission } from '../auth/middleware.js';
import { authenticate } from '../auth/middleware.js';

const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).max(200).optional(),
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().trim().min(1).max(120).optional(),
});

const userIdParamsSchema = z.object({ id: z.uuid('A valid user id is required.') });

const rolesBodySchema = z.object({
  roles: z
    .array(z.string().trim().min(1).max(64))
    .min(1, 'At least one role is required.')
    .max(10)
    .refine((roles) => new Set(roles).size === roles.length, 'Duplicate roles are not allowed.')
    .refine(
      (roles) => roles.every((role) => isRole(role)),
      'Unknown role. Valid roles: student, instructor, admin.',
    ),
});

interface AdminRouterDeps {
  env: Env;
  db: DbClient;
  logger: Logger;
}

function safeUser(user: {
  id: string;
  email: string;
  name: string;
  status: string;
  created_at: Date;
  roles: string[];
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    roles: user.roles,
    createdAt: user.created_at,
  };
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const { db, logger } = deps;
  const router = Router();

  // Every admin route requires an authenticated session first.
  router.use(authenticate(deps.env, db));

  // --------------------------------------------------------------------------
  // GET /api/admin/users — list accounts (users.read)
  // --------------------------------------------------------------------------
  router.get(
    '/users',
    requirePermission(PERMISSIONS.USERS_READ),
    validateQuery(listUsersQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const query = getValidatedQuery<z.infer<typeof listUsersQuerySchema>>(req);
        const { items, total } = await listUsers(db, {
          limit: query.limit,
          offset: query.offset,
          search: query.q,
        });
        res.json({
          items: items.map(safeUser),
          total,
          limit: query.limit,
          offset: query.offset,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // PATCH /api/admin/users/:id/roles — replace roles (users.manage_roles)
  // --------------------------------------------------------------------------
  router.patch(
    '/users/:id/roles',
    requirePermission(PERMISSIONS.USERS_MANAGE_ROLES),
    validateParams(userIdParamsSchema),
    validateBody(rolesBodySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id: targetId } = getValidatedParams<z.infer<typeof userIdParamsSchema>>(req);
        const { roles } = req.body as z.infer<typeof rolesBodySchema>;
        const actor = req.auth!;

        const target = await findUserById(db, targetId);
        if (!target) {
          throw errors.notFound('user_not_found', 'User not found.');
        }

        // Safety guard: an admin cannot remove their own admin role (prevents
        // locking the last administrator out of the system).
        if (target.id === actor.user.id && !roles.includes('admin')) {
          throw errors.forbidden(
            'cannot_demote_self',
            'You cannot remove your own administrator role.',
          );
        }

        const result = await db.transaction(async (tx) => {
          const changes = await setUserRoles(tx, {
            userId: target.id,
            roleKeys: roles,
            grantedBy: actor.user.id,
          });
          for (const role of changes.added) {
            await auditRepo.insertAuditEvent(tx, {
              actorUserId: actor.user.id,
              action: 'role.added',
              targetType: 'user',
              targetId: target.id,
              metadata: { role },
              ipAddress: req.ip ?? null,
            });
          }
          for (const role of changes.removed) {
            await auditRepo.insertAuditEvent(tx, {
              actorUserId: actor.user.id,
              action: 'role.removed',
              targetType: 'user',
              targetId: target.id,
              metadata: { role },
              ipAddress: req.ip ?? null,
            });
          }
          return changes;
        });

        logger.info(
          {
            event: 'roles_updated',
            actorId: actor.user.id,
            targetId: target.id,
            added: result.added,
            removed: result.removed,
            requestId: req.id,
          },
          'user roles updated',
        );

        const access = await getUserAccess(db, target.id);
        if (!access) throw errors.notFound('user_not_found', 'User not found.');
        res.json({
          user: {
            id: access.user.id,
            email: access.user.email,
            name: access.user.name,
            roles: access.roles,
            permissions: access.permissions,
          },
          changes: result,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/admin/audit-events — review audit records (audit.read)
  // --------------------------------------------------------------------------
  router.get(
    '/audit-events',
    requirePermission(PERMISSIONS.AUDIT_READ),
    validateQuery(auditQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const query = getValidatedQuery<z.infer<typeof auditQuerySchema>>(req);
        const { items, total } = await auditRepo.listAuditEvents(db, {
          limit: query.limit,
          offset: query.offset,
          action: query.action,
        });
        res.json({
          items: items.map((event) => ({
            id: event.id,
            actorUserId: event.actor_user_id,
            action: event.action,
            targetType: event.target_type,
            targetId: event.target_id,
            metadata: event.metadata,
            ipAddress: event.ip_address,
            createdAt: event.created_at,
          })),
          total,
          limit: query.limit,
          offset: query.offset,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
