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
