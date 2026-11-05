// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider.js';
import { ANONYMOUS_ME, stubFetch } from '../test-utils/mock-fetch.js';
import { CourseDetailPage } from './CourseDetailPage.js';

const baseCourse = {
  id: 'c1',
  slug: 'node-at-scale',
  href: '/courses/node-at-scale',
  title: 'Node at Scale',
  summary: 'Design resilient services.',
  description: 'First paragraph.\n\nSecond paragraph.',
  status: 'published',
  price: { amount: '45000.00', currency: 'NGN' },
  tags: ['node'],
  categories: [{ slug: 'engineering', name: 'Engineering' }],
  instructor: { id: 'u1', name: 'Ada Instructor', bio: 'Ada writes systems.' },
  curriculum: [
    {
      id: 'm1',
      title: 'Foundations',
      position: 1,
      lessons: [
        { id: 'l1', title: 'Intro', position: 1, duration_seconds: '600' },
        { id: 'l2', title: 'Core ideas', position: 2, duration_seconds: '900' },
      ],
    },
  ],
  stats: { moduleCount: 1, lessonCount: 2, totalDurationSeconds: '1500' },
  publishedAt: '2026-01-01T00:00:00.000Z',
  purchasable: true,
  withdrawn: false,
  access: { entitled: false, entitlementStatus: null as string | null },
};

const student = {
  id: 'u2',
  email: 'learner@example.com',
  name: 'Learner',
  status: 'active',
  roles: ['student'],
  permissions: [],
};

function renderDetail(courseOverrides: Partial<typeof baseCourse> = {}, anonymous = true) {
  const course = { ...baseCourse, ...courseOverrides };
  stubFetch({
    '/api/auth/me': anonymous ? ANONYMOUS_ME : { user: student },
    [`/api/courses/${course.slug}`]: { course },
  });
  render(
    <MemoryRouter initialEntries={[`/courses/${course.slug}`]}>
      <AuthProvider>
        <Routes>
          <Route path="/courses/:slug" element={<CourseDetailPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CourseDetailPage', () => {
  it('shows curriculum, instructor and a sign-in purchase CTA for visitors', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Node at Scale' })).toBeTruthy();
    expect(screen.getByText(/45,000/)).toBeTruthy();
    expect(screen.getByText('Taught by Ada Instructor · 1 module · 2 lessons · 25m')).toBeTruthy();
    expect(screen.getByText('Ada writes systems.')).toBeTruthy();
    // Curriculum outline
    expect(screen.getByText(/Module 1: Foundations/)).toBeTruthy();
    expect(screen.getByText('Intro')).toBeTruthy();
    // Anonymous purchase path (auth session resolves async)
    const signIn = await screen.findByRole('link', { name: 'Sign in to purchase' });
    expect(signIn).toHaveProperty('href', expect.stringContaining('/login'));
    // Never show a buy button to signed-out visitors.
    expect(screen.queryByRole('button', { name: 'Purchase access' })).toBeNull();
  });

  it('offers the dashboard instead of buying when the learner already owns the course', async () => {
    renderDetail(
      { purchasable: false, access: { entitled: true, entitlementStatus: 'active' } },
      false,
    );

    expect(await screen.findByRole('heading', { name: 'Node at Scale' })).toBeTruthy();
    expect(await screen.findByText('You have access')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Go to your dashboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Purchase access' })).toBeNull();
  });

  it('hides purchase for withdrawn courses shown to entitled learners', async () => {
    renderDetail(
      {
        status: 'withdrawn',
        withdrawn: true,
        purchasable: false,
        access: { entitled: true, entitlementStatus: 'active' },
      },
      false,
    );

    expect(await screen.findByRole('heading', { name: 'Node at Scale' })).toBeTruthy();
    expect(await screen.findByText(/no longer for sale/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Purchase access' })).toBeNull();
  });

  it('renders a not-found state for missing courses', async () => {
    stubFetch({
      '/api/auth/me': ANONYMOUS_ME,
      '/api/courses/ghost-course': undefined,
    });
    render(
      <MemoryRouter initialEntries={['/courses/ghost-course']}>
        <AuthProvider>
          <Routes>
            <Route path="/courses/:slug" element={<CourseDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Course not found' })).toBeTruthy();
  });
});
