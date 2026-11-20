# src/tlisp/ — T-Lisp Engine and Command Libraries

## Architecture Rule

T-Lisp owns ALL editor logic. TypeScript only provides raw primitives.

### What belongs here
- `core/bindings/*.tlisp` — Key bindings organized by mode
- `core/commands/*.tlisp` — Command libraries that compose primitives
- `core/modes/*.tlisp` — Minor mode definitions
- Interpreter implementation (`evaluator.ts`, `parser.ts`, etc.)

### Command Library Pattern

Follow the `windows.tlisp` / `tabs.tlisp` / `isearch.tlisp` pattern:
1. Define T-Lisp functions that call TypeScript primitives
2. Add `(key-bind ...)` in the same file
3. End with `(provide "name")`

Example:
```lisp
;; commands/example.tlisp
(defun delete-rest-of-line ()
  (delete-to-line-end))

(key-bind "D" "(delete-rest-of-line)" "normal")
(provide "example")
```

### When to add TypeScript primitives

Only when T-Lisp literally cannot compute something:
- Character scanning (find next char on line)
- Buffer content access (get line N)
- Terminal dimensions

Everything else — state machines, command dispatch, key sequences, count logic — stays in T-Lisp.

## Callback-context state (the evalTlisp boundary) — #306

The `make-process` `:filter`/`:sentinel` callbacks evaluate their T-Lisp
through the SPAWNING editor's `evalTlisp`. The verified model (pinned by
`test/unit/zz-callback-context-state.test.ts`):

- **Same session (one editor):** the callback context shares the FULL
  environment — a `setq` performed in the main session IS visible to the
  filter, and hashmap mutations are shared. There is no two-state split
  within one interpreter.
- **Cross session (the 2026-11-20 incident class):** when a daemon hosts
  multiple editor sessions, a callback's `evalTlisp` is bound to the
  session that SPAWNED the process — module variables `setq`'d in a
  DIFFERENT session are invisible there, while shared object state
  (hashmaps mutated via `keymap-mutable-set!`) crosses. The dropped
  turn-end incident was this split, not interpreter scoping.

**Safe patterns:** derive what callbacks need from mutation-shared
carriers (`keymap-mutable-set!` hashmaps) or thread-record fields; the
explicit-path emitters (`fikra-event-emit-batch-for`) remain the
incident-hardened pattern for events that must land regardless of which
session evaluates. No universal claims beyond the pinned fixture.
