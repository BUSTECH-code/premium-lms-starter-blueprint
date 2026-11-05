// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider.js';
import { jsonRequest, stubFetch } from '../test-utils/mock-fetch.js';
import { SimulatedCheckoutPage } from './SimulatedCheckoutPage.js';

const student = {
  id: 'u2',
  email: 'learner@example.com',
  name: 'Learner',
  status: 'active',
  roles: ['student'],
  permissions: [],
};

const openSession = {
  checkout: {
    order: {
      id: 'order-1',
      status: 'created',
      currency: 'NGN',
      totalAmount: '25000.00',
      expiresAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2026-11-05T00:00:00.000Z',
    },
    course: { slug: 'journey-course', title: 'Journey Course' },
    payment: {
      id: 'pay-1',
      status: 'initiated',
      provider: 'simulated',
      providerReference: 'simulated_abc12345',
      amount: '25000.00',
      currency: 'NGN',
    },
  },
  expired: false,
  payable: true,
};

const paidResult = {
  event: { id: 'evt_1', type: 'payment.succeeded' },
  status: 'processed',
  granted: true,
  enrollmentCreated: true,
  checkout: {
    ...openSession.checkout,
    order: { ...openSession.checkout.order, status: 'paid' },
    payment: { ...openSession.checkout.payment, status: 'succeeded' },
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCheckout() {
  return render(
    <MemoryRouter initialEntries={['/checkout/simulated/simulated_abc12345']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/checkout/simulated/:reference"
            element={<SimulatedCheckoutPage />}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('SimulatedCheckoutPage', () => {
  it('renders the order summary and both simulated payment outcomes', async () => {
    stubFetch({
      '/api/auth/me': { user: student },
      '/api/simulated/checkout/': openSession,
    });
    renderCheckout();

    expect(await screen.findByRole('heading', { name: 'Journey Course' })).toBeTruthy();
    expect(screen.getByText(/25,000/)).toBeTruthy();
    expect(screen.getByText(/simulated payment provider/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Simulate successful payment' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Simulate failed payment' })).toBeTruthy();
  });

  it('grants access after a successful simulated payment', async () => {
    const fetchMock = stubFetch({
      '/api/auth/me': { user: student },
      '/api/simulated/checkout/simulated_abc12345/complete': paidResult,
      '/api/simulated/checkout/': openSession,
    });
    renderCheckout();

    const payButton = await screen.findByRole('button', { name: 'Simulate successful payment' });
    fireEvent.click(payButton);

    expect(await screen.findByRole('heading', { name: 'Access granted' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the course' })).toHaveProperty(
      'href',
      expect.stringContaining('/courses/journey-course'),
    );

    const completeCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/complete'),
    );
    expect(completeCall).toBeTruthy();
    expect(jsonRequest(completeCall?.[1])).toEqual({ outcome: 'success' });
  });

  it('shows a failed state with retry when the simulated payment fails', async () => {
    stubFetch({
      '/api/auth/me': { user: student },
      '/api/simulated/checkout/simulated_abc12345/complete': {
        event: { id: 'evt_2', type: 'payment.failed' },
        status: 'processed',
        granted: false,
        enrollmentCreated: false,
        checkout: {
          ...openSession.checkout,
          order: { ...openSession.checkout.order, status: 'failed' },
          payment: { ...openSession.checkout.payment, status: 'failed' },
        },
      },
      '/api/simulated/checkout/': openSession,
    });
    renderCheckout();

    fireEvent.click(await screen.findByRole('button', { name: 'Simulate failed payment' }));

    expect(await screen.findByRole('heading', { name: 'Payment failed' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Retry with a successful payment' }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Access granted' })).toBeNull();
  });

  it('reports a quarantined payment as held for review without granting access', async () => {
    stubFetch({
      '/api/auth/me': { user: student },
      '/api/simulated/checkout/simulated_abc12345/complete': {
        event: { id: 'evt_3', type: 'payment.succeeded' },
        status: 'quarantined',
        reason: 'amount_mismatch',
        granted: false,
        enrollmentCreated: false,
        checkout: openSession.checkout,
      },
      '/api/simulated/checkout/': openSession,
    });
    renderCheckout();

    fireEvent.click(await screen.findByRole('button', { name: 'Simulate successful payment' }));

    expect(await screen.findByRole('heading', { name: 'Payment held for review' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Access granted' })).toBeNull();
  });

  it('shows a not-found state for unknown checkout references', async () => {
    stubFetch({
      '/api/auth/me': { user: student },
      '/api/simulated/checkout/': undefined,
    });
    renderCheckout();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Checkout session not found' })).toBeTruthy();
    });
  });
});
