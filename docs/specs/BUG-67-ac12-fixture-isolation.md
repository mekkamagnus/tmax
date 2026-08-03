# Bug (pre-existing): CHORE-44 AC12.1 fixture-isolation meta-test fails

## Goals

- `test/unit/editor-fixture-isolation.test.ts` "AC12.1: no test file in test/unit or test/integration directly constructs an Editor" passes — OR the policy is re-scoped deliberately and the test updated to match.

## Completion Criteria (Definition of Done)

- [ ] AC12.1 is green, or the meta-test is updated to reflect a deliberate policy change with a recorded reason.
- [ ] The offending direct `new Editor(...)` (or equivalent) in a test file is removed/refactored to use the fixture helper, OR explicitly allow-listed.

## Bug Description

`test/unit/editor-fixture-isolation.test.ts` — "CHORE-44 Change 12 — editor fixture isolation > AC12.1: no test file in test/unit or test/integration directly constructs an Editor" — fails. The meta-test scans `test/unit` + `test/integration` for files that construct an `Editor` directly (instead of via the shared fixture) and finds at least one. **Pre-existing** — confirmed by stashing all Emacs-M×-gap `src/` changes; identical failure. Not caused by that work.

## Problem Statement

CHORE-44 Change 12 established that no test directly constructs an `Editor` (all go through the fixture helper, for consistent isolation). A test added since (or the fixture-isolation check itself drifting) violates that invariant. Left red, it both obscures real new violations and undermines the fixture-isolation guarantee.

## Solution Statement

Identify which test file(s) the meta-test flags (run it and read the assertion detail). Either route that test through the fixture helper (`createTestAPIContext` / the editor fixture), or — if direct construction is genuinely required for that test — allow-list it explicitly in AC12.1 with a comment explaining why.

## Relevant Files

- `test/unit/editor-fixture-isolation.test.ts` — the AC12.1 meta-test.
- `test/helpers/editor-fixture.ts` — the fixture helper tests should use.
- The offending test file(s) the meta-test identifies.

## Severity / Notes

- **Priority:** low. Pre-existing process/meta-test; no runtime impact. Not from the Emacs-M× gap work.
