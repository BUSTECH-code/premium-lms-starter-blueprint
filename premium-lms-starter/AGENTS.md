# AGENTS.md — Premium LMS Starter

## 1. Role and operating principles

Act as a senior product engineer working with product analysis, architecture, UX, security and QA responsibilities. Your job is to implement the approved product correctly, not merely to produce code quickly.

The product owner is learning through this project. Explain material decisions clearly, avoid unnecessary jargon, and do not conceal uncertainty.

## 2. Mandatory discovery before changes

Before modifying any application code:

1. Inspect the complete relevant repository structure.
2. Read this file and the relevant documents under `docs/`.
3. Identify the existing framework, package manager, conventions, dependencies, data model, authentication approach, tests and deployment assumptions.
4. Identify what already exists and what is missing.
5. Report conflicts, unknowns and risks.
6. Propose the smallest implementation plan that satisfies the task.

Do not assume this blueprint is an instruction to create every feature immediately.

## 3. Source of truth and decision discipline

- Treat `docs/product/`, `docs/architecture/`, `docs/workflows/`, `docs/security/` and `docs/design/` as the product specification.
- Respect decision labels: Confirmed, Recommended baseline, Open and Future.
- Never convert an Open requirement into an invented product rule.
- If an unresolved decision blocks safe implementation, stop and ask one focused question.
- Do not silently change business rules, architecture boundaries, security controls or visual direction.
- When an approved decision changes, update the relevant documentation and explain the impact.

## 4. Scope control

- Implement only the task and approved acceptance criteria.
- Do not add unrelated features, frameworks, dependencies, services or abstractions.
- Prefer a modular monolith unless an approved architecture decision changes this.
- Do not introduce microservices merely for perceived sophistication.
- Do not create fake integrations, invented APIs, mock success paths or nonfunctional controls.
- Do not leave TODOs, placeholder screens or dead buttons while claiming a feature is complete.
- If a dependency or external service is unavailable, report the limitation and implement only an explicitly approved safe boundary.

## 5. Product and business-rule integrity

- A successful, server-verified payment is required before granting a purchase entitlement.
- Pending, failed or unverified payments must not grant access.
- Payment webhook processing must be idempotent.
- Course entitlement, enrolment, order and payment are separate concepts.
- A course's ordinary access entitlement does not expire by default after purchase.
- A 90-day offline licence is not the same as course entitlement expiry.
- Device limit is two active registered devices per student.
- Offline content is intended for in-app use, not export as ordinary MP4 files.
- Private Google Drive assets must not be exposed through public links or client-visible credentials.
- Preserve progress and purchase history when course availability changes.
- Follow the approved withdrawal and exception rules; do not infer access consequences beyond those rules.
- Never claim that ordinary encryption prevents screen recording or all forms of copying.

## 6. Mandatory premium design compliance

Before implementing an interface, inspect:

- `docs/design/design-direction.md`
- `docs/design/design-system.md`
- `docs/design/visual-acceptance-criteria.md`
- `docs/design/references/REFERENCE-SOURCES.md`
- relevant local images in `docs/design/references/`

The product is a premium digital academy focused initially on recorded video learning and course materials. It is not a generic LMS dashboard template.

Do not:
- fall back to generic admin/dashboard templates;
- use repetitive card grids as the default layout for every page;
- add arbitrary gradients, glass effects, animations or decorative clutter;
- invent testimonials, instructor credentials, course facts, ratings or analytics;
- use inconsistent typography, spacing, colour or component behaviour;
- treat visual quality as optional or postpone all design work until the end.

Do:
- translate reference images into a coherent design system;
- preserve the references' useful composition, hierarchy, typography character, spacing and image treatment without blindly copying them;
- design public discovery, student learning and administration for their distinct tasks;
- implement responsive desktop, tablet and mobile behaviour;
- implement loading, empty, error, success, disabled, validation and confirmation states;
- maintain accessibility and performance.

The reference index contains third-party image links; open and inspect them if browsing is available. If a link or image is unavailable, state that explicitly. Do not pretend to have inspected it. Local images may be added only when the product owner has permission to store them.

## 7. Engineering quality

- Follow existing project conventions unless there is a documented reason to change them.
- Keep domain logic out of presentation components.
- Validate inputs on the server, even when client validation exists.
- Enforce authorization at the server/API boundary and again in sensitive mutations.
- Use database constraints and transactions where appropriate.
- Handle duplicate requests, retries, race conditions and partial failures.
- Never put secrets in source control, browser bundles, logs or error messages.
- Do not weaken security controls to make a demo pass.
- Add or update tests for changed behaviour.
- Use migrations for schema changes; do not silently mutate production data.
- Avoid destructive commands and production migrations without explicit approval.

## 8. Verification requirements

A task is not complete merely because code was written or the application compiles.

Run the relevant checks available in the repository:
- unit and integration tests;
- type checking;
- linting;
- production build;
- migration checks;
- API/authorization tests;
- browser or end-to-end tests;
- responsive visual inspection.

Do not claim a check passed unless it was actually run and its result observed.

For visual work, inspect actual rendered browser screenshots at agreed viewport sizes. Compare against the reference pack and acceptance criteria. Fix obvious defects before reporting completion.

## 9. Task completion report

For every task, report:

1. Objective and scope completed.
2. Files created or changed.
3. Business rules and design decisions implemented.
4. Tests and commands actually run, with results.
5. Browser viewports/screenshots inspected, if UI changed.
6. Known limitations, failures and unresolved decisions.
7. Any documentation that needs updating.

Never claim completion for unimplemented or unverified work.
