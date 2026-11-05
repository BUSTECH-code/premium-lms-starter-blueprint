import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { useAuth } from '../auth/AuthProvider.js';
import { CourseCover, PageIntro, StatePanel } from '../components/editorial.js';
import { Badge, Button, Spinner } from '../components/ui.js';
import { formatDuration, formatPrice } from '../lib/format.js';

interface CurriculumModule {
  id: string;
  title: string;
  position: number;
  lessons: { id: string; title: string; position: number; duration_seconds: string | null }[];
}

interface CourseDetail {
  id: string;
  slug: string;
  href: string;
  title: string;
  summary: string | null;
  description: string | null;
  status: string;
  price: { amount: string; currency: string };
  tags: string[];
  categories: { slug: string; name: string }[];
  instructor: { id: string; name: string; bio: string | null };
  curriculum: CurriculumModule[];
  stats: {
    moduleCount: number;
    lessonCount: number;
    totalDurationSeconds: string | null;
  };
  publishedAt: string | null;
  purchasable: boolean;
  withdrawn: boolean;
  access: { entitled: boolean; entitlementStatus: string | null };
}

/**
 * Public course landing page. Purchase starts an order via the API and hands
 * off to simulated checkout; entitled learners are routed to the player.
 * Withdrawn courses never show a buy button.
 */
export function CourseDetailPage() {
  const { slug = '' } = useParams();
  const { status } = useAuth();
  const navigate = useNavigate();

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const result = await apiFetch<{ course: CourseDetail }>(`/api/courses/${slug}`);
      setCourse(result.course);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Could not load this course.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startPurchase() {
    setPurchasing(true);
    setError(null);
    try {
      const result = await apiFetch<{
        order: { id: string };
        payment: { providerReference: string } | null;
        checkoutUrl: string | null;
      }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ courseSlug: slug }),
      });
      if (result.checkoutUrl) navigate(result.checkoutUrl);
      else navigate(`/orders/${result.order.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          navigate('/login');
          return;
        }
        if (err.code === 'already_owned') {
          await load();
          return;
        }
        setError(err.message);
      } else {
        setError('Could not start checkout. Please try again.');
      }
    } finally {
      setPurchasing(false);
    }
  }

  if (loading) {
    return (
      <div className="page" data-testid="course-detail-loading">
        <StatePanel
          kind="loading"
          title="Loading course"
          description="Fetching the published course, curriculum and purchase state."
          testId="course-detail-loading-state"
        >
          <Spinner label="Loading course…" />
        </StatePanel>
      </div>
    );
  }

  if (notFound || !course) {
    return (
      <div className="full-page-state" data-testid="course-not-found-page">
        <StatePanel
          kind="error"
          title="Course not found"
          description="This course does not exist or is not available."
          testId="course-not-found-state"
        >
          <Link className="button secondary" to="/courses">
            Back to catalogue
          </Link>
        </StatePanel>
      </div>
    );
  }

  const paragraphs = (course.description ?? '')
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean);
  const categoryLabel =
    course.categories.length > 0
      ? course.categories.map((category) => category.name).join(' · ')
      : 'Course';

  return (
    <div
      className="page course-detail-page"
      data-testid="course-detail-page"
      data-responsive-layout="stacked-mobile split-tablet grid-desktop"
    >
      <nav className="breadcrumbs" aria-label="Breadcrumb" data-testid="course-breadcrumbs">
        <Link to="/courses">Catalogue</Link>
        <span aria-hidden="true"> / </span>
        <span>{course.title}</span>
      </nav>

      <PageIntro
        eyebrow={categoryLabel}
        title={course.title}
        lede={course.summary ?? 'A structured course with a published curriculum and instructor.'}
        className="course-detail-hero"
        testId="course-detail-hero"
        titleId="course-detail-title"
        aside={
          <CourseCover
            title={course.title}
            category={categoryLabel}
            index={1}
            testId="course-detail-cover"
          />
        }
      />

      {error ? (
        <StatePanel
          kind="error"
          title="Checkout could not start"
          description={error}
          testId="course-detail-error-state"
        />
      ) : null}

      {course.withdrawn ? (
        <StatePanel
          kind="warning"
          title="Withdrawn course"
          description="This course is no longer for sale. Your access and purchase history are preserved."
          testId="course-withdrawn-state"
        />
      ) : null}
      {course.status !== 'published' && !course.withdrawn ? (
        <StatePanel
          kind="warning"
          title="Not currently on sale"
          description="This course is not currently on sale."
          testId="course-unpublished-state"
        />
      ) : null}

      <div
        className="detail-layout course-detail-layout"
        data-testid="course-detail-layout"
      >
        <main className="panel detail-main" data-testid="course-detail-main">
          <p className="course-meta muted">
            Taught by {course.instructor.name} · {course.stats.moduleCount} module
            {course.stats.moduleCount === 1 ? '' : 's'} · {course.stats.lessonCount} lesson
            {course.stats.lessonCount === 1 ? '' : 's'} ·{' '}
            {formatDuration(course.stats.totalDurationSeconds)}
          </p>

          <dl className="course-format-grid" data-testid="course-format-grid">
            <div className="format-stat">
              <dt>Modules</dt>
              <dd>{course.stats.moduleCount}</dd>
            </div>
            <div className="format-stat">
              <dt>Lessons</dt>
              <dd>{course.stats.lessonCount}</dd>
            </div>
            <div className="format-stat">
              <dt>Total length</dt>
              <dd>{formatDuration(course.stats.totalDurationSeconds)}</dd>
            </div>
            <div className="format-stat">
              <dt>Instructor</dt>
              <dd>{course.instructor.name}</dd>
            </div>
          </dl>

          {paragraphs.length > 0 ? (
            <section className="prose" aria-labelledby="about-course-title">
              <h2 id="about-course-title">About this course</h2>
              {paragraphs.map((text) => (
                <p key={text.slice(0, 40)}>{text}</p>
              ))}
            </section>
          ) : null}

          <section className="curriculum-card" aria-labelledby="curriculum-title">
            <h2 id="curriculum-title">Curriculum</h2>
            {course.curriculum.length === 0 ? (
              <p className="muted">The curriculum is being finalised.</p>
            ) : (
              <div className="curriculum">
                {course.curriculum.map((module, index) => (
                  <details key={module.id} open={index === 0}>
                    <summary>
                      Module {index + 1}: {module.title}
                      <span className="muted">
                        {module.lessons.length} lesson{module.lessons.length === 1 ? '' : 's'}
                      </span>
                    </summary>
                    <ol>
                      {module.lessons.map((lesson) => (
                        <li key={lesson.id}>
                          <span>{lesson.title}</span>
                          <span className="muted">{formatDuration(lesson.duration_seconds)}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
            )}
          </section>

          <section className="instructor-card" aria-labelledby="instructor-title">
            <h2 id="instructor-title">Your instructor</h2>
            <p className="course-meta muted">{course.instructor.name}</p>
            {course.instructor.bio ? (
              <p>{course.instructor.bio}</p>
            ) : (
              <p className="muted">Instructor biography coming soon.</p>
            )}
          </section>

          {course.tags.length > 0 ? (
            <div className="badge-row" aria-label="Tags">
              {course.tags.map((tag) => (
                <Link key={tag} className="badge tag-badge" to={`/courses?tag=${tag}`}>
                  {tag}
                </Link>
              ))}
            </div>
          ) : null}
        </main>

        <aside
          className="panel purchase-card"
          aria-label="Purchase"
          data-testid="purchase-card"
        >
          <p className="section-label">One-time enrolment</p>
          <p className="price">{formatPrice(course.price.amount, course.price.currency)}</p>
          <dl className="detail-grid">
            <div>
              <dt>Modules</dt>
              <dd>{course.stats.moduleCount}</dd>
            </div>
            <div>
              <dt>Lessons</dt>
              <dd>{course.stats.lessonCount}</dd>
            </div>
            <div>
              <dt>Total length</dt>
              <dd>{formatDuration(course.stats.totalDurationSeconds)}</dd>
            </div>
          </dl>

          <div className="purchase-actions">
            {course.access.entitled ? (
              <>
                <Badge>You have access</Badge>
                <Link className="button primary" to={`/learn/${course.slug}`}>
                  Open the course
                </Link>
              </>
            ) : course.withdrawn || course.status !== 'published' ? (
              <p className="muted">Not currently available for purchase.</p>
            ) : status === 'anonymous' ? (
              <Link className="button primary" to="/login">
                Sign in to purchase
              </Link>
            ) : status === 'loading' ? (
              <Spinner label="Checking your session…" />
            ) : (
              <Button loading={purchasing} onClick={() => void startPurchase()}>
                Purchase access
              </Button>
            )}
          </div>

          <p className="muted small-print">
            One-time payment. Access is added to your account as soon as payment is confirmed.
          </p>
        </aside>
      </div>
    </div>
  );
}
