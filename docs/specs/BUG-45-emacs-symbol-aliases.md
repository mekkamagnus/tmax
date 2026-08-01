# Bug: Emacs-standard symbol aliases missing (buffer-name, switch-to-buffer, open-file, etc.)

## Bug Description
Emacs-conventional symbol names that users + the project's own docs reach for were
Undefined: `open-file`, `switch-to-buffer`, `save-file`, `current-buffer-name`,
`buffer-name`. The internal docs (`documentation.ts`), RFC-002, and
`src/editor/CLAUDE.md` reference these non-existent symbols while working
primitives exist under different names (`find-file-open`, `buffer-switch`,
`buffer-current`).

## Problem Statement
The Emacs-conventional names must resolve to the working primitives.

## Solution Statement
Add thin T-Lisp alias wrappers in `buffers.tlisp` (already loaded):
- `buffer-name` / `current-buffer-name` → `buffer-current`.
- `switch-to-buffer` (name) → `buffer-switch` (1-arg; NOT the 0-arg interactive
  `switch-buffer` — codex concern).
- `open-file` (filename) → `find-file-open`.
- `save-file` — already defined (#49).

Also fix `documentation.ts:234` — the key-bind example used bare `"save-file"`
(looked up, not invoked) → `"(save-file)"` (invoked).

## Relevant Files
- `src/tlisp/core/commands/buffers.tlisp` — alias defuns + export.
- `src/editor/api/documentation.ts:234` — `"(save-file)"` fix.
- `test/integration/emacs-aliases.test.ts` — each alias resolves + has side effects.

## Step by Step Tasks
### Task 1 — aliases resolve
**AC**: `(buffer-name)`, `(current-buffer-name)`, `(switch-to-buffer name)`, `(open-file filename)`, `(save-file path)` all resolve + produce the correct result.
### Task 2 — documentation fix
**AC**: documentation.ts:234 uses `"(save-file)"` (invoked, not bare).
### Task 3 — test
**AC**: an integration test exercises each alias with arguments + asserts side effects (buffer name returned, buffer switched, file opened, file saved).
### Task 4 — Validate
verify-gate PASS.

## Validation Commands
- daemon: `(buffer-name)`, `(switch-to-buffer "*scratch*")`, `(open-file "/etc/hostname")`, `(save-file "/tmp/x")` all succeed.
- `bun test test/integration/emacs-aliases.test.ts`.

## Notes
- `save-file` already exists (#49); `quick-save` is bound at normal.tlisp:249 (#49).
- codex: use buffer-switch (1-arg) for switch-to-buffer, NOT the 0-arg switch-buffer.
