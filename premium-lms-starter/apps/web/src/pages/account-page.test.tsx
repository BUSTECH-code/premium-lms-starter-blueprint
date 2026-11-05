// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider.js';
import { stubFetch } from '../test-utils/mock-fetch.js';
import { AccountPage } from './AccountPage.js';

const user = {
  id: 'u1',
  email: 'learner@example.com',
  name: 'Ada Learner',
  status: 'active',
  roles: ['student'],
  permissions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const enrollment = {
  enrollmentId: 'e1',
  course: {
    id: 'c1',
    slug: 'learning-course',
    title: 'Learning Course',
    status: 'published',
    href: '/courses/learning-course',
  },
  status: 'active',
  enrolledAt: '2026-01-02T00:00:00.000Z',
  completedAt: null,
  learning: {
    href: '/learn/learning-course',
    progressPercent: 50,
    completedLessons: 2,
    totalLessons: 4,
    completionStatus: 'in_progress',
    criteriaVersion: 1,
    gradebookAverage: 90,
    gradebookAttempts: 3,
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AccountPage learning dashboard', () => {
  it('shows server-derived progress, gradebook summary and a continue-learning link', async () => {
    stubFetch({
      '/api/auth/me': { user },
      '/api/me/enrollments': { items: [enrollment] },
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AccountPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Ada Learner' })).toBeTruthy();
    expect(screen.getByTestId('account-page').getAttribute('data-responsive-layout')).toBe(
      'stacked-mobile split-tablet grid-desktop',
    );
    expect(screen.getByTestId('dashboard-hero')).toBeTruthy();
    expect(screen.getByTestId('dashboard-stats')).toBeTruthy();
    expect(screen.getByTestId('continue-learning-card')).toBeTruthy();
    expect(screen.getByTestId('stat-active-courses').className).toContain('stat');
    expect(await screen.findByText('Learning Course')).toBeTruthy();

    const progress = screen.getByRole('progressbar', { name: 'Learning Course progress' });
    expect(progress.getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByText(/2 of 4 lessons/)).toBeTruthy();
    expect(screen.getByText('2/4')).toBeTruthy();
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0);
    expect(screen.getByText('1')).toBeTruthy(); // active courses stat

    const continueLink = screen.getByRole('link', { name: 'Continue learning' });
    expect(continueLink.getAttribute('href')).toBe('/learn/learning-course');
    expect(screen.getByText(/Certificates are deliberately not issued/)).toBeTruthy();
  });

  it('falls back gracefully when the older enrollment payload omits learning', async () => {
    stubFetch({
      '/api/auth/me': { user },
      '/api/me/enrollments': {
        items: [{ ...enrollment, learning: undefined }],
      },
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <AccountPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Ada Learner' })).toBeTruthy();
    expect(await screen.findByText('Learning Course')).toBeTruthy();
    const openLink = screen.getByRole('link', { name: 'Open course' });
    expect(openLink.getAttribute('href')).toBe('/learn/learning-course');
    expect(screen.getByRole('progressbar', { name: 'Learning Course progress' }).getAttribute('aria-valuenow')).toBe('0');
  });
});
