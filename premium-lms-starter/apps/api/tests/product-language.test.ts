import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
const read = (relativePath: string): string =>
  readFileSync(join(srcRoot, relativePath), 'utf8');

const BANNED =
  /\b(?:blueprint|phase|according to spec|simulated|pglite|seed data|mock|catalogue|prototype|fixture)\b/i;

const STRING_LITERAL = /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;

const EXCLUDED = new Set([
  'config/env.ts',
  'payments/provider.ts',
  'payments/paystack.ts',
]);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function isTechnical(value: string): boolean {
  const text = value.trim();
  if (/^[./]/.test(text)) return true;
  if (/\.(?:js|ts|tsx|css|html|svg|png|jpe?g|mp4|pdf)$/i.test(text)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^[A-Z0-9_]+$/.test(text)) return true;
  if (/^[a-z0-9_.:/${}()+=#,%?@-]+$/.test(text)) return true;
  if (/^[a-z0-9\s-]+$/.test(text) && text.includes('-')) return true;
  if (/\b(?:SIMULATED|PAYSTACK|VITE|ALLOW|DB)_[A-Z0-9_]+\b/.test(text)) return true;
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH|VALUES|CREATE)\b/i.test(text)) return true;
  return false;
}

function userFacingStrings(source: string): string[] {
  const withoutComments = stripComments(source);
  const values: string[] = [];
  for (const match of withoutComments.matchAll(STRING_LITERAL)) {
    values.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return values
    .map((value) => value.replace(/\$\{[^}]*\}/g, '').trim())
    .filter((value) => /[A-Za-z]/.test(value) && value.length > 2)
    .filter((value) => !isTechnical(value));
}

function collectTs(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectTs(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

describe('API response and seeded content language', () => {
  const sources = collectTs(srcRoot).filter(
    (file) => !EXCLUDED.has(relative(srcRoot, file).replaceAll('\\', '/')),
  );

  it('audits the API response surface', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some((file) => file.endsWith('commerce/routes.ts'))).toBe(true);
    expect(sources.some((file) => file.endsWith('scripts/seed-fixtures.ts'))).toBe(true);
  });

  for (const file of sources) {
    const label = relative(srcRoot, file).replaceAll('\\', '/');
    it(`${label} returns commercial, jargon-free copy`, () => {
      const offenders = userFacingStrings(readFileSync(file, 'utf8')).filter((value) =>
        BANNED.test(value),
      );
      expect(offenders).toEqual([]);
    });
  }

  it('uses the commercial preview checkout paths', () => {
    const routes = read('commerce/routes.ts');
    expect(routes).toContain('/checkout/preview/');
    expect(routes).not.toContain('/checkout/simulated/');
    expect(routes).not.toContain('/simulated/checkout/');
  });

  it('keeps seeded public course content free of development markers', () => {
    const seed = read('scripts/seed-fixtures.ts');
    expect(seed).not.toContain('[Development fixture]');
    expect(seed).not.toContain('Development fixture quiz.');
    expect(seed).not.toContain('local fixture for the learning player');
    expect(seed).not.toContain('Seeded ${result.courses} new course fixture(s)');
    expect(seed).toContain("const FIXTURE_TAG = 'curated';");
  });
});
