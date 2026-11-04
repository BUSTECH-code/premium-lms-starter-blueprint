# Visual Acceptance Criteria

A UI task is not complete solely because it compiles or functions.

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
- [ ] Actual screenshots were inspected and included in the completion report.

## Evidence

The agent must report actual viewport sizes and screenshot locations. It must not claim visual comparison if it did not inspect the reference images or rendered screenshots.
