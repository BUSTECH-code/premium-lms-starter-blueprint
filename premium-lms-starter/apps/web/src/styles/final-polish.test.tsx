// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../App.js';
import { AuthProvider } from '../auth/AuthProvider.js';
import { ANONYMOUS_ME, stubFetch } from '../test-utils/mock-fetch.js';

const srcRoot = resolve(process.cwd(), 'apps/web/src');
const read = (relativePath: string): string =>
  readFileSync(join(srcRoot, relativePath), 'utf8');

const BANNED =
  /\b(?:blueprint|phase|according to spec|simulated|pglite|seed data|mock|catalogue|prototype|fixture)\b/i;

const STRING_LITERAL = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function isTechnical(value: string): boolean {
  const text = value.trim();
  if (/^[./]/.test(text)) return true;
  if (/\.(?:js|ts|tsx|css|html|svg|png|jpe?g)$/i.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[A-Z0-9_]+$/.test(text)) return true;
  if (/^[a-z0-9_.:/${}()+=#,%?@-]+$/.test(text)) return true;
  if (/^[a-z0-9\s-]+$/.test(text) && text.includes('-')) return true;
  if (/\b(?:SIMULATED|PAYSTACK|VITE|ALLOW|DB)_[A-Z0-9_]+\b/.test(text)) return true;
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|VALUES)\b/i.test(text)) return true;
  return false;
}

function userFacingStrings(source: string): string[] {
  const withoutComments = stripComments(source);
  const values: string[] = [];
  for (const match of withoutComments.matchAll(STRING_LITERAL)) {
    values.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  for (const match of withoutComments.matchAll(/>([^<>{}]+)</g)) {
    values.push(match[1] ?? '');
  }
  return values
    .map((value) => value.replace(/\$\{[^}]*\}/g, '').trim())
    .filter((value) => /[A-Za-z]/.test(value) && value.length > 2)
    .filter((value) => !isTechnical(value));
}

function collectTsx(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTsx(full));
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) files.push(full);
  }
  return files;
}

function accessibleName(element: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
  }
  const id = element.getAttribute('id');
  if (id) {
    const label = document.querySelector<HTMLElement>(`label[for="${id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  return element.textContent?.trim() ?? '';
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const raw = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

function tokenColor(tokens: string, name: string): string {
  const match = tokens.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6});`));
  if (!match?.[1]) throw new Error(`Missing --color-${name} token`);
  return match[1];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('commercial product language', () => {
  const sources = collectTsx(srcRoot);

  it('finds the production React views', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  for (const file of sources) {
    const label = relative(srcRoot, file).replaceAll('\\', '/');
    it(`${label} uses commercial, jargon-free copy`, () => {
      const offenders = userFacingStrings(readFileSync(file, 'utf8')).filter((value) =>
        BANNED.test(value),
      );
      expect(offenders).toEqual([]);
    });
  }

  it('keeps the document title and meta description free of implementation jargon', () => {
    const html = readFileSync(resolve(srcRoot, '../index.html'), 'utf8');
    const offenders = userFacingStrings(html).filter((value) => BANNED.test(value));
    expect(offenders).toEqual([]);
  });

  it('uses the commercial checkout route and preview API prefix', () => {
    const app = read('App.tsx');
    const checkout = read('pages/SimulatedCheckoutPage.tsx');
    expect(app).toContain('path="/checkout/preview/:reference"');
    expect(app).not.toContain('/checkout/simulated/');
    expect(checkout).toContain('/api/checkout/preview/');
    expect(checkout).not.toContain('/api/simulated/checkout/');
  });
});

describe('design system, responsive and accessibility guarantees', () => {
  const tokens = read('styles/tokens.css');
  const appCss = read('styles/app.css');
  const phase4Css = read('styles/phase4.css');

  it('keeps every confirmed text/background pair above the 4.5:1 WCAG AA threshold', () => {
    const pairs: Array<[string, string]> = [
      ['ink', 'paper'],
      ['ink-soft', 'paper'],
      ['ink-soft', 'surface'],
      ['accent', 'paper'],
      ['on-accent', 'accent'],
      ['on-accent', 'accent-strong'],
      ['danger', 'danger-bg'],
      ['success', 'success-bg'],
      ['focus', 'paper'],
      ['ink', 'paper-strong'],
    ];
    for (const [foreground, background] of pairs) {
      const ratio = contrast(tokenColor(tokens, foreground), tokenColor(tokens, background));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses typography and spacing tokens rather than raw values in shared CSS', () => {
    expect(appCss).toContain('font-family: var(--font-body);');
    expect(appCss).toContain('font-family: var(--font-display);');
    expect(phase4Css).toContain('font-family: var(--font-display);');
    expect(appCss).toContain('var(--space-');
    expect(phase4Css).toContain('var(--space-');
    expect(appCss).toContain(':focus-visible');
    expect(appCss).toContain('outline: 2px solid var(--color-focus);');
  });

  it('reconciles legacy breakpoints with the five confirmed responsive bands', () => {
    expect(appCss).not.toMatch(/@media \(max-width: (?:720px|52rem|60rem|40rem)\)/);
    expect(appCss).toContain('@media (max-width: 899px)');
    expect(appCss).toContain('@media (max-width: 639px)');
    expect(phase4Css).toContain('@media (max-width: 639px)');
    expect(phase4Css).toContain('@media (min-width: 640px) and (max-width: 899px)');
    expect(phase4Css).toContain('@media (min-width: 900px) and (max-width: 1199px)');
    expect(phase4Css).toContain('@media (min-width: 1200px)');
    expect(phase4Css).toContain('@media (min-width: 1600px)');
    expect(phase4Css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('marks every confirmed view with the shared responsive layout contract', () => {
    const views = [
      'pages/CatalogPage.tsx',
      'pages/CourseDetailPage.tsx',
      'pages/SimulatedCheckoutPage.tsx',
      'pages/PaystackCheckoutPage.tsx',
      'pages/AccountPage.tsx',
      'learning/CoursePlayerPage.tsx',
    ];
    for (const view of views) {
      expect(read(view)).toContain(
        'data-responsive-layout="stacked-mobile split-tablet grid-desktop"',
      );
    }
  });

  it('exposes landmarks, a first-focus skip link, accessible names and keyboard reachability', async () => {
    stubFetch({
      '/api/auth/me': ANONYMOUS_ME,
      '/api/categories': { items: [] },
      '/api/courses': { items: [], total: 0 },
    });

    render(
      <MemoryRouter initialEntries={['/courses']}>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('main')).toBeTruthy());
    expect(screen.getByTestId('app-header').getAttribute('role')).toBe('banner');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByTestId('app-footer').getAttribute('role')).toBe('contentinfo');
    expect(document.getElementById('main-content')?.tagName).toBe('MAIN');

    const skipLink = screen.getByRole('link', { name: /skip to main content/i });
    expect(skipLink.getAttribute('href')).toBe('#main-content');

    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    );
    expect(focusable[0]).toBe(skipLink);
    expect(focusable.every((element) => element.getAttribute('tabindex') !== '-1')).toBe(true);
    for (const element of focusable) {
      expect(accessibleName(element).length).toBeGreaterThan(0);
    }
  });
});
