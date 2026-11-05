import type { DbClient } from '../client.js';
import type { AuditEventRow } from '../types.js';

export interface InsertAuditEventInput {
  actorUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function insertAuditEvent(
  db: DbClient,
  input: InsertAuditEventInput,
): Promise<AuditEventRow> {
  const { rows } = await db.query<AuditEventRow>(
    `INSERT INTO audit_events (actor_user_id, action, target_type, target_id, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, actor_user_id, action, target_type, target_id, metadata,
               ip_address, created_at`,
    [
      input.actorUserId,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.ipAddress ?? null,
    ],
  );
  const event = rows[0];
  if (!event) throw new Error('Audit event insert returned no row');
  return event;
}

export interface ListAuditEventsOptions {
  limit: number;
  offset: number;
  action?: string;
}

export async function listAuditEvents(
  db: DbClient,
  options: ListAuditEventsOptions,
): Promise<{ items: AuditEventRow[]; total: number }> {
  const limit = Math.min(Math.max(options.limit, 1), 100);
  const offset = Math.max(options.offset, 0);
  const filter = options.action ? 'WHERE action = $1' : '';
  const filterParams = options.action ? [options.action] : [];

  const { rows: totalRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_events ${filter}`,
    filterParams,
  );
  const { rows } = await db.query<AuditEventRow>(
    `SELECT id, actor_user_id, action, target_type, target_id, metadata,
            ip_address, created_at
       FROM audit_events
       ${filter}
      ORDER BY created_at DESC, id DESC
      LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`,
    [...filterParams, limit, offset],
  );

  return { items: rows, total: Number(totalRows[0]?.count ?? 0) };
}
