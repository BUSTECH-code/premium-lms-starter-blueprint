import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { CourseCover, PageIntro, StatePanel } from '../components/editorial.js';
import { Badge, Button, Spinner, TextField } from '../components/ui.js';
import { formatDuration, formatPrice } from '../lib/format.js';

interface CourseListItem {
  id: string;
  slug: string;
  href: string;
  title: string;
  summary: string | null;
  price: { amount: string; currency: string };
  tags: string[];
  instructor: { name: string };
  categories: { slug: string; name: string }[];
  moduleCount: number;
  lessonCount: number;
  totalDurationSeconds: string | null;
}

interface CategoryItem {
  slug: string;
  name: string;
  courseCount: number;
}

const PAGE_SIZE = 12;

function categoryLabel(course: CourseListItem) {
  return course.categories.length > 0
    ? course.categories.map((category) => category.name).join(' · ')
    : 'Course';
}

function courseMeta(course: CourseListItem) {
  return `${course.instructor.name} · ${course.moduleCount} module${
    course.moduleCount === 1 ? '' : 's'
  } · ${course.lessonCount} lesson${course.lessonCount === 1 ? '' : 's'} · ${formatDuration(
    course.totalDurationSeconds,
  )}`;
}

/**
 * Public catalogue: server-side search/filters, one featured editorial course
 * and compact rows for the rest. All displayed facts come from the API.
 */
export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get('category') ?? '';
  const activeTag = searchParams.get('tag') ?? '';

  const [searchDraft, setSearchDraft] = useState(searchParams.get('search') ?? '');
  const [items, setItems] = useState<CourseListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = searchParams.get('search') ?? '';

  const fetchPage = useCallback(
    async (offset: number): Promise<CourseListItem[]> => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (query) params.set('search', query);
      if (activeCategory) params.set('category', activeCategory);
      if (activeTag) params.set('tag', activeTag);
      const result = await apiFetch<{ items: CourseListItem[]; total: number }>(
        `/api/courses?${params.toString()}`,
      );
      setTotal(result.total);
      return result.items;
    },
    [query, activeCategory, activeTag],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const firstPage = await fetchPage(0);
        if (!cancelled) setItems(firstPage);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load the Course Catalog.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await apiFetch<{ items: CategoryItem[] }>('/api/categories');
        if (!cancelled) setCategories(result.items.filter((c) => c.courseCount > 0));
      } catch {
        // Category chips are a convenience; the list still loads without them.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyFilters(next: { search?: string; category?: string; tag?: string }) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params);
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const more = await fetchPage(items.length);
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...more.filter((item) => !seen.has(item.id))];
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more courses.');
    } finally {
      setLoadingMore(false);
    }
  }

  const featured = items[0];
  const remaining = items.slice(1);

  return (
    <div
      className="page catalog-page"
      data-testid="catalog-page"
      data-responsive-layout="stacked-mobile split-tablet grid-desktop"
    >
      <PageIntro
        eyebrow="Course Catalog"
        title="Learn with intent"
        lede="Browse every published course. Search by title, instructor or tag, or narrow the list by category."
        testId="catalog-hero"
        aside={
          <div className="catalogue-principles" data-testid="catalogue-principles">
            <p className="section-label">Course Catalog</p>
            <p className="muted">
              Published courses only, with real instructors, lesson counts, durations and prices.
            </p>
          </div>
        }
      />

      <section
        className="panel catalogue-filters"
        aria-label="Filter courses"
        data-testid="catalogue-filters"
      >
        <form
          role="search"
          className="inline-form filter-grid"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters({ search: searchDraft.trim() });
          }}
        >
          <TextField
            label="Search courses"
            name="search"
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Title, instructor or tag"
          />
          <div className="page-actions">
            <Button type="submit">Search</Button>
            {query || activeCategory || activeTag ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchDraft('');
                  setSearchParams({});
                }}
              >
                Clear filters
              </Button>
            ) : null}
          </div>
        </form>

        {categories.length > 0 ? (
          <div className="filter-chips" aria-label="Categories">
            {categories.map((category) => (
              <button
                key={category.slug}
                type="button"
                className={`chip${activeCategory === category.slug ? ' active' : ''}`}
                aria-pressed={activeCategory === category.slug}
                onClick={() =>
                  applyFilters({
                    category: activeCategory === category.slug ? '' : category.slug,
                  })
                }
              >
                {category.name}
                <span className="chip-count">{category.courseCount}</span>
              </button>
            ))}
          </div>
        ) : null}

        {activeTag ? (
          <p className="muted">
            Tag filter: <Badge>{activeTag}</Badge>
          </p>
        ) : null}
      </section>

      {error ? (
        <StatePanel
          kind="error"
          title="Course Catalog unavailable"
          description={error}
          testId="catalog-error-state"
        />
      ) : null}

      {loading ? (
        <StatePanel
          kind="loading"
          title="Loading courses"
          description="Fetching published courses from the Course Catalog."
          testId="catalog-loading-state"
        >
          <Spinner label="Loading courses…" />
        </StatePanel>
      ) : items.length === 0 ? (
        <StatePanel
          kind="empty"
          title="No courses found"
          description={
            <>
              No published courses match{query ? ` “${query}”` : ' your filters'}
              {activeCategory ? ` in ${activeCategory}` : ''}.
            </>
          }
          testId="catalog-empty-state"
        >
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSearchDraft('');
              setSearchParams({});
            }}
          >
            Clear filters
          </Button>
        </StatePanel>
      ) : featured ? (
        <>
          <p className="muted result-count" aria-live="polite" data-testid="catalog-result-count">
            {total} course{total === 1 ? '' : 's'}
          </p>
          <section
            className="featured-course"
            aria-labelledby="featured-course-title"
            data-testid="featured-course"
          >
            <CourseCover
              title={featured.title}
              category={categoryLabel(featured)}
              index={1}
              testId="featured-course-cover"
            />
            <div className="featured-course-body">
              <p className="eyebrow">Selected course · {categoryLabel(featured)}</p>
              <h2 id="featured-course-title">
                <Link to={featured.href}>{featured.title}</Link>
              </h2>
              {featured.summary ? <p className="featured-summary">{featured.summary}</p> : null}
              <p className="course-meta muted">{courseMeta(featured)}</p>
              {featured.tags.length > 0 ? (
                <div className="badge-row">
                  {featured.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="badge tag-badge"
                      onClick={() => applyFilters({ tag, search: '', category: '' })}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="featured-course-side">
              <p className="featured-price">
                {formatPrice(featured.price.amount, featured.price.currency)}
              </p>
              <Link className="button secondary" to={featured.href}>
                View course
              </Link>
            </div>
          </section>

          {remaining.length > 0 ? (
            <div className="course-list" data-testid="catalog-course-list">
              {remaining.map((course, index) => (
                <article key={course.id} className="course-row" data-testid="catalog-course-row">
                  <div className="course-row-main">
                    <p className="eyebrow">
                      {String(index + 2).padStart(2, '0')} · {categoryLabel(course)}
                    </p>
                    <h2>
                      <Link to={course.href}>{course.title}</Link>
                    </h2>
                    {course.summary ? <p className="muted">{course.summary}</p> : null}
                    <p className="course-meta muted">{courseMeta(course)}</p>
                    {course.tags.length > 0 ? (
                      <div className="badge-row">
                        {course.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="badge tag-badge"
                            onClick={() => applyFilters({ tag, search: '', category: '' })}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="course-row-side">
                    <p className="price">{formatPrice(course.price.amount, course.price.currency)}</p>
                    <Link className="button secondary" to={course.href}>
                      View course
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {items.length < total ? (
            <div className="pager">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                Load more courses
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
