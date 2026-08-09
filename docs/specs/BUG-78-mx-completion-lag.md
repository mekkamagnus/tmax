# Bug: M-x completion is visibly laggy on every keystroke

## Bug Description

When the user types in the M-x minibuffer, the completion list updates with
noticeable lag (feels "dragging"). Root cause: the completion table sources
**all 1,164 visible callables** via `callable-command-details` on every
keystroke, then filters + renders the full list. Only ~50-80 of those are
user-facing commands; the rest are internal helpers.

**Expected:** M-x shows only interactive commands (~50-80), updates smoothly.
**Actual:** M-x shows 1,164 candidates, lags on every keystroke.

## Problem Statement

The M-x completion path runs `callable-command-details` on every keystroke,
constructing 1,164 hashmap candidates. The Orderless matcher filters them, the
Vertico-style renderer maps them to rows. This full pipeline runs per-key in the
minibuffer. The cost scales with candidate count — 1,164 candidates is ~15× more
than necessary.

## Solution Statement

Depends on SPEC-115 (`(interactive)` declaration). Once `defun` supports
`(interactive)`, the M-x completion table (`describe-function-table` /
`execute-extended-command`) filters to `interactive === true` only, reducing the
candidate list from 1,164 to ~50-80. A fallback (show all if none marked)
ensures graceful migration.

An independent performance fix (not blocked on SPEC-115): cache the
`callable-command-details` result per-editor-session (the list doesn't change
between keystrokes unless a module is reloaded). Re-derive only when a new module
loads.

## Steps to Reproduce

1. `tmax`
2. `SPC ;` (M-x)
3. Type `s` — the completion list takes a visible moment to filter 1,164 candidates.
4. Continue typing — lag on each keystroke.

## Root Cause Analysis

1. `callable-command-details` (describe-ops.ts) enumerates every visible callable
   (visible global bindings + module exports) — currently 1,164 functions.
2. The M-x completion table (`describe-function-table` in describe.tlisp) calls it
   on every completion action (every keystroke).
3. The Orderless matcher + Vertico renderer process all 1,164 candidates.
4. No caching — the same 1,164 hashmaps are rebuilt on every keystroke.

## Relevant Files

- `src/editor/api/describe-ops.ts` — `callable-command-details` enumeration.
- `src/tlisp/core/commands/describe.tlisp` — `describe-function-table` (M-x completion source).
- `src/tlisp/core/commands/execute-extended-command.tlisp` — M-x entry point.
- `src/tlisp/core/completion/minibuffer.tlisp` — the minibuffer refresh cycle.

## Notes

- Measured: 1,164 callables today (2026-08-09). Before SPEC-115 lands, the
  candidate list includes every internal helper, every TS primitive, and every
  module export — most of which are not user-facing commands.
- SPEC-115 (`interactive` declaration) is the structural fix. The caching fix is
  independent and can land first for an immediate performance improvement.
