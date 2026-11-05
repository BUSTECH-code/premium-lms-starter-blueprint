import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/** Shared, accessible UI primitives (loading/error/disabled states included). */

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-row">
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="muted">{label}</span> : null}
    </span>
  );
}

export function Alert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'success';
  children: ReactNode;
}) {
  return (
    <p className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

export function Button({
  variant = 'primary',
  loading = false,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
}) {
  return (
    <button
      className={`button ${variant}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextField({ label, error, id, ...rest }: TextFieldProps) {
  const fieldId = id ?? rest.name;
  const errorId = fieldId ? `${fieldId}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
