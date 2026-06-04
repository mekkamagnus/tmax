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
