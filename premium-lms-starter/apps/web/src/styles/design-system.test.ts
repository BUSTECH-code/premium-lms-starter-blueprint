import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('Phase 4 confirmed editorial design system', () => {
  it('marks the token baseline confirmed and keeps the approved exact values', () => {
    const tokens = read('./tokens.css');
    expect(tokens).toContain('CONFIRMED Phase 4 design baseline');
    expect(tokens).not.toContain('PROVISIONAL');
    expect(tokens).toContain('--color-paper: #faf9f7;');
    expect(tokens).toContain('--color-accent: #1f3a5f;');
    expect(tokens).toContain('--color-success: #276749;');
    expect(tokens).toContain('--font-display: Georgia');
    expect(tokens).toContain('--font-body: system-ui');
    expect(tokens).toContain('--layout-wide: 88rem;');
    expect(tokens).toContain('--radius-pill: 999px;');
    expect(tokens).toContain('small mobile <=639px');
    expect(tokens).toContain('wide desktop >=1600px');
  });

  it('keeps raw colour literals only in tokens.css and removes glass effects', () => {
    const stylesheets = [read('./app.css'), read('./phase4.css')];
    for (const css of stylesheets) {
      expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css).not.toMatch(/rgba?\(/);
      expect(css).not.toMatch(/backdrop-filter/);
      expect(css).not.toMatch(/linear-gradient/);
      expect(css).not.toMatch(/@import/);
    }
  });

  it('documents five responsive bands plus shared state and watermark styling', () => {
    const css = read('./phase4.css');
    expect(css).toContain('@media (max-width: 639px)');
    expect(css).toContain('@media (min-width: 640px) and (max-width: 899px)');
    expect(css).toContain('@media (min-width: 900px) and (max-width: 1199px)');
    expect(css).toContain('@media (min-width: 1200px)');
    expect(css).toContain('@media (min-width: 1600px)');
    expect(css).toContain('data-state=');
    expect(css).toContain('.session-watermark');
    expect(css).toContain('.skip-link');
    expect(css).toContain('.page-intro-grid');
    expect(css).toContain('.course-cover');
  });

  it('loads tokens, base styles and Phase 4 styles in cascade order', () => {
    const main = read('../main.tsx');
    const tokens = main.indexOf("import './styles/tokens.css';");
    const app = main.indexOf("import './styles/app.css';");
    const phase4 = main.indexOf("import './styles/phase4.css';");
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(app).toBeGreaterThan(tokens);
    expect(phase4).toBeGreaterThan(app);
  });
});
