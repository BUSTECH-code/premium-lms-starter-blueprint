# Premium LMS Starter Blueprint

A documentation-first blueprint for planning and building a premium digital learning platform.

## Purpose

This repository is the product and engineering source of truth for the LMS. It is **not a functioning LMS application** and intentionally contains no application code or framework scaffold.

The initial product focuses on recorded video courses and course materials. Live tutoring and other instructor-led services are future capabilities, not launch requirements.

## How to use this repository

1. Import or clone this repository into your coding agent.
2. Ask the agent to inspect `AGENTS.md` and all relevant documents.
3. Initially request an understanding report and gap analysis only. Do not authorize implementation yet.
4. Resolve the open decisions in `docs/product/open-requirements.md`.
5. Approve the architecture and phased implementation plan.
6. Give the agent one implementation task at a time, requiring verification evidence.

## Repository map

- `AGENTS.md` — mandatory instructions for coding agents.
- `docs/product/` — product vision, scope, requirements, business rules, roles and open decisions.
- `docs/architecture/` — recommended architecture, domain boundaries, data concepts and state models.
- `docs/workflows/` — key business and learner workflows.
- `docs/design/` — premium visual direction, design principles, visual acceptance criteria and a curated `REFERENCE-SOURCES.md` index.
- `docs/security/` — security, content protection, devices and offline-learning principles.
- `docs/implementation/` — delivery phases, task rules and verification strategy.

## Status and decision labels

- **Confirmed**: explicitly selected by the product owner.
- **Recommended baseline**: a proposed default accepted as the working direction, but should be confirmed in the final requirements review.
- **Open**: must not be invented by an implementation agent.
- **Future**: deliberately excluded from the initial release.

When a decision changes, update the relevant source document and record the reason. Do not silently contradict another document.

## Visual references

Add selected screenshots to `docs/design/references/`. Use screenshots you have permission to use. Do not assume images shown in a chat are automatically present in this repository.

Suggested filenames:
- `public-homepage.png`
- `course-catalogue.png`
- `course-details.png`
- `student-dashboard.png`
- `video-learning.png`
- `materials-library.png`

The reference folder includes `REFERENCE-SOURCES.md`, a curated index of visual examples and design lessons. Third-party image files are linked, not redistributed. Add local screenshots only when you have permission to store them.
