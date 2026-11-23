# ADR-0325 — The consult layer: idle timers, the on-input hook, the grammar

**Issue:** #311 · **Spec:** [SPEC-311](../specs/SPEC-311-grep-consult.md)
**Status:** accepted · **Date:** 2026-11-25

## Context

RFC-031 §2.4's consult-grade interactive search on the landed
#307/#308/(#310-branch) substrate.

## Decisions

1. **Idle timers as a per-context TS table** mirroring the watcher:
   idempotent cancel (the T-Lisp side cancels unconditionally on
   every exit — unknown ids no-op), Either-aware callback logging,
   and an `idle-timer-count` seam so "no orphan timers" is a
   TESTABLE invariant, not a hope.
2. **The on-input hook lives in the minibuffer engine** (not the
   consult module): fired from `minibuffer-refresh-after-input` —
   every input-change path (insert, delete, history replace) flows
   through it — and torn down in `minibuffer-close` so EVERY exit
   (accept, cancel, error) cleans up. A condition-case guards the
   callback: a throwing hook can never wedge the minibuffer.
3. **The grammar is a flat left-to-right scanner** (`##` → literal
   `#`; the first unescaped `#` the boundary; the glob side keeps
   its `#`s as ordinary characters) — no regex, no backtracking,
   testable as a pure function on every shape the issue names.
4. **Glob matching via TRANSLATION to the existing regex engine**:
   `*`/`?` → `.*`/`.`, anchored; matched against full relative path
   strings. The ≥1-positive-no-negative combination threads through
   nil-safe truthiness (`string-match` returns a NUMBER — 0 is a
   MATCH; only `(null x)` is the miss).
5. **The preview pane is the issue's own permitted reduction**:
   the find-file + exact-line helper landed; the OURS/BORROWED pane
   lifecycle needs renderer/window primitives beyond the tested
   surface — named as a follow-up in SPEC-311, not silently
   dropped.

## Consequences

- One debounce + one process invariant (`idle-timer-count` = 0)
  holds across the whole state machine by construction.
- The completedSnapshot discipline (only COMPLETION updates it) is
  enforced structurally: no code path writes it except the
  completion hook — a killed partial stream can never become the
  restore target.

## Addendum — valve rounds 1–2 (2026-11-23)

The verify-gate (r1: 9 defects, r2: 5 incl. the zombie-prompt
render stomp, r3: 13/13 criteria + 4 residuals) and the codex valve
(r1: 5/10, six TOP_FIXES) drove three decisions beyond the original
design:

- **Exit-kind threading, not cancel-functions.** `minibuffer-close`
  passes `"accept"|"cancel"` to the on-close hook rather than
  growing `completing-read` a cancel-function parameter. One seam,
  enriched; `completing-read`'s signature stays stable for its other
  callers. Ordering matters: close precedes the accept fn, so the
  cancel contract must branch on the KIND, not on session state.
- **Structural snapshot restore.** The input-change/cancel restore
  uses `grep-buffer-rollback` to the completed generation — content
  AND hits/selection/state — not a text re-render over a newer
  generation's structural state. A text-only restore left RET and
  navigation disagreeing with the display.
- **Class-escaped glob translation.** The T-Lisp reader strips
  backslashes from string literals, so `\.`-style regex escapes
  are unwritable in .tlisp source. Literal glob characters
  class-escape instead (`[.]`, `[$]`, …); `[class]` passes through
  verbatim (fnmatch `[^…]` negation composes); the unescapable set
  (bare `^`, backslash, `[]`) is untranslatable — the entry is
  ignored with a status note.
- **The prompt's candidates are the hits.** The completion table
  returns the current generation's hits; Up/Down select; a
  `minibuffer-on-select` hook echoes; RET resolves the selected
  value to its hit row and jumps via #307. The r1 spec's
  free-text-table narrowing was a misread of the issue's
  Navigation clause (corrected in SPEC-311).
