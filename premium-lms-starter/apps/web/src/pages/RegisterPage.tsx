import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { ApiError } from '../auth/api.js';
import { Alert, Button, TextField } from '../components/ui.js';

function firstFieldError(details: unknown): string | null {
  if (Array.isArray(details) && details.length > 0) {
    const first = details[0] as { path?: string; message?: string };
    if (first?.message) return first.message;
  }
  return null;
}

export function RegisterPage() {
  const { status, register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(name.trim(), email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(firstFieldError(err.details) ?? err.message);
      } else {
        setError('Unable to create your account right now. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <div className="panel auth-card">
        <p className="eyebrow">Start learning</p>
        <h1>Create your account</h1>
        <p className="muted">A student account is created for you by default.</p>

        <form onSubmit={handleSubmit} noValidate>
          {error ? <Alert>{error}</Alert> : null}

          <TextField
            label="Full name"
            name="name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
          />
          <TextField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />

          <Button type="submit" loading={submitting}>
            Create account
          </Button>
        </form>

        <p className="muted auth-switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
