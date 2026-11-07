import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { useAuth } from '../auth/AuthProvider.js';
import { PageIntro, StatePanel, Stepper } from '../components/editorial.js';
import { Badge, Button, Spinner } from '../components/ui.js';
import {
  isPaystackAuthorizationUrl,
  loadPaystackInline,
  readPaystackConfig,
  redirectToPaystack,
} from '../config/paystack.js';
import { formatDate, formatPrice } from '../lib/format.js';

interface CheckoutView {
  order: {
    id: string;
    status: string;
    currency: string;
    totalAmount: string;
    expiresAt: string | null;
    createdAt: string;
  };
  course: { slug: string; title: string };
  payment: {
    id: string;
    status: string;
    provider: string;
    providerReference: string;
    amount: string;
    currency: string;
  } | null;
}

interface PaystackInitialization {
  reference: string;
  authorizationUrl: string;
  accessCode: string;
  publicKey: string;
  email: string;
  reused: boolean;
  checkout: CheckoutView;
}

interface PaystackVerification {
  status: 'processed' | 'duplicate' | 'ignored' | 'quarantined' | 'pending';
  reason?: string;
  reference: string;
  providerStatus: string;
  accessGranted: boolean;
  granted: boolean;
  enrollmentCreated: boolean;
  checkout: CheckoutView;
}

type Stage =
  | 'loading'
  | 'popup'
  | 'redirect'
  | 'verifying'
  | 'granted'
  | 'pending'
  | 'held'
  | 'error'
  | 'disabled';

/**
 * Live Paystack checkout. The server creates the order, reference and redirect
 * URL; this view only opens Paystack Inline (or falls back to a validated
 * redirect) and then asks the owner-scoped verify endpoint to fulfil access.
 */
export function PaystackCheckoutPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { status: authStatus, user } = useAuth();

  const isCallback = location.pathname.endsWith('/callback');
  const courseSlug = searchParams.get('courseSlug') ?? '';
  const reference = searchParams.get('reference') ?? searchParams.get('trxref') ?? '';

  const [initialization, setInitialization] = useState<PaystackInitialization | null>(null);
  const [verification, setVerification] = useState<PaystackVerification | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      if (authStatus === 'anonymous') {
        setStage('error');
        setError('Sign in to continue to secure checkout.');
        return;
      }

      if (isCallback) {
        if (!reference) {
          setStage('error');
          setError('The payment reference is missing from the callback.');
          return;
        }
        setStage('verifying');
        try {
          const result = await apiFetch<PaystackVerification>(
            `/api/checkout/verify/${encodeURIComponent(reference)}`,
          );
          setVerification(result);
          if (result.accessGranted) setStage('granted');
          else if (result.status === 'quarantined') setStage('held');
          else setStage('pending');
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            navigate('/login');
            return;
          }
          setStage('error');
          setError(
            err instanceof ApiError ? err.message : 'Could not verify this payment. Please try again.',
          );
        }
        return;
      }

      const config = readPaystackConfig();
      if (!courseSlug) {
        setStage('error');
        setError('No course was selected for checkout.');
        return;
      }
      if (!config.enabled) {
        setStage('disabled');
        setError('VITE_PAYSTACK_PUBLIC_KEY is not configured for this environment.');
        return;
      }

      setStage('loading');
      try {
        const init = await apiFetch<PaystackInitialization>('/api/checkout/initialize', {
          method: 'POST',
          body: JSON.stringify({ courseSlug }),
        });
        setInitialization(init);
        if (!isPaystackAuthorizationUrl(init.authorizationUrl)) {
          throw new Error('The payment provider returned an unsafe redirect URL.');
        }

        const inline = await loadPaystackInline();
        if (inline) {
          setStage('popup');
          const handler = inline.setup({
            key: config.publicKey,
            email: init.email || user?.email || '',
            access_code: init.accessCode,
            onClose: () => {
              setStage('pending');
              setError('The Paystack window closed before payment was confirmed.');
            },
            callback: (response) => {
              const returned = response.reference ?? response.trxref ?? init.reference;
              navigate(`/checkout/paystack/callback?reference=${encodeURIComponent(returned)}`);
            },
          });
          handler.openIframe();
          return;
        }

        setStage('redirect');
        redirectToPaystack(init.authorizationUrl);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          navigate('/login');
          return;
        }
        setStage('error');
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not initialize Paystack checkout. Please try again.',
        );
      }
    })();
    // `attempt` only changes when the learner explicitly retries.
  }, [authStatus, isCallback, courseSlug, reference, attempt, navigate, user?.email]);

  function retry() {
    startedRef.current = false;
    setError(null);
    setStage('loading');
    setAttempt((value) => value + 1);
  }

  const checkout = verification?.checkout ?? initialization?.checkout ?? null;
  const order = checkout?.order;
  const course = checkout?.course;
  const currentStep = stage === 'granted' || stage === 'verifying' || verification ? 3 : 2;

  let statusPanel: ReactNode;
  if (stage === 'granted') {
    statusPanel = (
      <StatePanel
        kind="confirmation"
        className="checkout-status"
        title="Access granted"
        description={
          <>
            <Badge>Payment confirmed</Badge> Paystack confirmed the charge and your enrollment is
            active. The course is now in your library.
          </>
        }
        testId="paystack-checkout-status"
      >
        <Link className="button primary" to={`/courses/${course?.slug ?? ''}`}>
          Open the course
        </Link>
        <Link className="button secondary" to="/">
          Learning Center
        </Link>
      </StatePanel>
    );
  } else if (stage === 'held') {
    statusPanel = (
      <StatePanel
        kind="quarantined"
        className="checkout-status"
        title="Payment held for review"
        description="The charge could not be matched to this order, so no access was granted. Our records have been flagged for reconciliation."
        testId="paystack-checkout-status"
      >
        <Link className="button secondary" to="/">
          Your orders
        </Link>
      </StatePanel>
    );
  } else if (stage === 'pending') {
    statusPanel = (
      <StatePanel
        kind="warning"
        className="checkout-status"
        title="Payment not confirmed"
        description="Paystack has not confirmed a successful charge for this reference. No access was granted."
        testId="paystack-checkout-status"
      >
        <Button variant="secondary" onClick={retry}>
          Check again
        </Button>
        <Link className="button ghost" to="/courses">
          Back to Course Catalog
        </Link>
      </StatePanel>
    );
  } else if (stage === 'error' || stage === 'disabled') {
    statusPanel = (
      <StatePanel
        kind="error"
        className="checkout-status"
        title={stage === 'disabled' ? 'Paystack is not configured' : 'Checkout error'}
        description={error ?? 'Could not start secure checkout.'}
        testId="paystack-checkout-status"
      >
        {stage === 'error' ? (
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        ) : null}
        <Link className="button ghost" to="/courses">
          Back to Course Catalog
        </Link>
      </StatePanel>
    );
  } else if (stage === 'popup' || stage === 'redirect') {
    statusPanel = (
      <StatePanel
        kind="confirmation"
        className="checkout-status"
        title={stage === 'popup' ? 'Opening secure checkout' : 'Redirecting to Paystack'}
        description="Complete payment in the secure Paystack window. We will verify the transaction before granting access."
        testId="paystack-checkout-status"
      >
        <Spinner label="Waiting for Paystack…" />
      </StatePanel>
    );
  } else {
    statusPanel = (
      <StatePanel
        kind="loading"
        className="checkout-status"
        title={stage === 'verifying' ? 'Verifying payment' : 'Preparing secure checkout'}
        description={
          stage === 'verifying'
            ? 'Checking the transaction with Paystack and finalizing enrollment.'
            : 'Preparing your order and secure payment reference.'
        }
        testId="paystack-checkout-status"
      >
        <Spinner label={stage === 'verifying' ? 'Verifying…' : 'Initializing…'} />
      </StatePanel>
    );
  }

  return (
    <div
      className="page checkout-page"
      data-testid="paystack-checkout-page"
      data-responsive-layout="stacked-mobile split-tablet grid-desktop"
    >
      <PageIntro
        eyebrow="Secure Checkout"
        title={isCallback ? 'Confirm your enrollment' : 'Complete your purchase'}
        lede={
          <>
            Paystack handles card and bank payment details. This site never sees them; access is
            granted only after the server verifies a successful charge.
          </>
        }
        className="checkout-hero"
        testId="paystack-checkout-hero"
        aside={
          <Stepper
            steps={['Review', 'Pay', 'Confirm']}
            current={currentStep}
            label="Checkout progress"
            testId="paystack-checkout-stepper"
          />
        }
      />

      {error && stage !== 'error' && stage !== 'disabled' ? (
        <StatePanel kind="error" title="Checkout notice" description={error} testId="paystack-checkout-notice" />
      ) : null}

      <div className="checkout-grid" data-testid="paystack-checkout-grid">
        <section className="panel checkout-summary" data-testid="paystack-checkout-summary">
          <p className="section-label">Order summary</p>
          <h2>{course?.title ?? 'Order summary'}</h2>
          <dl className="detail-grid">
            <div>
              <dt>Course</dt>
              <dd>{course?.title ?? '—'}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{order ? formatPrice(order.totalAmount, order.currency) : '—'}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd className="muted">{initialization?.reference ?? reference ?? '—'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className="capitalize">
                {verification?.checkout.order.status ?? order?.status ?? 'initializing'}
              </dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{order?.expiresAt ? formatDate(order.expiresAt) : '—'}</dd>
            </div>
          </dl>
        </section>

        {statusPanel}
      </div>
    </div>
  );
}
