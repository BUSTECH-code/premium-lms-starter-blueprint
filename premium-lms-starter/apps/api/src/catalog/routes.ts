import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  findActiveEntitlement,
  getCourseBySlug,
  getCurriculum,
  listCategories,
  listPublishedCourses,
  type CourseDetailRow,
  type CourseListItem,
  type DbClient,
} from '@lms/db';
import { optionalAuthenticate } from '../auth/middleware.js';
import type { Env } from '../config/env.js';
import { errors } from '../lib/errors.js';
import {
  getValidatedParams,
  getValidatedQuery,
  validateParams,
  validateQuery,
} from '../middleware/validate.js';

const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  category: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Invalid category slug.')
    .max(60)
    .optional(),
  tag: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Invalid tag.')
    .max(60)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const slugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Invalid course slug.')
    .min(2)
    .max(80),
});

interface CatalogRouterDeps {
  env: Env;
  db: DbClient;
}

function serializeListItem(item: CourseListItem) {
  return {
    id: item.id,
    slug: item.slug,
    href: `/courses/${item.slug}`,
    title: item.title,
    summary: item.summary,
    price: { amount: item.price_amount, currency: item.price_currency },
    tags: item.tags,
    instructor: { name: item.instructor_name },
    categories: item.categories,
    moduleCount: item.module_count,
    lessonCount: item.lesson_count,
    totalDurationSeconds: item.total_duration_seconds,
    publishedAt: item.published_at,
  };
}

function serializeDetail(
  course: CourseDetailRow,
  curriculum: Awaited<ReturnType<typeof getCurriculum>>,
  access: { entitled: boolean; entitlementStatus: string | null },
) {
  return {
    id: course.id,
    slug: course.slug,
    href: `/courses/${course.slug}`,
    title: course.title,
    summary: course.summary,
    description: course.description,
    status: course.status,
    price: { amount: course.price_amount, currency: course.price_currency },
    tags: course.tags,
    categories: course.categories,
    instructor: {
      id: course.instructor_id,
      name: course.instructor_name,
      bio: course.instructor_bio,
    },
    curriculum,
    stats: {
      moduleCount: course.module_count,
      lessonCount: course.lesson_count,
      totalDurationSeconds: course.total_duration_seconds,
    },
    publishedAt: course.published_at,
    /** Sale availability: published AND not already owned. */
    purchasable: course.status === 'published' && !access.entitled,
    /** Withdrawn courses are never sold again (course-withdrawal workflow). */
    withdrawn: course.status === 'withdrawn',
    access,
  };
}

export function createCatalogRouter(deps: CatalogRouterDeps): Router {
  const { db } = deps;
  const router = Router();

  // --------------------------------------------------------------------------
  // GET /api/courses — public catalogue (published only) with filters
  // --------------------------------------------------------------------------
  router.get(
    '/courses',
    validateQuery(listQuerySchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const query = getValidatedQuery<z.infer<typeof listQuerySchema>>(req);
        const { items, total } = await listPublishedCourses(db, {
          search: query.search,
          category: query.category,
          tag: query.tag,
          limit: query.limit,
          offset: query.offset,
        });
        res.json({
          items: items.map(serializeListItem),
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
  // GET /api/categories — category taxonomy with published-course counts
  // --------------------------------------------------------------------------
  router.get('/categories', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const categories = await listCategories(db);
      res.json({
        items: categories.map((category) => ({
          id: category.id,
          slug: category.slug,
          name: category.name,
          description: category.description,
          courseCount: category.course_count,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/courses/:slug — course landing page data
  // Published courses are public; any other status is visible only to users
  // with an active entitlement (purchase history survives withdrawal).
  // --------------------------------------------------------------------------
  router.get(
    '/courses/:slug',
    optionalAuthenticate(deps.env, db),
    validateParams(slugParamsSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { slug } = getValidatedParams<z.infer<typeof slugParamsSchema>>(req);
        const course = await getCourseBySlug(db, slug);
        if (!course) {
          throw errors.notFound('course_not_found', 'Course not found.');
        }

        let entitled = false;
        let entitlementStatus: string | null = null;
        if (req.auth) {
          const entitlement = await findActiveEntitlement(db, req.auth.user.id, course.id);
          if (entitlement) {
            entitled = entitlement.status === 'active';
            entitlementStatus = entitlement.status;
          }
        }

        const visible = course.status === 'published' || entitled;
        if (!visible) {
          // Do not leak the existence of drafts/withdrawn courses.
          throw errors.notFound('course_not_found', 'Course not found.');
        }

        const curriculum = await getCurriculum(db, course.id);
        res.json({
          course: serializeDetail(course, curriculum, { entitled, entitlementStatus }),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
