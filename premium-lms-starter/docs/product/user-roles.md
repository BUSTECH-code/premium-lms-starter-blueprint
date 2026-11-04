# User Roles and Actors

This document identifies likely actors. Exact permissions are **Open** until the permission matrix is approved.

## Learner / student
Primary actor for the initial product.

Goals:
- Discover courses and understand their value.
- Register and manage an account.
- Purchase a course.
- Access purchased courses.
- Watch lessons and use course materials.
- Track learning progress.
- Download supported content for offline in-app learning.
- Complete assessments and receive eligible certificates.
- Manage up to two registered devices.

## Content author / course creator
A likely operational actor, but launch authority and workflow are **Open**.

Potential responsibilities:
- Draft course structure.
- Add modules, lessons and media references.
- Edit course information and materials.
- Submit content for review.

Do not assume creators can publish directly.

## Administrator / operations
Required operational actor; exact permissions are **Open**.

Potential responsibilities:
- Manage users and roles.
- Review and publish courses if approval is required.
- Manage course availability and withdrawal.
- Investigate payment and access issues.
- Grant or revoke access only under approved policy.
- Review audit records and reports.

## Support operator
Potential separate role; **Open** whether separate from administrator.

Potential responsibilities:
- Investigate learner support cases.
- View limited account, purchase and device information.
- Escalate refunds, payment reversals and content issues.
- Avoid unrestricted access to sensitive data.

## External systems
- Payment provider: payment initiation, verification, webhook events and refunds/reversals.
- Google Drive: private media repository accessed by backend.
- Email/SMS/push provider: notification delivery; provider and channels are open.
- Mobile operating system: secure app storage and playback capabilities.

## Permission design principles

- Deny by default.
- Enforce permissions on the server, not only by hiding UI controls.
- Separate course authoring, review, publishing and withdrawal permissions.
- Separate payment support visibility from permission to issue refunds.
- Audit sensitive actions.
- Do not create roles merely because a typical LMS has them; derive roles from approved responsibilities.
