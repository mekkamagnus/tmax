# Bug: Python Harness — Wrong T-Lisp API Names and Unverified Function Calls

## Bug Description

The Python test harness (`test/ui/tmax_harness/`) contains T-Lisp function calls that don't exist in the tmax daemon API. The `operations.py` `move()` function uses `cursor-move-key` which is undefined. Additionally, the T-Lisp API names were discovered via trial-and-error rather than sourced from the actual API, risking future breakage.

## Problem Statement

1. `operations.py:84` calls `(cursor-move-key "j")` — undefined symbol, will error at runtime
2. No systematic verification that all T-Lisp function names used in the harness match the actual daemon API

## Solution Statement

1. Fix `move()` to use `(cursor-move line col)` which is the actual API
2. Add a central T-Lisp API name registry in `client.py` to prevent future drift
3. Run all three tests to validate

## Steps to Reproduce

1. `cd test/ui && uv run python -c "from tmax_harness import *; from tmax_harness.client import eval_expr; from tmax_harness.config import load_config; c = load_config(); print(eval_expr(c, '(cursor-move-key \"j\")'))"` — fails with undefined symbol

## Root Cause Analysis

T-Lisp function names were guessed during implementation. The tmax daemon has a specific set of registered functions — the harness must use the correct names. `cursor-move-key` was invented but the actual API is `cursor-move` which takes `(line, column)` arguments.

## Relevant Files

- `test/ui/tmax_harness/operations.py` — Contains the wrong `cursor-move-key` call in `move()`
- `test/ui/tmax_harness/client.py` — Contains T-Lisp eval calls that should use verified API names

## Step by Step Tasks

### Task 1: Fix move() to use cursor-move API

**User Story**: As a test developer, I want the move() function to use the correct daemon API so that navigation tests work.

- In `operations.py`, replace the `cursor-move-key` eval with `cursor-move` using line/column offsets
- `cursor-move` takes absolute `(line, column)` — need to read current position, compute new position, call `cursor-move`
- For simplicity in daemon mode, fall back to tmux key sending for move (daemon doesn't have a relative move API)

**Acceptance Criteria**:
- [ ] `move()` no longer calls `cursor-move-key`
- [ ] `move()` in daemon-tmux mode uses tmux key sending as fallback

### Task 2: Validate all tests pass

**User Story**: As a developer, I want all three Python UI tests to pass with zero regressions.

- Stop any running daemon
- Run all three tests sequentially with daemon restarts between them

**Acceptance Criteria**:
- [ ] `01_startup.py` passes all assertions
- [ ] `02_basic_editing.py` passes all assertions
- [ ] `03_mode_switching.py` passes all assertions

## Validation Commands

- `cd /Users/mekael/Documents/programming/typescript/tmax && bin/tmax --stop; sleep 1; cd test/ui && rm -rf tmax_harness/__pycache__ && uv run python tests/01_startup.py` — Startup test passes
- `cd /Users/mekael/Documents/programming/typescript/tmax && bin/tmax --stop; sleep 1; cd test/ui && rm -rf tmax_harness/__pycache__ && uv run python tests/02_basic_editing.py` — Basic editing test passes
- `cd /Users/mekael/Documents/programming/typescript/tmax && bin/tmax --stop; sleep 1; cd test/ui && rm -rf tmax_harness/__pycache__ && uv run python tests/03_mode_switching.py` — Mode switching test passes

## Notes

The T-Lisp API names verified as correct:
- `(editor-mode)` — returns current mode (lowercase: "normal", "insert")
- `(editor-set-mode "insert")` — sets mode
- `(buffer-text)` — returns buffer contents
- `(buffer-insert "text")` — inserts text at cursor
- `(file-save)` — saves current file
- `(editor-quit)` — quits editor
- `(cursor-position)` — returns [line, col]
- `(cursor-move line col)` — moves to absolute position
- `(buffer-current)` — returns current buffer name
- `(buffer-list)` — returns list of buffer names

The `move()` function should use tmux key sending even in daemon mode since there's no relative cursor movement API in the daemon.
