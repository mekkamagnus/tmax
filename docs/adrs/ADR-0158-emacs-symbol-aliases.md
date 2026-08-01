# ADR-0158 — Emacs-standard symbol aliases (#51)
## Status: Accepted
## Context
Emacs-conventional symbol names (`buffer-name`, `current-buffer-name`,
`switch-to-buffer`, `open-file`, `save-file`) were Undefined — the project's docs
(`documentation.ts`, RFC-002, `src/editor/CLAUDE.md`) and examples referenced them,
but the working primitives had different names (`buffer-current`, `buffer-switch`,
`find-file-open`).

## Decision
Add thin T-Lisp alias wrappers in `buffers.tlisp` (already loaded at daemon startup):
- `buffer-name` / `current-buffer-name` → `buffer-current`.
- `switch-to-buffer` (name) → `buffer-switch` (1-arg; NOT the 0-arg interactive
  `switch-buffer` — codex concern).
- `open-file` (filename) → `find-file-open`.
- `save-file` — already defined (#49).

Fix `documentation.ts:234` — the key-bind example used bare `"save-file"` (looked
up, not invoked) → `"(save-file)"` (invoked).

## Consequences
- All Emacs-conventional names resolve: users and docs can use them interchangeably
  with the tmax-native primitives. Verified: buffer-name returns the name;
  switch-to-buffer switches; open-file loads content; save-file persists.
- No regression (buffer/completion tests 14/14).
- `switch-to-buffer` takes a 1-arg name (matching Emacs `switch-to-buffer`), not
  the 0-arg interactive `switch-buffer`.

Spec: [BUG-45](../specs/BUG-45-emacs-symbol-aliases.md). Issue: #51.
Verify-gate: PASS.
