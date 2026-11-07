// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider.js';
import {
  loadPaystackInline,
  type PaystackInlineApi,
  type PaystackInlineOptions,
} from '../config/paystack.js';
import { jsonRequest, stubFetch } from '../test-utils/mock-fetch.js';
import { PaystackCheckoutPage } from './PaystackCheckoutPage.js';

vi.mock('../config/paystack.js', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('../config/paystack.js');
  return { ...actual, loadPaystackInline: vi.fn() };
});

const student = {
  id: 'u2',
  email: 'learner@example.com',
  name: 'Learner',
  status: 'active',
  roles: ['student'],
  permissions: [],
};

const checkoutView = {
  order: {
    id: 'order-1',
    status: 'payment_pending',
    currency: 'NGN',
    totalAmount: '25000.00',
    expiresAt: '2030-01-01T00:00:00.000Z',
    createdAt: '2026-11-06T00:00:00.000Z',
  },
  course: { slug: 'node-at-scale', title: 'Node at Scale' },
  payment: {
    id: 'pay-1',
    status: 'pending',
    provider: 'paystack',
    providerReference: 'paystack_ref_12345',
    amount: '25000.00',
    currency: 'NGN',
  },
};

const initialization = {
  reference: 'paystack_ref_12345',
  authorizationUrl: 'https://checkout.paystack.com/paystack_ref_12345',
  accessCode: 'access_paystack_ref_12345',
  publicKey: 'pk_test_lms_unit_test_public_key',
  email: 'learner@example.com',
  reused: false,
  checkout: checkoutView,
};

const granted = {
  status: 'processed',
  reference: 'paystack_ref_12345',
  providerStatus: 'success',
  accessGranted: true,
  granted: true,
  enrollmentCreated: true,
  checkout: {
    ...checkoutView,
    order: { ...checkoutView.order, status: 'paid' },
    payment: { ...checkoutView.payment, status: 'succeeded' },
  },
};

const held = {
  status: 'quarantined',
  reason: 'amount_mismatch',
  reference: 'paystack_ref_12345',
  providerStatus: 'success',
  accessGranted: false,
  granted: false,
  enrollmentCreated: false,
  checkout: checkoutView,
};

function renderPaystack(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/checkout/paystack" element={<PaystackCheckoutPage />} />
          <Route path="/checkout/paystack/callback" element={<PaystackCheckoutPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(loadPaystackInline).mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PaystackCheckoutPage', () => {
  it('dynamically initializes a transaction and opens the Paystack popup', async () => {
    const openIframe = vi.fn();
    const setup = vi.fn((_options: PaystackInlineOptions) => ({ openIframe }));
    const inlineApi: PaystackInlineApi = { setup };
    vi.mocked(loadPaystackInline).mockResolvedValue(inlineApi);

    const fetchMock = stubFetch({
      '/api/auth/me': { user: student },
      '/api/checkout/initialize': initialization,
    });
    renderPaystack('/checkout/paystack?courseSlug=node-at-scale');

    expect(await screen.findByRole('heading', { name: 'Opening secure checkout' })).toBeTruthy();
    expect(
      screen.getByTestId('paystack-checkout-page').getAttribute('data-responsive-layout'),
    ).toBe('stacked-mobile split-tablet grid-desktop');
    expect(screen.getByTestId('paystack-checkout-stepper')).toBeTruthy();
    expect(screen.getByTestId('paystack-checkout-summary')).toBeTruthy();
    expect(screen.getByText(/25,000/)).toBeTruthy();
    expect(screen.getByTestId('paystack-checkout-status').getAttribute('data-state')).toBe(
      'confirmation',
    );

    expect(setup).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'pk_test_lms_unit_test_public_key',
        email: 'learner@example.com',
        access_code: 'access_paystack_ref_12345',
      }),
    );
    expect(openIframe).toHaveBeenCalledTimes(1);

    const initializeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/checkout/initialize'),
    );
    expect(initializeCall).toBeTruthy();
    expect(jsonRequest(initializeCall?.[1])).toEqual({ courseSlug: 'node-at-scale' });
  });

  it('falls back to a validated Paystack redirect when inline checkout is unavailable', async () => {
    vi.mocked(loadPaystackInline).mockResolvedValue(null);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    stubFetch({
      '/api/auth/me': { user: student },
      '/api/checkout/initialize': initialization,
    });

    renderPaystack('/checkout/paystack?courseSlug=node-at-scale');

    expect(await screen.findByRole('heading', { name: 'Redirecting to Paystack' })).toBeTruthy();
    expect(open).toHaveBeenCalledWith(
      'https://checkout.paystack.com/paystack_ref_12345',
      '_self',
    );
  });

  it('verifies the frontend callback and confirms granted access', async () => {
    vi.mocked(loadPaystackInline).mockResolvedValue(null);
    stubFetch({
      '/api/auth/me': { user: student },
      '/api/checkout/verify/paystack_ref_12345': granted,
    });

    renderPaystack('/checkout/paystack/callback?reference=paystack_ref_12345');

    expect(await screen.findByRole('heading', { name: 'Access granted' })).toBeTruthy();
    expect(screen.getByTestId('paystack-checkout-status').getAttribute('data-state')).toBe(
      'confirmation',
    );
    expect(screen.getByRole('link', { name: 'Open the course' })).toHaveProperty(
      'href',
      expect.stringContaining('/courses/node-at-scale'),
    );
  });

  it('does not claim access when callback verification is quarantined', async () => {
    vi.mocked(loadPaystackInline).mockResolvedValue(null);
    stubFetch({
      '/api/auth/me': { user: student },
      '/api/checkout/verify/paystack_ref_12345': held,
    });

    renderPaystack('/checkout/paystack/callback?reference=paystack_ref_12345');

    expect(await screen.findByRole('heading', { name: 'Payment held for review' })).toBeTruthy();
    expect(screen.getByTestId('paystack-checkout-status').getAttribute('data-state')).toBe(
      'quarantined',
    );
    expect(screen.queryByRole('heading', { name: 'Access granted' })).toBeNull();
  });
});
