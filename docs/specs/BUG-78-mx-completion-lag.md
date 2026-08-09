# Bug: M-x completion is visibly laggy on every keystroke

## Bug Description

When the user types in the M-x minibuffer, the completion list updates with
noticeable lag (feels "dragging"), and opening M-x itself is slow. The M-x
candidate-build (`command-completion-refresh`: `callable-command-details` +
`filter` + `mapcar`) was **~280ms per M-x open** with no caching, and the
candidate set included all ~1,164 visible callables (only ~146 are real
commands).

**Expected:** M-x opens instantly after the first use in a session; the list
holds only commands.
**Actual (before):** ~280ms candidate-build on every M-x open; 1,164 candidates.

## Problem Statement

The M-x completion path runs `callable-command-details` on every keystroke,
constructing 1,164 hashmap candidates. The Orderless matcher filters them, the
Vertico-style renderer maps them to rows. This full pipeline runs per-key in the
minibuffer. The cost scales with candidate count — 1,164 candidates is ~15× more
than necessary.

## Solution Statement

Two fixes, both landed:

1. **Structural (SPEC-115 / #183):** `defun` `(interactive)` + the key-bound rule
   cut the candidate set from ~1,164 to ~146 (real commands only). Done.
2. **Caching (#182, this fix):** `command-completion-refresh` caches its result
   for the session, keyed on `module-registry-generation` (a counter that bumps
   on every module register/load). The build runs once; subsequent M-x opens
   return the cache (~0ms) unless a module loaded. The `minibuffer` benchmark
   dropped **~143×** (uncached ~280ms/call → cached ~0.4ms/call).

The uncached build cost (~280ms, dominated by the T-Lisp `filter`/`mapcar`
string-name dispatch) remains the first-open latency and is a separate
optimization target (not in scope here).

## Steps to Reproduce

1. `tmax`
2. `SPC ;` (M-x)
3. Type `s` — the completion list takes a visible moment to filter 1,164 candidates.
4. Continue typing — lag on each keystroke.

## Root Cause Analysis

(Measured by the `minibuffer` benchmark, CHORE-84/#184.)

1. `command-completion-refresh` (execute-extended-command.tlisp) builds the M-x
   candidate list on every M-x open: `callable-command-details` (enumerate ~146
   commands post-#183; was ~1,164) + `filter command-detail-interactive-p` +
   `mapcar command-detail-candidate`.
2. The build is **~280ms** — enumeration is ~15ms; the T-Lisp string-name
   `filter`/`mapcar` over the table dominates (~265ms).
3. No caching — the same ~280ms build ran on every M-x open, even though the
   command set only changes when a module loads.

## Relevant Files

- `src/tlisp/core/commands/execute-extended-command.tlisp` — `command-completion-refresh` (the cached candidate-build).
- `src/tlisp/module-registry.ts` — `getGeneration()` (the cache-invalidation token).
- `src/editor/editor.ts` — `callable-command-details` (the enumeration) + `module-registry-generation` primitive.
- `bench/micro-minibuffer.ts` — the `minibuffer` benchmark proving the win (CHORE-84/#184).

## Acceptance Criteria (Completion)
- [x] Root cause confirmed: the M-x candidate-build (`command-completion-refresh`) is ~280ms/open with no caching.
- [x] The candidate table is cached per editor session, re-derived only when a module loads (keyed on `module-registry-generation`).
- [x] M-x filters to interactive commands (SPEC-115 / #183 landed).
- [x] A `minibuffer` benchmark (CHORE-84 / #184) exists and shows the improvement (~143× faster once cached).
- [x] Manual repro (`SPC ;` → type): repeated M-x opens are instant after the first.

## Notes

- Measured (CHORE-84/#184 `minibuffer` bench): uncached candidate-build ~280ms;
  cached ~0.4ms. The ~280ms first-open cost is dominated by the T-Lisp
  string-name `filter`/`mapcar` dispatch, not enumeration — a separate
  optimization target.
- SPEC-115 (`interactive` declaration, #183) was the structural prerequisite;
  it cut the candidate set ~1,164 → ~146, which both shrinks the per-open build
  and the per-keystroke filter cost.
