# Design System — Confirmed Phase 4 Baseline

**Status: CONFIRMED (approved 2026-11-05).** The provisional editorial tokens are now the official Phase 4 visual baseline. The exact values live once in `apps/web/src/styles/tokens.css`; `app.css` and `phase4.css` consume those tokens and contain no raw colour literals, gradients, glass blur or network font imports.

Brand name/logo, image art direction, icon style and a light/dark theme policy remain **Open**. Phase 4 does not invent those decisions. Local reference images were inspected as design inputs only; no third-party reference image is a production asset.

## Confirmed foundations

| Foundation | Confirmed value / rule |
|---|---|
| Palette | Paper `#faf9f7`, surface `#ffffff`, ink `#1a1a18`, accent `#1f3a5f`, danger `#8c2f2f`, success `#276749`, focus `#2b6cb0` |
| Display type | `Georgia, 'Iowan Old Style', 'Times New Roman', serif` |
| Body type | `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` |
| Type scale | 0.8125, 0.875, 1, 1.125, 1.5, 2, 3 and 4rem tokens; serif display with tight leading, sans body at 1.6 line height |
| Spacing | 4px-based `--space-1` … `--space-10` scale (0.25rem … 8rem) |
| Layout | `--layout-max: 68rem`, `--layout-wide: 88rem`, `--layout-content: 44rem`, `--layout-sidebar: 20rem` |
| Borders / radii | `--border-thin`, `--border-strong`, `--radius-sm/md/lg/pill` |
| Elevation | Restrained `--shadow-soft`, `--shadow-raised`, `--shadow-focus`; no glassmorphism |
| Motion | `--duration-fast: 120ms`, `--duration-slow: 240ms`, standard easing; respects `prefers-reduced-motion` |
| Layering | `--z-header`, `--z-watermark`, `--z-skip` |
| Theme | Light editorial baseline only; dark theme is Open |

Derived semantic surfaces such as `--color-accent-soft`, `--color-header-bg`, `--color-overlay` and `--color-watermark` may contain alpha values, but only inside `tokens.css`.

## Responsive CSS bands

These are documented CSS bands, **not** claims that browser screenshots were captured:

| Band | Media query |
|---|---|
| Small mobile | `max-width: 639px` |
| Large mobile | `min-width: 640px` and `max-width: 899px` |
| Tablet | `min-width: 900px` and `max-width: 1199px` |
| Desktop | `min-width: 1200px` |
| Wide desktop | `min-width: 1600px` |

Layouts deliberately re-stack the header, hero, featured course, checkout stepper, dashboard stats, detail sidebar and player sidebar on smaller bands; they do not merely shrink the desktop grid.

## Shared components and view integration

- `apps/web/src/components/ui.tsx` — accessible buttons, alerts, spinners, fields and badges with explicit `data-state`, `data-loading`, `data-kind` and `data-invalid` hooks.
- `apps/web/src/components/editorial.tsx` — `PageIntro`, `CourseCover`, `Stepper`, `Stat` and `StatePanel`. Typographic course covers use real course metadata, not borrowed artwork.
- `apps/web/src/styles/phase4.css` — editorial layout for Catalogue, Course Detail, Checkout, Account/Dashboard and Course Player, including a non-invasive session watermark and five responsive bands.
- `apps/web/src/App.tsx` — skip link, solid editorial header/brand, main landmark and footer.

State coverage is shared: loading, empty, error, success, disabled, validation, warning, quarantined, expired and confirmation panels use one accessible treatment. Colour is never the only status signal; headings, text and `data-state` attributes carry meaning.

## Component rules

- Components must have documented variants and states.
- Use semantic HTML and accessible names.
- Keyboard interaction and visible focus must work.
- Colour must not be the only way to communicate status.
- Keep domain logic out of visual primitives.
- Do not build abstractions for one-off elements without a real reuse case.
- Use real course data or clearly identified test fixtures only; no invented ratings, testimonials or statistics.

## Phase 4 verification and sign-off exception

Approved Phase 4 sign-off relies on **DOM component tests, full typechecking and production build verification**. `apps/web/src/styles/design-system.test.ts` checks token confirmation, raw-colour containment, responsive breakpoints and stylesheet order; page/component tests assert shared layout hooks and states.

Automated browser screenshot testing, rendered viewport comparison and reference-image side-by-side inspection were **Not run**. No screenshot locations or viewport captures are claimed. Browser viewports/screenshots must be reported as **Not run** in the Phase 4 completion report.


## Task 2 polish and accessibility regression (2026-11-07)

- Legacy `app.css` breakpoints at 720px/52rem/60rem/40rem were reconciled to the confirmed
  `max-width: 899px` and `max-width: 639px` bands; `phase4.css` retains all five confirmed bands.
- Remaining raw spacing declarations for buttons, fields, pills and small offsets now use the
  confirmed `--space-*` scale; typography continues to use `--font-*` tokens.
- The app shell now exposes explicit `banner` and `contentinfo` roles, a `Primary navigation`
  label, a `Skip to main content` link and a visible `:focus-visible` outline.
- `apps/web/src/styles/final-polish.test.tsx` checks WCAG AA contrast for ten confirmed
  text/background token pairs (all >= 4.5:1), responsive layout hooks for the six named views,
  five CSS bands, reduced motion, landmarks, first-focus skip-link order, accessible names and
  keyboard reachability.
- Automated browser screenshots and rendered viewport comparison remain **Not run**; DOM/CSS tests
  are not a substitute for visual inspection. Commercial sign-off is limited to automated gates.
