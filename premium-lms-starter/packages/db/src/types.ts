/** Row types mirroring the database schema (0001_init.sql). */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  password_algorithm: string;
  name: string;
  bio: string | null;
  status: 'active' | 'suspended';
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface RoleRow {
  key: string;
  name: string;
  description: string | null;
  created_at: Date;
}

export interface PermissionRow {
  key: string;
  description: string;
  created_at: Date;
}

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  previous_refresh_token_hash: string | null;
  created_at: Date;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  last_seen_at: Date;
  user_agent: string | null;
  ip_address: string | null;
}

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  status: 'draft' | 'in_review' | 'published' | 'withdrawal_scheduled' | 'withdrawn';
  version: number;
  created_by: string;
  published_at: Date | null;
  price_amount: string;
  price_currency: string;
  tags: string[];
  created_at: Date;
  updated_at: Date;
}

export interface ModuleRow {
  id: string;
  course_id: string;
  title: string;
  position: number;
  created_at: Date;
  updated_at: Date;
}

export interface LessonRow {
  id: string;
  module_id: string;
  title: string;
  position: number;
  duration_seconds: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EnrollmentRow {
  id: string;
  user_id: string;
  course_id: string;
  status: 'active' | 'completed';
  enrolled_at: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type OrderStatus =
  | 'created'
  | 'payment_pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'partially_refunded'
  | 'refunded'
  | 'reversed';

export interface OrderRow {
  id: string;
  user_id: string;
  status: OrderStatus;
  currency: string;
  total_amount: string;
  idempotency_key: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  course_id: string;
  title_snapshot: string;
  unit_amount: string;
  quantity: number;
  created_at: Date;
}

export type PaymentStatus =
  | 'initiated'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'reversed'
  | 'refunded';

export interface PaymentRow {
  id: string;
  order_id: string;
  provider: string;
  provider_reference: string | null;
  status: PaymentStatus;
  amount: string;
  currency: string;
  processed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentEventRow {
  id: string;
  provider: string;
  event_id: string;
  event_type: string | null;
  payload: unknown;
  status: 'received' | 'processed' | 'ignored' | 'quarantined';
  received_at: Date;
  processed_at: Date | null;
}

export interface EntitlementRow {
  id: string;
  user_id: string;
  course_id: string;
  source: string;
  status: 'active' | 'revoked';
  granted_by_payment_id: string | null;
  granted_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  revoked_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface LessonProgressRow {
  id: string;
  user_id: string;
  lesson_id: string;
  enrollment_id: string | null;
  status: 'not_started' | 'in_progress' | 'completed';
  progress_percent: string;
  playback_position_seconds: string | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AuditEventRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;
  ip_address: string | null;
  created_at: Date;
}
