// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CourseCover, PageIntro, StatePanel, Stat, Stepper } from './editorial.js';
import { Alert, Badge, Button, Spinner, TextField } from './ui.js';

afterEach(() => {
  cleanup();
});

describe('Phase 4 shared design components', () => {
  it('exposes loading, disabled, validation, error, success, empty and confirmation states', () => {
    render(
      <>
        <Button loading>Saving</Button>
        <Button disabled>Disabled</Button>
        <Alert kind="error">Invalid</Alert>
        <Alert kind="success">Saved</Alert>
        <TextField label="Email" name="email" error="Required" />
        <Spinner label="Loading" />
        <Badge>New</Badge>
        <StatePanel
          kind="empty"
          title="Nothing here"
          description="Try another filter."
          testId="empty-panel"
        />
        <StatePanel
          kind="confirmation"
          title="Confirmed"
          description="Your change is saved."
          testId="confirm-panel"
        />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Saving' }).getAttribute('data-loading')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Saving' }).getAttribute('data-state')).toBe(
      'disabled',
    );
    expect(screen.getByRole('button', { name: 'Disabled' }).getAttribute('data-state')).toBe(
      'disabled',
    );
    expect(screen.getByTestId('alert-error').getAttribute('data-kind')).toBe('error');
    expect(screen.getByTestId('alert-success').getAttribute('data-kind')).toBe('success');
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Required').getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('spinner-row').getAttribute('data-state')).toBe('loading');
    expect(screen.getByTestId('badge').getAttribute('data-variant')).toBe('neutral');
    expect(screen.getByTestId('empty-panel').getAttribute('data-state')).toBe('empty');
    expect(screen.getByTestId('confirm-panel').getAttribute('data-state')).toBe('confirmation');
    expect(screen.getByTestId('confirm-panel').getAttribute('aria-live')).toBe('polite');
  });

  it('renders editorial primitives with real metadata and accessible hierarchy', () => {
    render(
      <>
        <PageIntro
          eyebrow="Course catalogue"
          title="Learn with intent"
          lede="Browse published courses."
          testId="intro"
          aside={
            <CourseCover
              title="Node at Scale"
              category="Engineering"
              index={1}
              testId="cover"
            />
          }
        />
        <Stepper
          steps={['Review', 'Pay', 'Access']}
          current={2}
          label="Checkout progress"
          testId="stepper"
        />
        <Stat label="Active courses" value={1} hint="In progress" testId="stat" />
      </>,
    );

    expect(screen.getByRole('heading', { name: 'Learn with intent' })).toBeTruthy();
    expect(screen.getByTestId('intro').className).toContain('page-intro');
    expect(String(screen.getByTestId('cover').textContent)).toContain('Engineering');
    expect(String(screen.getByTestId('cover').textContent)).toContain('Premium Academy');
    expect(screen.getByTestId('cover').getAttribute('aria-hidden')).toBe('true');
    const currentStep = screen.getByTestId('stepper').querySelector('[data-state="current"]');
    expect(String(currentStep?.textContent)).toContain('Pay');
    expect(screen.getByTestId('stepper').querySelector('[aria-current="step"]')).toBeTruthy();
    expect(String(screen.getByTestId('stat').textContent)).toContain('Active courses');
    expect(String(screen.getByTestId('stat').textContent)).toContain('1');
  });
});
