import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../auth/api.js';
import { Alert, Badge, Button, Spinner } from '../components/ui.js';
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
 * Simulated checkout for the development payment provider (the real gateway
 * decision is open — O-05). Every "payment" builds a signed provider event
 * that runs through the production webhook pipeline — there is no shortcut
 * to access.
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
      const data = await apiFetch<CheckoutSession>(`/api/simulated/checkout/${reference}`);
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
        `/api/simulated/checkout/${reference}/complete`,
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
      <div className="page">
        <div className="spinner-row" aria-live="polite">
          <Spinner label="Loading checkout…" />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="full-page-state">
        <div className="panel narrow">
          <p className="eyebrow">Checkout</p>
          <h1>Checkout session not found</h1>
          <p className="muted">This checkout does not exist or belongs to another account.</p>
          <Link className="button secondary" to="/courses">
            Back to catalogue
          </Link>
        </div>
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

  return (
    <div className="page checkout-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Checkout · simulated gateway</p>
          <h1>{course?.title ?? 'Order summary'}</h1>
          <p className="muted lede">
            This environment uses a <strong>simulated payment provider</strong> — no real money
            moves. The confirmation still travels through the signed webhook pipeline that a real
            gateway would use.
          </p>
        </div>
      </header>

      {error ? <Alert>{error}</Alert> : null}

      <section className="panel checkout-summary">
        <dl className="detail-grid">
          <div>
            <dt>Course</dt>
            <dd>{course?.title ?? '—'}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>
              {order ? formatPrice(order.totalAmount, order.currency) : '—'}
            </dd>
          </div>
          <div>
            <dt>Order</dt>
            <dd className="muted">{order?.id ?? '—'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className="capitalize">{result ? result.checkout.order.status : order?.status}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{order?.expiresAt ? formatDate(order.expiresAt) : '—'}</dd>
          </div>
        </dl>
      </section>

      {paid ? (
        <section className="panel success-panel" role="status">
          <Badge>Payment confirmed</Badge>
          <h2>Access granted</h2>
          <p className="muted">
            Your payment was verified and your enrolment was created. The course is now in your
            library.
          </p>
          <div className="button-row">
            <Link className="button primary" to={`/courses/${course?.slug ?? ''}`}>
              Open the course
            </Link>
            <Link className="button secondary" to="/">
              Your courses
            </Link>
          </div>
        </section>
      ) : quarantined ? (
        <section className="panel" role="status">
          <h2>Payment held for review</h2>
          <p className="muted">
            The payment could not be verified against our records, so no access was granted. This
            order needs manual review — no money was applied to your account.
          </p>
          <div className="button-row">
            <Link className="button secondary" to="/">
              Your orders
            </Link>
            <Link className="button ghost" to="/courses">
              Back to catalogue
            </Link>
          </div>
        </section>
      ) : failedNow ? (
        <section className="panel" role="status">
          <h2>Payment failed</h2>
          <p className="muted">
            The simulated gateway declined this payment. No access was granted — you can retry
            below.
          </p>
          <div className="button-row">
            <Button loading={submitting} onClick={() => void complete('success')}>
              Retry with a successful payment
            </Button>
            <Link className="button ghost" to="/courses">
              Abandon checkout
            </Link>
          </div>
        </section>
      ) : session?.expired || order?.status === 'cancelled' ? (
        <section className="panel" role="status">
          <h2>Checkout expired</h2>
          <p className="muted">
            This checkout is no longer payable. Start again from the catalogue — nothing was
            charged.
          </p>
          <Link className="button secondary" to="/courses">
            Back to catalogue
          </Link>
        </section>
      ) : payable ? (
        <section className="panel checkout-actions">
          <h2>Complete your payment</h2>
          <div className="button-row">
            <Button loading={submitting} onClick={() => void complete('success')}>
              Simulate successful payment
            </Button>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => void complete('failure')}
            >
              Simulate failed payment
            </Button>
          </div>
          <p className="muted small-print">
            Both outcomes exercise the real webhook pipeline: success grants access, failure does
            not.
          </p>
        </section>
      ) : (
        <section className="panel" role="status">
          <h2>Order {order?.status ?? ''}</h2>
          <p className="muted">This checkout is not payable right now.</p>
          <Link className="button secondary" to="/">
            Your orders
          </Link>
        </section>
      )}
    </div>
  );
}
