# ADR-0246: executeCommandAsync's module-env retry is bare-name-only

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #226 (BUG-83)
**Spec:** SPEC-226

## Context

`executeCommandAsync` retries failed commands in the head symbol's module
env. That retry exists for a real reason: `executeAsync` evaluates in the
global env, so a BARE module-scoped command name (e.g. `minibuffer-accept`)
cannot resolve on the first attempt. But the retry also applied to
already-parenthesized forms, whose first eval may have SIDE EFFECTS before
failing — the M-x Enter chain closed the minibuffer, signaled quit, and the
retry re-ran dispatch on a cleared session, silently converting the failure
into a nil success (BUG-83: M-x commands never executed, errors never
surfaced).

## Decision

1. **The module-env retry fires only for bare command names** (the case it
   exists for). A parenthesized form's Left flows straight to error
   reporting.
2. **Failures surface, never vanish**: the diagnostic-aware status-line +
   *Messages* reporting (extracted as `reportCommandError`) is the shared
   tail for both the direct path and a failed retry.
3. **Signals are not errors**: EDITOR_QUIT_SIGNAL converts to a thrown
   Error before reporting (the quit path must propagate, not log) — in the
   direct path AND the retry branch, and in BOTH the async and sync
   executeCommand twins (gate round-1: the retry branch and the sync path
   each had the same swallow).

## Consequences

- M-x (and every keymap-driven command form) executes exactly once; its
  outcome — success, signal, or error — is observable.
- Tests that accidentally pinned the swallow (awaiting handleKey without
  expecting the signal) surface immediately as unhandled rejections.
- Bare-name execution semantics unchanged.
