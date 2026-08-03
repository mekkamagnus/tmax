# Feature: delete-other-windows — maximize the current window (close all others)

## Goals

- Provide the Emacs `delete-other-windows` command (a.k.a. "maximize current window"): close every window except the current one.
- Compose it purely from existing window primitives (`window-list`, `window-current`, `window-close`); no new TypeScript, no new interpreter surface.
- Make it M-x-discoverable (docstring) and reachable via the existing `C-w` window prefix (`C-w o` in Emacs / `C-w` family in tmax).

## Completion Criteria (Definition of Done)

- [ ] After `(split-window-below)` (or `split-window-right`) followed by `(delete-other-windows)`, `(window-count)` returns `1` and `(window-current)` is the index of the window that was current before the call — eval-30.
- [ ] `(delete-other-windows)` is a no-op when there is already only one window (`(window-count)` stays `1`, no error, no message) — eval-30.
- [ ] The surviving window retains the buffer and cursor it had (delete-other-windows closes windows, not buffers — the other buffers remain in `(buffer-list)`) — eval-30.
- [ ] `delete-other-windows` appears in M-x completion (it has a docstring) — eval-30.
- [ ] The command messages the user (e.g. via `(message ...)`) so the affordance is observable in `*Messages*` — eval-30.
- [ ] The closing loop is robust to `window-close` shifting indices: it does not skip a window or close the current one (verified by splitting into 3+ windows and asserting exactly 1 remains, and that it is the originally-current window) — eval-30.

## Description

Emacs binds `delete-other-windows` to `C-x 1` and uses it constantly to "maximize" the current window — close every other window, keep this one. tmax has the full window primitive set — `split-window`, `window-next`, `window-close`, `window-list`, `window-current`, `window-count` (all in `src/editor/api/window-ops.ts`) and the user-facing `split-window-below`/`split-window-right`/`other-window`/`delete-window` commands (in `src/tlisp/core/commands/windows.tlisp`) — but the common "close all others" command is missing. A user with multiple windows must close them one at a time with `delete-window`, switching windows between each.

This spec adds `(defun delete-other-windows)` to `src/tlisp/core/commands/windows.tlisp`. It iterates the window list and closes every window that is not the current one, using the existing `window-close` primitive. It is ~8 lines of T-Lisp. No TypeScript changes.

## User Story

As a user who has split the screen into several windows and now wants to focus on just one,
I want a single command (`M-x delete-other-windows` / the window-prefix binding) that closes every other window,
so that I can maximize the window I care about without manually cycling and closing each sibling.

## Problem Statement

The alpha audit (memory: Alpha audit 2026-08-01) catalogued TS primitives present but not surfaced at the T-Lisp/M-x layer. `delete-other-windows` is a gap in the window cluster:

- `src/tlisp/core/commands/windows.tlisp` exports `split-window-below`, `split-window-right`, `other-window`, `delete-window` — but NOT `delete-other-windows`. So `M-x delete-other-windows` yields nothing.
- The underlying primitives all exist and are tested: `window-list` (`window-ops.ts:177-193`), `window-current` (lines 199-205), and `window-close` (lines 147-171). `window-close` is already a no-op when only one window remains (lines 155-157: `if (windows.length <= 1) return Either.right(createNil())`), so the new command can call it freely without special-casing the last window.
- The `C-w` prefix is already wired for window commands (`windows.tlisp:24` binds `C-w` → `editor-window-prefix`). The Emacs `C-x 1` is off-limits per SPEC-067 (`C-x` is vim decrement), so the binding should live under the existing `C-w` window prefix or be M-x-only.
- `rg delete-other-windows` across `src/`, `test/`, and `docs/specs/` returns zero hits (confirmed) — the command is genuinely absent.

## Solution Statement

Add `(defun delete-other-windows)` to `src/tlisp/core/commands/windows.tlisp`. The body captures `(window-current)` once, computes how many OTHER windows exist (`(window-count)` minus 1), and calls `(window-close)` that many times — but every close must re-check that the current window is still the one to keep, because `window-close` always closes the CURRENT window (it does not take an index; see `window-ops.ts:147`). The correct loop is therefore: while more than one window remains, if the current window is the one to keep, move to another window first (`(window-next)`), then `(window-close)`. This avoids closing the window we want to keep.

Concretely, the simplest correct formulation: repeatedly, while `(> (window-count) 1)`, if `(= (window-current) keep-index)` call `(window-next)` (so a sibling becomes current), then `(window-close)` (closes the now-current sibling). When the count drops to 1, the survivor is `keep-index`'s window (the indices compact, but the survivor is always the window that was at `keep-index`). Add a `(message ...)` for observability.

Export `delete-other-windows` in the `defmodule` export list (line 2). Bind it under the `C-w` window prefix family if the prefix dispatcher supports a follow-on key (mirroring Emacs `C-x 1` as `C-w o` or similar); otherwise leave it M-x-only. Do NOT add a `C-x` binding (SPEC-067).

## Relevant Files

Read these files before implementing:

- **`src/tlisp/core/commands/windows.tlisp`** — the window command module. `delete-window` (lines 19-21) is the existing single-window close; the `C-w` prefix is bound at line 24. Add `delete-other-windows` here and export it on line 2.
- **`src/editor/api/window-ops.ts`** — the window primitives this command composes. `window-close` (lines 147-171) closes the CURRENT window and is a no-op when only one remains (lines 155-157) — cite this. `window-current` (lines 199-205) returns the current index. `window-next` (lines 111-123) cycles the current index. `window-list` (lines 177-193) and `window-count` (lines 211-217) are available for the loop bound. Note `window-close` does NOT take an index argument — it always closes whichever window is current — which is why the loop must rotate the current window before closing.
- **`src/tlisp/core/commands/execute-extended-command.tlisp`** — `command-detail-interactive-p` (lines 15-19): a docstring alone makes `delete-other-windows` M-x-discoverable.
- **`docs/specs/SPEC-067-vim-parity-implementation.md`** — `C-x` is the vim decrement prefix. The Emacs `C-x 1` binding is therefore off-limits; this spec must NOT propose any `C-x` binding and uses the existing `C-w` window prefix instead.

### New Files

- **`tmax-use/playbooks/eval-30-delete-other-windows.yaml`** — the e2e playbook (see Test Plan). Authored by the playbook-writing workflow.

## Implementation Plan

1. **Add the defun.** In `src/tlisp/core/commands/windows.tlisp`, after `delete-window` (line 21), add:
   ```lisp
   (defun delete-other-windows ()
     "Close every window except the current one (maximize current window).
   Composes window-current/window-next/window-close. No-op when only one
   window remains. SPEC-067: bound under the C-w window prefix, not C-x 1."
     (let ((keep (window-current)))
       (while (> (window-count) 1)
         ;; window-close always closes the CURRENT window, so if the current
         ;; window is the one we want to keep, rotate to a sibling first.
         (when (= (window-current) keep)
           (window-next))
         (window-close))
       (message "Deleted other windows")))
   ```
   Rationale for the `when` guard: `window-close` (`window-ops.ts:147`) closes the current window unconditionally; without rotating off `keep` first, the loop would close the window we intend to keep. The guard rotates to a sibling, then closes it. Because `window-close` is a no-op at count 1, the loop terminates safely.
2. **Export it.** On line 2, change `(export split-window-below split-window-right other-window delete-window)` to include `delete-other-windows`.
3. **(Optional) binding.** If the `C-w` prefix dispatcher (`editor-window-prefix`, referenced at `windows.tlisp:24`) supports follow-on keys, bind `C-w o` (Emacs muscle memory) or `C-w 1` → `delete-other-windows`. If the prefix only dispatches single commands, leave `delete-other-windows` M-x-only for this spec. Never use `C-x` (SPEC-067).
4. **Verify the survivor.** Confirm by test that after `delete-other-windows`, the single remaining window is the one that was current at call time (its buffer/cursor are intact, not some sibling's).

## Test Plan

- **e2e playbook `eval-30`** (assigned). Key assertions:
  - Split into 2 windows (`(split-window-below)`), then `(delete-other-windows)` → `(window-count)` is `1`; the survivor is the window that was current before the call (assert via its buffer/cursor, not just index).
  - No-op case: `(delete-other-windows)` with one window → `(window-count)` stays `1`, no error.
  - Split into 3+ windows (`split-window-below` twice), then `(delete-other-windows)` → exactly `1` window remains, and it is the originally-current one (this is the index-shift regression test — proves the loop does not skip or over-close).
  - Buffers survive: the buffers that were displayed in the closed windows are still in `(buffer-list)` (close-window does not kill buffers).
  - M-x discoverability: `delete-other-windows` appears in M-x completion.
  - Observable message: `"Deleted other windows"` lands in `*Messages*`.
- **Unit/integration coverage.** Extend the window test (wherever `split-window`/`window-close` are tested — likely `test/unit/editor.test.ts` or a window-ops test) with: split → `delete-other-windows` → count is 1 and the survivor is correct; the 3-window case; the no-op case. The primitives themselves (`window-close`, `window-current`, `window-count`) are already covered; this test exercises the composition + the index-shift logic.
- **Regression.** `delete-window` (single-window close) is unchanged. The `C-w` prefix binding (`windows.tlisp:24`) is unchanged.

## M-x Discoverability

A function appears in M-x completion IFF it has a docstring OR a keybinding, per `command-detail-interactive-p` in `src/tlisp/core/commands/execute-extended-command.tlisp:15-19`. `delete-other-windows` gets a docstring, which alone satisfies the predicate — it will appear in M-x completion. (The optional `C-w o` binding under the existing window prefix is a bonus for keyboard reachability matching Emacs muscle memory, not a discoverability requirement.) This matches the existing `windows.tlisp` convention where `split-window-below`/`split-window-right`/`other-window`/`delete-window` each carry a docstring.
