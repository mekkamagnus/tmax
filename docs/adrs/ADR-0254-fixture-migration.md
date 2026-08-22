# ADR-0254: The fixture migration — swap the construction line, keep the subject

**Date:** 2026-08-23
**Status:** Accepted
**Issue:** #228
**Spec:** SPEC-228

## Context

CHORE-44 Change 12 made `createEditorFixture` the construction
convention; 15 test files accreted past it and were grandfathered during
the #198 CI tail to keep CI green. The debt: the convention only guarded
new files.

## Decision

1. **Migrate the construction, preserve the test's subject.** All 15
   files wrapped their own `TmaxServer` around a directly-constructed
   Editor — that wrap is what those suites test. The migration replaces
   ONE line (the construction) with the fixture and feeds
   `fixture.editor` to the existing server wrap. Zero call sites change;
   the return shape is identical.
2. **The fixture owns disposal** — the pre-migration code never disposed
   either; the fixture's per-test teardown is strictly more correct, and
   its legacy-compat handles make the missing explicit `dispose()` calls
   non-blocking.
3. **The allow-list shrinks to justified permanents.** Grandfathering is
   a transition state, not a parking lot: entries exist to be removed,
   and the two that remain carry structural reasons (real-TerminalIO
   testing; server-wrapped open-file).

## Consequences

- AC12.1 again guards every file: a new direct construction fails the
  suite with no grandfathering escape hatch by default.
- The pattern for future "wrap the fixture in the thing under test"
  suites: construct via the fixture, wrap, return the same shape.
