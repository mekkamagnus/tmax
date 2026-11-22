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
