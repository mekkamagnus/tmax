# Chore: withWorkspaceOverride() HOF for editing handlers (#16)

## Description
Extracted the common workspace-override prologue/epilogue (resolveFrame /
isWorkspaceOverride / activateFrameWorkspace / restoreWorkspaceAfterOverride)
from the 4 editing handlers (open/eval/insert/command) into a
`withWorkspaceOverride` HOF using try/finally. Accepted the relax: activate errors
propagate raw (not wrapped in handler-specific error messages) — a codex-acknowledged
behavior change.

## Decision
- **HOF:** `withWorkspaceOverride(params, async (frame, workspaceOverride) => body)`
  does the prologue (resolve/activate) + epilogue (restore) via try/finally.
- **try/finally (NOT bracket):** these handlers propagate restore errors; bracket
  swallows them (#40's bracket is for best-effort cleanup).
- **Accept the relax:** activate errors in eval/insert/command propagate raw
  instead of being wrapped as "T-Lisp evaluation error:" / "Insert error:".
  More accurate (an activation error is not a T-Lisp eval error).
- **keypress NOT refactored:** it has a different structure (frame/no-frame branches
  + setActiveFrameId).

## Validation
- typecheck:src clean.
- Integration tests 9/9 (open-cursor-reset, save-chain, wq-save-gate, emacs-aliases).
