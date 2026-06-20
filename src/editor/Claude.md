# src/editor/ — Editor Layer

## Architecture Rule

This directory contains TypeScript display primitives for the T-Lisp engine.

**TypeScript here provides primitives ONLY.** Editor logic lives in T-Lisp (`src/tlisp/core/`).

### What belongs here
- `api/*.ts` — Raw primitives: buffer insert/delete, cursor get/set, character scanning
- `handlers/*.ts` — Mode dispatch routing that sends keys to T-Lisp. No logic.
- `editor.ts` — `defineRaw()` wrappers that expose editor state to T-Lisp

### What does NOT belong here
- Key binding definitions → `src/tlisp/core/bindings/*.tlisp`
- Command logic → `src/tlisp/core/commands/*.tlisp`
- Operator-pending state machines → T-Lisp command libraries
- Count prefix handling → T-Lisp
- Mode transition logic → T-Lisp

### Before adding code here

Ask: "Am I writing a primitive that answers a factual question about the buffer/cursor, or am I making an editor decision?"

If you're making a decision (what to delete, how to move, which mode to enter), write it in T-Lisp.

### Special (virtual) buffers

Created at editor startup, reserved by name (not user-deletable, not counted as modified file buffers):

- `*scratch*` — default scratch buffer.
- `*Messages*` — user-facing editor event log (`logMessage`). Editor commands and lifecycle messages a user should see.
- `*daemon*` — daemon connection lifecycle event log (`logDaemonEvent`, SPEC-047): client connect/disconnect. Quiet by default; observable via `(switch-to-buffer "*daemon*")`. Kept separate from `*Messages*` so connection chatter never pollutes the user-facing log.

Do not conflate `*daemon*` (this daemon's connection events) with `*daemons*` (SPEC-043, a discovery list of running daemon instances — unimplemented).

