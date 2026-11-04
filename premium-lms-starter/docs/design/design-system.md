# Design System — Requirements

This document defines what the design system must contain. Exact tokens are not yet approved.

## Foundations

Create documented tokens for:
- Brand and semantic colours.
- Typography families, weights, sizes and line heights.
- Spacing scale.
- Layout widths and breakpoints.
- Borders, radii and shadows.
- Layering/z-index.
- Motion duration and easing.
- Focus indicators.

Do not select arbitrary values independently in each component.

## Components

Define reusable, accessible patterns for:
- Buttons and links.
- Inputs, selects, checkboxes and validation.
- Navigation and breadcrumbs.
- Course cards and course metadata.
- Progress indicators.
- Tabs and filters.
- Dialogs and confirmation patterns.
- Toasts/alerts.
- Tables and pagination.
- Empty, loading and error states.
- Video player shell and lesson navigation.
- Resource/material rows.
- Download status and offline licence status.

## Component rules

- Components must have documented variants and states.
- Use semantic HTML and accessible names.
- Keyboard interaction must work.
- Focus states must be visible.
- Colour must not be the only way to communicate status.
- Do not build abstractions for one-off elements without a real reuse case.
- Keep domain logic out of visual primitives.

## Responsive rules

Define and test agreed viewport widths for:
- Small mobile.
- Large mobile.
- Tablet.
- Desktop.
- Wide desktop.

Do not simply shrink desktop layouts. Reconsider navigation, content order, player controls and sidebars for mobile.

## Theme

Light/dark theme decision is open. Do not implement both merely because it is common; confirm brand and user needs first.
