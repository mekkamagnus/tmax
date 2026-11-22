# ADR-0324 — Grep scope commands: fresh detection, truthful prompts

**Issue:** #310 · **Spec:** [SPEC-310](../specs/SPEC-310-grep-scope-commands.md)
**Status:** accepted · **Date:** 2026-11-24

## Context

RFC-031 §2.3's user-facing entry points on the landed #308 backend,
plus the retirement of the synchronous `*Search Results*` path.

## Decisions

1. **Fresh detection, cache bypassed.** Both bindings call
   `(project-detect-root <start>)` directly on EVERY invocation —
   `(project-root)` alone returns the `*project-root*` cache, and a
   stale cached root must not redirect a search. The shared cache is
   left untouched for `project-find-file`'s own semantics. The start
   path (buffer file dir → cwd) keeps reruns correct across
   cwd/file changes.
2. **`here` vs `project` asymmetry**: no project found → `here`
   searches from the start path itself; `project` refuses with the
   named status (no search, no buffer).
3. **The truthful prompt**: backend detection runs BEFORE the
   minibuffer opens, so `grep (rg) <scope>: ` never lies. The
   SPEC-116 async callback shape (not a sync read-string); empty
   input cancels with the dump's generation pinned nil.
4. **Retirement as a named deferral**: `project-search-cmd` returns
   a redirect status instead of the old TS-walk rendering (callers
   learn the new path, not silence); the `project-search` primitive
   stays for its tests.

## Consequences

- One search surface: `*grep*` everywhere; `*Search Results*` is
  gone from the keymap.
- The spawn-failure-after-accept contract (an open results buffer
  stays on its last completed generation) is #308's rollback —
  consumed here, tested there.
