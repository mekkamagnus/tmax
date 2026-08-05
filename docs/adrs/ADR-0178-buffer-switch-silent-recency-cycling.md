# ADR-0178 — `buffer-switch-silent` enables deterministic recency buffer cycling (#118 / SPEC-087)

## Status

Accepted

## Context

SPEC-073 shipped `next-buffer` / `previous-buffer` over a **stable insertion-order**
list (`buffer-rotation-list`) because the originally-intended **recency-sorted**
cycle was non-deterministic: `buffer-switch` bumps recency on every call
(`Editor`'s `setCurrentBuffer` callback runs `touchBuffer` unconditionally), so a
recency-sorted rotation recomputed each call ping-pongs between the two
most-recent buffers (`C→B→C→B…`) and never visits the rest. SPEC-073 recorded
this as an as-built deviation (insertion order == fresh-open recency at step 0,
so it passed eval-24 but diverged under sustained switching).

## Decision

Add a **non-self-bumping** switch path, then re-point the rotation at true recency.

1. **`Editor.switchBufferSilent(name)`** (`src/editor/editor.ts`, mirrors
   `buryBuffer`'s "Editor-owned recency mutator" pattern): performs everything
   the `setCurrentBuffer` callback does (current-buffer + filename + tab + window
   sync) **except** `touchBuffer`. Returns `name` (or `null` if not live).
2. **`buffer-switch-silent` primitive** (`src/editor/api/buffer-ops.ts`, mirrors
   `buffer-bury`): validates the name arg, requires the `switchBufferSilent`
   hook (no correct local fallback — the no-bump contract lives in Editor), and
   returns the switched name. Threaded through `EditorAPIContext` → the
   `tlispState` binding → the `createBufferOps(...)` call site (the exact
   `buryBuffer` wiring chain).
3. **`next-buffer` / `previous-buffer`** (`src/tlisp/core/commands/buffers.tlisp`)
   now rotate over **`buffer-recency-rotation`** (recency-sorted, most-recent-
   first, non-special — a new helper that filters special buffers out of
   `buffer-recency-list`, which includes `*scratch*`/`*Messages*`) and switch via
   `buffer-switch-silent`. Direction: next = `(mod (+ idx 1) len)`; previous =
   `(mod (+ idx (- len 1)) len)` — the `+ (len-1)` form (not `(- idx 1)`)
   because T-Lisp `mod` is raw JS `%` and does not wrap negatives (Codex
   correction). The interactive `switch-buffer` / `find-file` path is unchanged
   and still bumps recency.
4. `buffer-rotation-list` (insertion-order) is retained with a "superseded by
   SPEC-087" comment (CLAUDE.md §3 — don't delete pre-existing code).

The public primitive inventory grows 366 → 367 (`buffer-switch-silent`) and the
Editor public-method surface gains `switchBufferSilent`; both CHORE-44 baselines
(`api-names-static.txt`, `editor-methods.txt`) + the registry count are updated.

## Consequences

- A full rotation is now deterministic by **true recency**: from C (newest) over
  {C,B,A}, `(next-buffer)` × 6 yields `B,A,C,B,A,C` (no ping-pong), and
  `(previous-buffer)` × 3 yields `A,B,C`. The idx=0 wrap (previous from the
  most-recent) lands on the least-recent, not an error. Pinned by extended
  `eval-24` (sustained-cycling + idx=0-wrap + interactive-bump-preserved).
- Interactive buffer selection (`switch-buffer` / `SPC x b` / `find-file`) is
  unchanged and still promotes the chosen buffer to most-recent — asserted by
  the new eval-24 "find-file B → B is most-recent non-special" step.
- SPEC-073's as-built deviation banner is marked **Resolved by SPEC-087**.
- `buffer-recency-list` (all buffers, recency-sorted) stays available for
  completion tables; `buffer-recency-rotation` (non-special) is the rotation
  source — two distinct helpers for two distinct needs.
