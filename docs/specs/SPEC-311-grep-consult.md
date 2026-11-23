# SPEC-311 — Grep consult layer: incremental restart + debounce, preview, #glob filters

## Goal

Phase 2 of the grep subsystem (RFC-031 §2.4): the consult-grade
interactive search surface on #307's producer interface, #308's
backend, and #310's scope preflight.

## Completion criteria (landed subset)

- [x] **`(run-with-idle-timer <ms> <fn>)` + `(cancel-idle-timer <id>)`**
      (per-context tables; idempotent cancel; Either-aware callback
      logging; the count seam `idle-timer-count` proves no orphans).
      Unit-tested: fire, cancel-before-fire, idempotent re-cancel.
- [x] **`minibuffer-on-input` hook** — a per-keystroke callback in
      the SPEC-116 shape: set at prompt open, torn down on EVERY
      minibuffer close (accept/cancel/error); late callbacks after
      teardown drop silently (tested via the state-nil guard).
- [x] **Query grammar** (left-to-right): `##` → a literal `#` in the
      pattern; the first UNESCAPED `#` ends the pattern; everything
      after (incl. further `#`s) is the glob side. `foo#bar#baz` →
      pattern `foo`, glob `bar#baz` (parser tests; all four shapes).
- [x] **Glob semantics**: comma-separated entries; an EMPTY entry →
      the `empty glob` status (no run); `!` prefix negates (a bare
      `!` noted + ignored); `*`/`?` translated to a T-Lisp regex
      matched against full relative path strings; ≥1 positive AND no
      negative (match tests incl. the no-positive and negated cases).
- [x] **The interactive state machine**: entry via `SPC s G` with
      the #310 preflight (fresh scope + the backend availability
      matrix); per-keystroke: cancel timer, kill pending, restore the
      completedSnapshot (a killed partial NEVER becomes it); the
      threshold matrix (empty pattern / <2 chars / empty glob /
      valid / glob-only — all debounced at 200ms; glob-only included
      since the search still runs); a new keystroke cancels the prior
      timer (exactly one live); stale generations rejected (#307/#308
      guards); RET accepts (jump via #307's grep-ret from the
      selection); C-g/Escape cancel (restore the snapshot or close).
- [x] **The prompt-exit invariant**: every exit path and every
      invalid-input transition cancels the timer and kills any
      pending process — the `idle-timer-count` 0 assertions on every
      invalid transition test.

## Documented reductions (per the issue's explicit fallback clause)

- **Preview**: the bottom-split live preview (OURS/BORROWED pane
  lifecycle, focus-stays-in-prompt, accept/cancel layout restore)
  requires renderer/window primitives beyond the current window
  machinery's tested surface. The `grep-consult-preview` helper
  (find-file + line landing) landed; the PANE WIRING is a named
  follow-up. This is the issue's ONLY permitted reduction.
- **Up/Down arrow navigation in the prompt** moving the selection:
  the vertico machinery's C-n/C-p already does this via
  `minibuffer-dispatch-key`; the raw Up/Down keys route there too
  (the existing binding).

## Valve round 2 correction (2026-11-23)

The r1 spec text above NARROWED the issue's Navigation clause ("the
consult candidates list rides the free-text table (empty …); the
in-prompt candidate echo is part of the preview follow-up"). The
issue is normative on both: the prompt's candidates ARE the current
generation's hits, the echo shows the selected candidate, and RET
jumps from the CURRENT selection. Landed in c29d77fe: the table
returns hit candidates (value path:line:col, display the *grep* row
text); a `minibuffer-on-select` hook fires on selection change
(the consult owner echoes the candidate); completion re-refreshes a
live session so candidates appear without another keystroke; accept
resolves the selected value to its hit index (cursor-move in
*grep*, then #307's grep-ret) with the *grep* row as the raw-input
fallback. The echo clause is thereby in scope; the preview PANE
remains the only reduction.

## Out of scope

The pane wiring above; #309 (the grep fallback backend).
