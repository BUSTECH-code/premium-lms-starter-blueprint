import type { DbClient } from '../client.js';

/**
 * Catalogue read models. Only `published` courses are publicly listed; the
 * route layer additionally allows entitlement holders to view withdrawn
 * course metadata (purchase history is always preserved — withdrawal docs).
 */

export interface CourseListFilters {
  search?: string;
  category?: string;
  tag?: string;
  limit: number;
  offset: number;
}

export interface CourseListItem {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  price_amount: string;
  price_currency: string;
  tags: string[];
  instructor_name: string;
  categories: { slug: string; name: string }[];
  module_count: number;
  lesson_count: number;
  total_duration_seconds: string | null;
  published_at: Date | null;
}

export interface CourseDetailRow extends CourseListItem {
  description: string | null;
  status: string;
  version: number;
  instructor_id: string;
  instructor_bio: string | null;
}

export interface CurriculumModule {
  id: string;
  title: string;
  position: number;
  lessons: { id: string; title: string; position: number; duration_seconds: string | null }[];
}

export interface CategoryListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  course_count: number;
}

const COURSE_SELECT = `
  SELECT c.id, c.slug, c.title, c.summary, c.description, c.status, c.version,
         c.price_amount::text AS price_amount, c.price_currency, c.tags,
         c.published_at, c.created_at,
         u.id AS instructor_id, u.name AS instructor_name, u.bio AS instructor_bio,
         COALESCE((SELECT count(*) FROM modules m WHERE m.course_id = c.id), 0)::int AS module_count,
         COALESCE((SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
                    WHERE m.course_id = c.id), 0)::int AS lesson_count,
         (SELECT round(sum(l.duration_seconds)) FROM lessons l JOIN modules m ON m.id = l.module_id
           WHERE m.course_id = c.id)::text AS total_duration_seconds,
         COALESCE((SELECT json_agg(json_build_object('slug', cat.slug, 'name', cat.name)
                                   ORDER BY cat.name)
                     FROM course_categories cc JOIN categories cat ON cat.id = cc.category_id
                    WHERE cc.course_id = c.id), '[]'::json) AS categories
    FROM courses c
    JOIN users u ON u.id = c.created_by`;

function buildWhere(filters: CourseListFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.search) {
    params.push(`%${filters.search}%`);
    const p = `$${params.length}`;
    clauses.push(
      `(c.title ILIKE ${p} OR c.summary ILIKE ${p} OR c.description ILIKE ${p}
        OR u.name ILIKE ${p} OR EXISTS (SELECT 1 FROM unnest(c.tags) t WHERE t ILIKE ${p}))`,
    );
  }
  if (filters.category) {
    params.push(filters.category);
    clauses.push(
      `EXISTS (SELECT 1 FROM course_categories cc JOIN categories cat ON cat.id = cc.category_id
                WHERE cc.course_id = c.id AND cat.slug = $${params.length})`,
    );
  }
  if (filters.tag) {
    params.push(filters.tag);
    clauses.push(`$${params.length} = ANY(c.tags)`);
  }

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export async function listPublishedCourses(
  db: DbClient,
  filters: CourseListFilters,
): Promise<{ items: CourseListItem[]; total: number }> {
  const where = buildWhere({ ...filters, search: filters.search || undefined });
  const baseWhere = where.sql
    ? `${where.sql} AND c.status = 'published'`
    : `WHERE c.status = 'published'`;

  const countParams = [...where.params];
  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM courses c JOIN users u ON u.id = c.created_by
       ${baseWhere}`,
    countParams,
  );

  const listParams = [...where.params, filters.limit, filters.offset];
  const { rows } = await db.query<CourseListItem>(
    `${COURSE_SELECT}
     ${baseWhere}
     ORDER BY c.published_at DESC NULLS LAST, c.title ASC
     LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}`,
    listParams,
  );

  return { items: rows, total: Number(countRows[0]?.count ?? 0) };
}

/** Returns the course regardless of status; callers decide visibility. */
export async function getCourseBySlug(db: DbClient, slug: string): Promise<CourseDetailRow | null> {
  const { rows } = await db.query<CourseDetailRow>(
    `${COURSE_SELECT} WHERE c.slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function getCourseById(db: DbClient, id: string): Promise<CourseDetailRow | null> {
  const { rows } = await db.query<CourseDetailRow>(
    `${COURSE_SELECT} WHERE c.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getCurriculum(db: DbClient, courseId: string): Promise<CurriculumModule[]> {
  const { rows: modules } = await db.query<{ id: string; title: string; position: number }>(
    `SELECT id, title, position FROM modules WHERE course_id = $1 ORDER BY position`,
    [courseId],
  );
  if (modules.length === 0) return [];

  const { rows: lessons } = await db.query<{
    module_id: string;
    id: string;
    title: string;
    position: number;
    duration_seconds: string | null;
  }>(
    `SELECT l.module_id, l.id, l.title, l.position, l.duration_seconds::text AS duration_seconds
       FROM lessons l JOIN modules m ON m.id = l.module_id
      WHERE m.course_id = $1
      ORDER BY m.position, l.position`,
    [courseId],
  );

  return modules.map((module) => ({
    id: module.id,
    title: module.title,
    position: module.position,
    lessons: lessons
      .filter((lesson) => lesson.module_id === module.id)
      .map(({ module_id: _moduleId, ...lesson }) => lesson),
  }));
}

export async function listCategories(db: DbClient): Promise<CategoryListItem[]> {
  const { rows } = await db.query<CategoryListItem>(
    `SELECT cat.id, cat.slug, cat.name, cat.description,
            COALESCE((SELECT count(*) FROM course_categories cc
                        JOIN courses c ON c.id = cc.course_id
                       WHERE cc.category_id = cat.id AND c.status = 'published'), 0)::int AS course_count
       FROM categories cat
      ORDER BY cat.name`,
  );
  return rows;
}
