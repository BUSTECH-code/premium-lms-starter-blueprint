import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { Alert, Badge, Button, Spinner, TextField } from '../components/ui.js';
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

/**
 * Public catalogue: search + category/tag filters (server-side), rendered as
 * editorial rows — deliberately not a wall of identical cards (AGENTS.md).
 * Only published courses are ever listed; no ratings/discounts/student
 * counts are shown because the product does not track them.
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
          setError(err instanceof ApiError ? err.message : 'Could not load the catalogue.');
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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Catalogue</p>
          <h1>Courses</h1>
          <p className="muted lede">
            Browse every published course. Search by title, instructor or tag, or narrow the list
            by category.
          </p>
        </div>
      </header>

      <section className="panel catalogue-filters" aria-label="Filter courses">
        <form
          role="search"
          className="inline-form"
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
        </form>

        {categories.length > 0 ? (
          <div className="chip-row" aria-label="Categories">
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

      {error ? <Alert>{error}</Alert> : null}

      {loading ? (
        <div className="spinner-row" aria-live="polite">
          <Spinner label="Loading courses…" />
        </div>
      ) : items.length === 0 ? (
        <section className="panel empty-state">
          <p className="muted">
            No published courses match{query ? ` “${query}”` : ' your filters'}
            {activeCategory ? ` in ${activeCategory}` : ''}.
          </p>
        </section>
      ) : (
        <>
          <p className="muted result-count" aria-live="polite">
            {total} course{total === 1 ? '' : 's'}
          </p>
          <div className="course-list">
            {items.map((course) => (
              <article key={course.id} className="course-row">
                <div className="course-row-main">
                  <p className="eyebrow">
                    {course.categories.length > 0
                      ? course.categories.map((c) => c.name).join(' · ')
                      : 'Course'}
                  </p>
                  <h2>
                    <Link to={course.href}>{course.title}</Link>
                  </h2>
                  {course.summary ? <p className="muted">{course.summary}</p> : null}
                  <p className="course-meta muted">
                    {course.instructor.name} · {course.moduleCount} module
                    {course.moduleCount === 1 ? '' : 's'} · {course.lessonCount} lesson
                    {course.lessonCount === 1 ? '' : 's'} ·{' '}
                    {formatDuration(course.totalDurationSeconds)}
                  </p>
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

          {items.length < total ? (
            <div className="pager">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                Load more courses
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
