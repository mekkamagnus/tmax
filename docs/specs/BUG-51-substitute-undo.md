# Bug: :%s / :s substitution not undoable

## Description
Whole-buffer `:%s/find/replace/` mutated without undo bookends — `u` couldn't revert
a wrong substitution (data-loss concern).

## Solution
Wrap `:%s`/`:s` in `(undo-begin)` + `(undo-commit "substitute")` in command-line.tlisp
(the pattern repeat.tlisp uses). Caller-owned bookends per codex (not auto-bookending
the primitive).

## Validation
- daemon: `:%s/foo/ZZZ/g` → undo-history-count increments (0→1); `(undo)` reverts.
