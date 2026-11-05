# Visual Acceptance Criteria

A UI task is not complete solely because it compiles or functions.

> **Phase 4 approved sign-off exception (2026-11-05).** For Phase 4, the product owner approved DOM component tests, full typechecking and production build verification in place of automated browser screenshot testing. The general browser-inspection requirement below remains the default for future visual tasks, but it was **not run** for Phase 4. Browser viewports/screenshots and rendered reference-image comparison must be reported as **Not run** in the Phase 4 completion report; do not claim visual comparison.

## Before implementation
- Read `design-direction.md` and `design-system.md`.
- Inspect the relevant reference images.
- Identify the visual patterns to carry forward.
- Inspect existing project styling and components before changing them.
- Confirm missing brand decisions rather than inventing them.

## During implementation
- Use shared design tokens and components.
- Maintain consistent typography, spacing, alignment and interaction states.
- Use genuine course content/data or clearly identified test fixtures.
- Avoid generic templates and repeated card layouts.
- Design empty, loading, error, success, disabled and validation states.
- Preserve accessibility and performance.

## Required visual verification
For each changed page:
1. Run the application.
2. Inspect the actual rendered page in a browser.
3. Capture screenshots at agreed desktop and mobile viewports.
4. Compare screenshots with the relevant reference images.
5. Check overflow, alignment, typography, image cropping, spacing and hierarchy.
6. Test interactive states, not only the default state.
7. Fix visible defects before completion.

## Acceptance checklist

- [ ] Page follows the approved visual direction.
- [ ] Layout hierarchy is clear and purposeful.
- [ ] Typography is consistent and readable.
- [ ] Spacing and alignment are consistent.
- [ ] Images are relevant, high quality and correctly cropped.
- [ ] Components use approved variants and states.
- [ ] No generic template fallback or unexplained deviation.
- [ ] No fabricated content or meaningless metrics.
- [ ] Mobile layout has been inspected.
- [ ] Keyboard and focus behaviour are usable.
- [ ] Loading, empty, error and success states are covered.
- [ ] Actual screenshots were inspected and included in the completion report. **Phase 4: Not run under the approved sign-off exception.**

## Evidence

The agent must report actual viewport sizes and screenshot locations. It must not claim visual comparison if it did not inspect the reference images or rendered screenshots.

## Phase 4 evidence status (2026-11-05)

- DOM/component tests for the five requested views, shared editorial primitives, UI states and explicit responsive layout hooks: **Passed**.
- CSS/token tests for confirmed values, raw-colour containment, five responsive bands and stylesheet order: **Passed**.
- Full TypeScript typecheck and production Vite build: **Passed**.
- Automated browser screenshots at agreed viewports: **Not run**.
- Rendered viewport comparison with local reference images: **Not run**.
- No screenshot locations or visual-comparison artefacts are claimed for Phase 4.
