# SPEC-310 — Grep scope commands: SPC s g (here) + SPC p s (project)

## Goal

The grep subsystem's user-facing entry points (RFC-031 §2.3) on the
#308 backend: fresh-detected scopes, the async free-text prompt, and
the retirement of the synchronous `*Search Results*` path.

## Completion criteria

- [x] **Scope resolution (FRESH, cache-bypassed for BOTH bindings)**:
      `(project-detect-root <start>)` runs on EVERY invocation — the
      `*project-root*` cache is bypassed (tested with a POISONED
      cache). Start path: the current buffer's file dir; no file →
      `process.cwd()`. `here`: no project → the start path itself.
      `project`: no project → the named status
      `not in a project — SPC s g searches from here`; no search, no
      buffer.
- [x] **The prompt**: the async free-text minibuffer (SPEC-116
      callback pattern); the label `grep (rg) <scope>: ` is truthful
      (backend detection runs BEFORE the prompt opens); empty input
      and C-g cancel with no side effects (tested: no process — the
      dump's gen=nil — no buffer, status cleared).
- [x] **Spawn-failure-after-accept** leaves an open results buffer
      intact — owned by #308's rollback (the deferral documented;
      the #308 test suite covers the behavior).
- [x] **Retirement**: project-search-cmd's sync TS-walk rendering is
      gone (a named deferral status; the `project-search` primitive
      stays); no `*Search Results*` test references remained to move.
      Both bindings verified through the REAL key-dispatch path
      (handleKey SPC/s/g and SPC/p/s).

## Notes

- The results buffer opens on the first hit (or at complete with no
  matches — #307's empty state); nothing here changes that.
- Which-key annotations: the SPC-s and SPC-p prefixes render through
  the existing which-key machinery (the key-binds register like any
  other; no annotation code was needed beyond the binds).
