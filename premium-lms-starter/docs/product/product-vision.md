# Product Vision

## Product statement

Build a premium digital academy that makes it easy for learners to discover, purchase and complete high-quality recorded courses, with well-organised learning materials and reliable access across web and mobile.

## Initial product focus

The first release is primarily a video-and-course-material learning platform.

Core learner experience:
1. Discover a course.
2. Understand its outcomes, curriculum, format and price.
3. Purchase it.
4. Receive access after payment is verified.
5. Learn through structured video lessons and supporting materials.
6. Track progress.
7. Complete required assessments.
8. Receive a certificate when the course's completion rules are satisfied.
9. Download supported content for protected in-app offline learning.

> **Phase 3 implementation note:** discovery through required assessments and server-side progress
> are implemented in the learning engine. Certificate issuance (step 8) is deliberately **not**
> implemented in Phase 3 by approved decision `frozen_no_certificate`; real-device protected offline
> learning (step 9) remains future work. See
> `docs/implementation/phase-3-learning-and-progress.md`.

Live tutoring, live classes, mentorship and instructor-led scheduling are future possibilities, not launch commitments.

## Product experience goals

- Premium, distinctive visual identity.
- Clear and trustworthy course discovery and purchase.
- Focused, distraction-conscious video learning.
- Easy access to course materials.
- Reliable experience on mobile and desktop.
- Respect for Nigerian learners' data costs and connectivity constraints.
- Clear purchase, access, progress and certificate status.
- Secure handling of paid content without promising impossible piracy prevention.

## Success criteria to validate

These are proposed measurement categories, not invented numeric targets. Product owner must set targets after baseline and user research.

- Course discovery-to-course-detail engagement.
- Course-detail-to-purchase conversion.
- Successful payment-to-entitlement reliability.
- Lesson playback start success and playback failure rate.
- Download completion and resume success.
- Course progress and completion rates.
- Certificate issuance correctness.
- Support incidents related to payment, access, downloads and devices.
- Core page performance on mobile networks.
- Accessibility and usability test findings.

## Non-goals for initial release

- Live tutoring or live classroom scheduling.
- Mentorship marketplace.
- Complex instructor social network.
- Microservices architecture.
- Guaranteed prevention of screen recording or all copying.
- Publicly accessible Google Drive course links.
- Ordinary MP4 export to general device storage for protected offline courses.
