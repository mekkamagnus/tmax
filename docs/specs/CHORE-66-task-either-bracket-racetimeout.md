# Chore: add TaskEither.bracket + TaskEither.raceTimeout FP primitives

## Chore Description
`src/utils/task-either.ts` lacks two combinators needed to express #16
(withWorkspaceOverride prologue/epilogue) and #17 (runOneGate deadline) in the
project's FP vocabulary instead of imperative try/finally + setTimeout:
- **`TaskEither.bracket(acquire, use, release)`** — resource management: acquire a
  resource, use it, and GUARANTEE `release` runs whether `use` succeeds or fails
  (release is best-effort; its outcome is ignored). If `acquire` fails, release is
  NOT called.
- **`raceTimeout(ms, onTimeout?)`** (instance) — race `this` against a deadline;
  resolve with the result if it settles within `ms`, else Left (Error by default,
  or `onTimeout()`).

Both are additive — no existing code is modified.

## Relevant Files
- `src/utils/task-either.ts` — add `bracket` (static) + `raceTimeout` (instance).
- `test/unit/task-either.test.ts` — cover success/failure/timeout paths.

### New Files
- (none)

## Step by Step Tasks
### Task 1 — bracket
**AC**: `TaskEither.bracket(acquire, use, release)` returns the `use` result;
`release` always runs after `use` (success or Left); `release` is NOT called when
`acquire` is Left; a `release` failure does not mask the `use` result.
### Task 2 — raceTimeout
**AC**: `te.raceTimeout(ms)` returns the result when it settles before `ms`,
else a Left; a custom `onTimeout()` produces a typed Left; the computation
rejecting after timeout is absorbed (no unhandled rejection).
### Task 3 — tests
**AC**: `bun test test/unit/task-either.test.ts` green for both combinators.
### Task 4 — Validate
typecheck clean; verify-gate PASS.

## Validation Commands
- `bun run typecheck:src && bun run typecheck:test`
- `bun test test/unit/task-either.test.ts`

## Notes
- Additive only (no behavior change to existing code). Unblocks #16 (bracket) and
  #17 (raceTimeout); AUTO-UNBLOCK fires for both when this lands.
- JS promises can't be cancelled, so `raceTimeout` does not abort the underlying
  computation — it just resolves Left on timeout (the loser is absorbed).
