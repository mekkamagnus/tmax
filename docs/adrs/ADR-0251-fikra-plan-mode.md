# ADR-0251: Fikra plan mode — a thread interaction property gating read-only turns

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #223
**Spec:** SPEC-223

## Context

RFC-027 §Phase 5 (t3code model): planning is not an event or a backend
mode — it is a thread INTERACTION MODE. The agent proposes; the user
approves; implementation follows in the same thread.

## Decision

1. **Interaction is a persisted thread field** (`interaction`:
   default|plan, unset = default). It composes with (not replaces) the
   runtime mode: plan turns override the permission flags, approval
   restores the runtime mode for implementation.
2. **Plan turns are read-only BY CONSTRUCTION**: the native
   `--permission-mode plan` where the CLI surface has it, PLUS edit tools
   disallowed as belt-and-braces. The belt-and-braces is deliberate —
   a plan turn must never edit even if the preset semantics drift.
3. **The plan is ordinary FAEP content.** No separate plan store: the
   thread log's text-delta events ARE the plan (diffable, checkpointed,
   replayable). Capture = a JSON-parsed scan of the thread's own log for
   the last turn's non-echo text — the log is the single source of truth.
4. **Approval reuses the review vocabulary**: the y/e/n offer rides the
   permission-request/prompt machinery users already know; decisions are
   recorded as events (`plan-approved` / `plan-discarded`). The
   implementation turn carries the plan in its prompt — the plan itself
   is already durable in the log.

## Consequences

- Switching threads carries the plan state (per-thread field + per-thread
  log); a pending approval belongs to the thread that produced it.
- The edit path (`*Fikra-Plan*`) mutates the PENDING copy only — the
  approved text is what the implementation turn receives; the original
  plan stays untouched in the log (the edit is visible in the new turn).
