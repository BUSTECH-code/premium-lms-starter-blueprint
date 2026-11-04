# Coding Agent Task Protocol

## Required task prompt structure

Every implementation task must include:

1. Objective
2. Context and relevant source documents
3. Existing codebase inspection findings
4. Scope included
5. Scope explicitly excluded
6. Requirements and business rules
7. Constraints
8. Acceptance criteria
9. Verification commands and expected evidence
10. Completion report format

## Before implementation

Agent must inspect the existing codebase and report:
- relevant files and components;
- current implementation behaviour;
- conventions and dependencies;
- gaps and risks;
- smallest safe implementation plan.

Do not overwrite or restructure existing code before understanding it.

## During implementation

- Work in small, reviewable changes.
- Do not invent APIs or dependencies.
- Do not duplicate existing functionality.
- Do not add placeholders or dead controls.
- Do not silently change schemas or business rules.
- Update tests and documentation where required.
- Keep changes within task scope.

## Completion report

Include:
- summary;
- files changed;
- decisions made;
- tests/checks actually run;
- browser/device verification evidence where applicable;
- known defects and limitations;
- remaining work.

## Stop conditions

Stop and ask for clarification when:
- a required business rule is Open;
- source documents conflict;
- an external API/provider capability is assumed but unverified;
- a destructive data operation is required;
- security would be weakened to complete the task;
- requested scope materially changes architecture or cost.
