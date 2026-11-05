import type { ReactNode } from 'react';

type PageIntroProps = {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  aside?: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
  titleId?: string;
};

/**
 * Shared editorial page header. Keeps hierarchy, measure and spacing consistent
 * across Catalogue, Detail, Checkout, Account and Player.
 */
export function PageIntro({
  eyebrow,
  title,
  lede,
  aside,
  actions,
  className = '',
  testId,
  titleId,
}: PageIntroProps) {
  return (
    <header className={`page-intro ${className}`.trim()} data-testid={testId}>
      <div className="page-intro-grid">
        <div className="page-intro-copy">
          <p className="page-kicker">{eyebrow}</p>
          <h1 className="display-title" id={titleId}>
            {title}
          </h1>
          <p className="page-lede">{lede}</p>
          {actions ? <div className="page-actions">{actions}</div> : null}
        </div>
        {aside ? <div className="page-intro-aside">{aside}</div> : null}
      </div>
    </header>
  );
}

type CourseCoverProps = {
  title: string;
  category: string;
  index: number;
  compact?: boolean;
  testId?: string;
};

/** Typographic cover built from real course metadata; no borrowed artwork. */
export function CourseCover({ title, category, index, compact = false, testId }: CourseCoverProps) {
  return (
    <div
      className={`course-cover${compact ? ' compact' : ''}`}
      data-testid={testId ?? 'course-cover'}
      aria-hidden="true"
    >
      <span className="course-cover-index">{String(index).padStart(2, '0')}</span>
      <span className="course-cover-initial">{title.slice(0, 1).toUpperCase()}</span>
      <span className="course-cover-category">{category}</span>
      <span className="course-cover-brand">Premium Academy</span>
    </div>
  );
}

type StepperProps = {
  steps: readonly string[];
  current: number;
  label: string;
  testId?: string;
};

/** current is 1-based; earlier steps are complete and later steps are upcoming. */
export function Stepper({ steps, current, label, testId }: StepperProps) {
  return (
    <ol className="stepper" aria-label={label} data-testid={testId ?? 'stepper'}>
      {steps.map((step, index) => {
        const position = index + 1;
        const state = position < current ? 'complete' : position === current ? 'current' : 'upcoming';
        return (
          <li
            key={step}
            className="stepper-step"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="stepper-number">{String(position).padStart(2, '0')}</span>
            <span>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

type StatProps = {
  label: string;
  value: string | number;
  hint?: string;
  testId?: string;
};

export function Stat({ label, value, hint, testId }: StatProps) {
  return (
    <div className="stat" data-testid={testId}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

export type EditorialStateKind =
  | 'loading'
  | 'empty'
  | 'error'
  | 'success'
  | 'disabled'
  | 'validation'
  | 'confirmation'
  | 'warning'
  | 'quarantined'
  | 'expired';

type StatePanelProps = {
  kind: EditorialStateKind;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
};

/** One accessible treatment for loading/empty/error/success/disabled/confirmation states. */
export function StatePanel({
  kind,
  title,
  description,
  children,
  className = '',
  testId,
}: StatePanelProps) {
  const isAssertive = kind === 'error' || kind === 'validation';
  return (
    <section
      className={`state-panel ${className}`.trim()}
      data-state={kind}
      data-testid={testId}
      role={isAssertive ? 'alert' : 'status'}
      aria-live={isAssertive ? 'assertive' : 'polite'}
      aria-busy={kind === 'loading' ? 'true' : undefined}
    >
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children ? <div className="state-action-row">{children}</div> : null}
    </section>
  );
}
