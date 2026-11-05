// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CatalogPage } from './CatalogPage.js';
import { stubFetch } from '../test-utils/mock-fetch.js';

const courseItem = {
  id: 'c1',
  slug: 'node-at-scale',
  href: '/courses/node-at-scale',
  title: 'Node at Scale',
  summary: 'Design resilient services.',
  price: { amount: '45000.00', currency: 'NGN' },
  tags: ['node', 'backend'],
  instructor: { name: 'Ada Instructor' },
  categories: [{ slug: 'engineering', name: 'Engineering' }],
  moduleCount: 2,
  lessonCount: 6,
  totalDurationSeconds: '3600',
  publishedAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CatalogPage', () => {
  it('renders published courses as editorial rows with price and meta', async () => {
    stubFetch({
      '/api/categories': { items: [{ slug: 'engineering', name: 'Engineering', courseCount: 1 }] },
      '/api/courses': { items: [courseItem], total: 1 },
    });

    render(
      <MemoryRouter initialEntries={['/courses']}>
        <Routes>
          <Route path="/courses" element={<CatalogPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Node at Scale')).toBeTruthy();
    expect(screen.getByTestId('catalog-page').getAttribute('data-responsive-layout')).toBe(
      'stacked-mobile split-tablet grid-desktop',
    );
    expect(screen.getByTestId('catalog-hero')).toBeTruthy();
    expect(screen.getByTestId('catalogue-filters')).toBeTruthy();
    expect(screen.getByTestId('featured-course')).toBeTruthy();
    expect(screen.getByTestId('featured-course-cover')).toBeTruthy();
    expect(screen.getByText('Ada Instructor · 2 modules · 6 lessons · 1h')).toBeTruthy();
    expect(screen.getByText(/45,000/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View course' })).toHaveProperty(
      'href',
      expect.stringContaining('/courses/node-at-scale'),
    );
    // Categories filter chips come from the taxonomy endpoint.
    expect(screen.getByRole('button', { name: /Engineering/ })).toBeTruthy();
  });

  it('submits the search filter to the API', async () => {
    const fetchMock = stubFetch({
      '/api/categories': { items: [] },
      '/api/courses': { items: [courseItem], total: 1 },
    });

    render(
      <MemoryRouter initialEntries={['/courses']}>
        <Routes>
          <Route path="/courses" element={<CatalogPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Node at Scale');

    fireEvent.change(screen.getByLabelText('Search courses'), { target: { value: 'node' } });
    fireEvent.submit(screen.getByRole('search'));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes('search=node'))).toBe(true);
    });
  });

  it('shows an empty state when nothing matches', async () => {
    stubFetch({
      '/api/categories': { items: [] },
      '/api/courses': { items: [], total: 0 },
    });

    render(
      <MemoryRouter initialEntries={['/courses']}>
        <Routes>
          <Route path="/courses" element={<CatalogPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/No published courses match/)).toBeTruthy();
    expect(screen.getByTestId('catalog-empty-state').getAttribute('data-state')).toBe('empty');
  });
});
