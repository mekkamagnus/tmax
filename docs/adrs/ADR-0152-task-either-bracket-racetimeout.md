# ADR-0152 — TaskEither.bracket + raceTimeout FP primitives (#40)
## Status: Accepted
## Context
`src/utils/task-either.ts` lacked the two combinators needed to express #16
(withWorkspaceOverride prologue/epilogue) and #17 (runOneGate deadline) in the
project's FP vocabulary — they would otherwise require imperative try/finally +
setTimeout.

## Decision
Add two combinators (both additive — no existing code modified):
- **`TaskEither.bracket(acquire, use, release)`** (static) — resource management:
  acquire → use → release, where `release` is **guaranteed** to run after `use`
  whether it succeeds (Right) or fails (Left), via try/finally. If `acquire` is
  Left, `release` is NOT called. `release` is best-effort: its outcome is ignored
  so a cleanup error cannot mask the `use` result.
- **`raceTimeout(ms, onTimeout?)`** (instance) — race `this` against a deadline;
  return the result if it settles within `ms`, else Left (Error by default, or
  `onTimeout()`). The losing computation is absorbed (async-IIFE wrapper) so a
  post-timeout rejection cannot surface as an unhandled rejection. The deadline
  timer is `clearTimeout`'d once the race is decided (no timer leak).

## Consequences
- Enables FP-style resource brackets (#16) and deadline gates (#17) without
  imperative scaffolding.
- Verified: typecheck clean; 33/33 task-either tests (26 existing + 7 new:
  bracket success/use-fails/acquire-fails/release-error; raceTimeout
  before-deadline/timeout/typed-onTimeout).
- Known, accepted: the `as unknown as L` cast on the default timeout/rejection
  Left matches the existing `tryCatch` ergonomics (L is caller-chosen).
- Unblocks #16 (bracket) via AUTO-UNBLOCK; #17 (raceTimeout) also unblocks but
  remains codex-rejected (its original approach was rejected; a corrected
  raceTimeout-based approach was noted in its thread).

Spec: [CHORE-66](../specs/CHORE-66-task-either-bracket-racetimeout.md). Issue: #40.
Verify-gate: PASS.
