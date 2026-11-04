# Workflow: Learning, Progress and Certificates

## Learner flow

1. Learner opens their course library.
2. Backend checks active course entitlement.
3. Learner opens a course and selects a module/lesson.
4. Backend checks access to the course and lesson.
5. Client requests authorized media delivery.
6. Learner watches/reads lesson content.
7. Progress events are recorded with safe retry behaviour.
8. Learner completes required quizzes/assignments where configured.
9. Completion service evaluates the course's configured criteria.
10. Certificate is issued only when eligibility is verified.

## Progress principles

- Store progress independently from downloads.
- Resume playback from the last reliable saved position.
- Handle intermittent connectivity and duplicate progress events.
- Avoid allowing a stale client to overwrite newer progress without defined conflict rules.
- A downloaded lesson is not automatically a completed lesson.
- A student deleting local content does not lose server-side progress.

## Certificate requirements

- Certificate must identify the learner and course and have a verifiable unique identifier.
- Record the completion criteria/version used at issuance.
- Preserve certificate history.
- Exact certificate design, verification page, correction and revocation rules remain open.

## Open learning rules

- Mandatory lesson definition.
- Quiz passing score and retake policy.
- Assignment requirements and approval.
- Whether video watch percentage is part of completion.
- Whether course criteria may change after a learner begins.
