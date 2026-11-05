# Design Direction — Premium Digital Academy

## Product design intent

Create a premium digital academy, not a conventional LMS with a prettier dashboard.

The initial product is centred on recorded video courses and course materials. Tutor discovery, tutor applications and live tutoring must not dominate the initial experience.

## Reference inspiration

The product owner previously reviewed the Luxbridge Academy website and wanted to retain selected strengths of its presentation while adapting them to a video-first learning platform. The intended lesson is polished educational presentation and clear content hierarchy—not copying tutor-focused functionality.

The six local reference images in `docs/design/references/images/` were inspected as visual evidence during Phase 4. External source pages were not fetched in this environment. The references are design inputs, not production assets, and they are not a substitute for this written direction.

## Desired qualities

- Premium, confident, editorial presentation.
- Strong typography and deliberate whitespace.
- High-quality, purposeful course imagery.
- Clear visual hierarchy and restrained colour.
- Consistent spacing and component behaviour.
- Distinctive layouts rather than repeated generic cards.
- Calm, focused learning environment.
- Strong information clarity and usability.
- Responsive, mobile-conscious layouts.
- Fast, accessible interactions.

## Core experiences to design

### Public website
- Brand proposition and clear course discovery action.
- Selected featured courses/categories based on real available content.
- Credibility through accurate information, not fabricated testimonials or statistics.
- Clear explanation of learning format and purchase model.

### Course catalogue
- Search and useful filters.
- Strong course image/title hierarchy.
- Clear price and relevant course metadata.
- Thoughtful list/grid composition; do not default to a wall of identical cards.

### Course detail
- Clear course value proposition and outcomes.
- Curriculum preview.
- Course format and relevant metadata.
- Price and purchase action.
- Accurate instructor attribution if applicable.
- No invented reviews, ratings or claims.

### Student dashboard
- Prioritise continue learning and owned courses.
- Show progress that has a defined source and meaning.
- Provide clear access to downloads and certificates.
- Avoid meaningless analytics and decorative widgets.

### Video learning environment
- Prominent, usable video area.
- Well-proportioned curriculum/lesson navigation.
- Clear current lesson and progress.
- Supporting materials accessible in context.
- Responsive behaviour that works on small screens.
- Low-bandwidth considerations and clear playback/download states.

### Materials library
- Organise files by course/module/lesson.
- Show meaningful file type, size and availability information when known.
- Make download status and offline availability understandable.
- Do not imply a file is available offline until verified.

### Administration
- Consistent brand system, but optimise for operational clarity.
- Tables, filters and forms should be readable and efficient.
- Do not let the admin dashboard dictate the public/student visual language.

## Avoid

- Generic LMS starter-template appearance.
- Generic SaaS dashboard copied across all roles.
- Repetitive card grids on every screen.
- Excessive gradients, glassmorphism, shadows or animation.
- Random accent colours and inconsistent spacing.
- Oversized hero sections that hide useful course information.
- Fake charts, ratings, testimonials or learner counts.
- Decorative controls that do nothing.
- Visual effects that impair performance or accessibility.

## Confirmed Phase 4 baseline

The product owner approved the provisional editorial tokens as the **official Phase 4 visual baseline** on 2026-11-05. Exact values are now **Confirmed** in `design-system.md` and `apps/web/src/styles/tokens.css`: neutral paper/ink palette, deep navy accent, Georgia serif display with a system sans body, 4px spacing scale, restrained borders/shadows and no gradients or glass effects.

Phase 4 implements shared editorial primitives and confirmed responsive CSS bands across Catalogue, Course Detail, Checkout, Account/Dashboard and Course Player. Local references informed hierarchy and restraint only; no reference brand, exact composition or third-party image was copied.

## Brand decisions still open

Do not invent final brand identity values. Product owner must still approve:
- Brand name and logo.
- Image art direction.
- Light/dark theme policy.
- Icon style.

The confirmed tokens are an implementation baseline, not a claim that these broader identity decisions are resolved.
