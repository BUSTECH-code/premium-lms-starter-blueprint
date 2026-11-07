import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { PageIntro, StatePanel, Stepper } from '../components/editorial.js';
import { Badge, Button, Spinner } from '../components/ui.js';
import { formatDate, formatPrice } from '../lib/format.js';

interface CheckoutSession {
  checkout: {
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
  };
  expired: boolean;
  payable: boolean;
}

interface CompletionResult {
  event: { id: string | null; type: string } | null;
  status: 'processed' | 'duplicate' | 'ignored' | 'quarantined';
  reason?: string;
  granted: boolean;
  enrollmentCreated: boolean;
  checkout: CheckoutSession['checkout'];
}

/**
 * Preview checkout remains the local development fallback. Paystack is the
 * confirmed live provider; this page still runs every payment through the
 * signed, idempotent verification workflow — there is no shortcut to access.
 */
export function SimulatedCheckoutPage() {
  const { reference = '' } = useParams();
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [result, setResult] = useState<CompletionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const data = await apiFetch<CheckoutSession>(`/api/checkout/preview/${reference}`);
      setSession(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Could not load this checkout.');
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    void load();
  }, [load]);

  async function complete(outcome: 'success' | 'failure') {
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiFetch<CompletionResult>(
        `/api/checkout/preview/${reference}/complete`,
        { method: 'POST', body: JSON.stringify({ outcome }) },
      );
      setResult(data);
      setSession((current) =>
        current ? { ...current, checkout: data.checkout, payable: false } : current,
      );
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Could not reach the payment provider.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="page" data-testid="checkout-loading">
        <StatePanel
          kind="loading"
          title="Loading checkout"
          description="Checking your order and payment status."
          testId="checkout-loading-state"
        >
          <Spinner label="Loading checkout…" />
        </StatePanel>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="full-page-state" data-testid="checkout-not-found-page">
        <StatePanel
          kind="error"
          title="Checkout session not found"
          description="This checkout does not exist or belongs to another account."
          testId="checkout-not-found-state"
        >
          <Link className="button secondary" to="/courses">
            Back to Course Catalog
          </Link>
        </StatePanel>
      </div>
    );
  }

  const order = session?.checkout.order;
  const course = session?.checkout.course;
  const paid =
    result?.granted === true ||
    order?.status === 'paid' ||
    result?.reason === 'already_paid';
  const failedNow = result?.status === 'processed' && result.event?.type === 'payment.failed';
  const quarantined = result?.status === 'quarantined';
  const payable = !paid && !failedNow && !quarantined && (session?.payable ?? false);
  const currentStep = paid ? 3 : failedNow || quarantined || payable ? 2 : 1;

  return (
    <div
      className="page checkout-page"
      data-testid="checkout-page"
      data-responsive-layout="stacked-mobile split-tablet grid-desktop"
    >
      <PageIntro
        eyebrow="Secure Checkout"
        title="Secure Checkout"
        lede={
          <>
            This is a safe checkout preview. No payment is charged. Access is confirmed only after
            secure payment verification.
          </>
        }
        className="checkout-hero"
        testId="checkout-hero"
        aside={
          <Stepper
            steps={['Review', 'Pay', 'Access']}
            current={currentStep}
            label="Checkout progress"
            testId="checkout-stepper"
          />
        }
      />

      {error ? (
        <StatePanel
          kind="error"
          title="Checkout error"
          description={error}
          testId="checkout-error-state"
        />
      ) : null}

      <div className="checkout-grid" data-testid="checkout-grid">
        <section className="panel checkout-summary" data-testid="checkout-summary">
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
              <dt>Order</dt>
              <dd className="muted">{order?.id ?? '—'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className="capitalize">
                {result ? result.checkout.order.status : order?.status}
              </dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{order?.expiresAt ? formatDate(order.expiresAt) : '—'}</dd>
            </div>
          </dl>
        </section>

        {paid ? (
          <StatePanel
            kind="confirmation"
            className="checkout-status"
            title="Access granted"
            description={
              <>
                <Badge>Payment confirmed</Badge> Your payment was verified and your enrollment was
                created. The course is now in your Learning Center.
              </>
            }
            testId="checkout-status"
          >
            <Link className="button primary" to={`/courses/${course?.slug ?? ''}`}>
              Open the course
            </Link>
            <Link className="button secondary" to="/">
              Learning Center
            </Link>
          </StatePanel>
        ) : quarantined ? (
          <StatePanel
            kind="quarantined"
            className="checkout-status"
            title="Payment held for review"
            description="The payment could not be verified against our records, so no access was granted. This order needs manual review — no money was applied to your account."
            testId="checkout-status"
          >
            <Link className="button secondary" to="/">
              Learning Center
            </Link>
            <Link className="button ghost" to="/courses">
              Back to Course Catalog
            </Link>
          </StatePanel>
        ) : failedNow ? (
          <StatePanel
            kind="error"
            className="checkout-status"
            title="Payment declined"
            description="The payment was declined. No access was granted — you can try again below."
            testId="checkout-status"
          >
            <Button loading={submitting} onClick={() => void complete('success')}>
              Try a successful payment again
            </Button>
            <Link className="button ghost" to="/courses">
              Abandon checkout
            </Link>
          </StatePanel>
        ) : session?.expired || order?.status === 'cancelled' ? (
          <StatePanel
            kind="expired"
            className="checkout-status"
            title="Checkout expired"
            description="This checkout is no longer payable. Start again from the Course Catalog — nothing was charged."
            testId="checkout-status"
          >
            <Link className="button secondary" to="/courses">
              Back to Course Catalog
            </Link>
          </StatePanel>
        ) : payable ? (
          <StatePanel
            kind="confirmation"
            className="checkout-status"
            title="Complete your payment"
            description="Choose an outcome to confirm access: successful payments grant access; declined payments do not."
            testId="checkout-status"
          >
            <Button loading={submitting} onClick={() => void complete('success')}>
              Confirm successful payment
            </Button>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => void complete('failure')}
            >
              Decline payment
            </Button>
          </StatePanel>
        ) : (
          <StatePanel
            kind="disabled"
            className="checkout-status"
            title={`Order ${order?.status ?? ''}`}
            description="This checkout is not payable right now."
            testId="checkout-status"
          >
            <Link className="button secondary" to="/">
              Learning Center
            </Link>
          </StatePanel>
        )}
      </div>
    </div>
  );
}
