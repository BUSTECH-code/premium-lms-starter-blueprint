# Local Visual Reference Images

Place approved visual-reference screenshots in this folder so coding agents can inspect them without relying on external browsing.

## Suggested filenames

- `homepage-reference.png`
- `course-catalogue-reference.png`
- `course-detail-reference.png`
- `student-dashboard-reference.png`
- `video-learning-reference.png`
- `materials-library-reference.png`

## Rules

1. Use screenshots or image files that you are permitted to store and share in this repository. Do not copy third-party images into the repository unless their licence or permission allows it.
2. Keep the original source URL, creator/site, access date, and relevant licence/permission notes in `../REFERENCE-SOURCES.md`.
3. Add a short note explaining the specific design lesson to study. Do not instruct the agent to copy a reference wholesale.
4. Prefer clear screenshots of the relevant screen or component. Avoid collages where details cannot be inspected.
5. These are design inputs only. They are not production assets and must not be copied into the LMS interface as-is.
6. If a reference is unavailable, tell the user. Do not silently substitute a generic design.

When a local image is added, update `../REFERENCE-SOURCES.md` with its filename so the agent can map the image to its design purpose.

## Phase 4 evidence note (2026-11-05)

The six local reference images in `images/` were inspected as design inputs. External source pages were not fetched in this environment. No third-party image was copied into the LMS interface. Automated browser screenshots, rendered viewport captures and side-by-side visual comparison were **Not run**; Phase 4 sign-off uses DOM component tests, typechecking and build verification instead.
