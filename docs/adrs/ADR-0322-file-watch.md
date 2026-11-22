# ADR-0322 — Filesystem watching via node:fs.watch

**Issue:** #329 · **Spec:** [SPEC-329](../specs/SPEC-329-file-watch.md)
**Status:** accepted · **Date:** 2026-11-23

## Context

The issue sketched `Bun.watch` exposure. Bun 1.4.4 has NO
`Bun.watch` (probed at runtime) — `node:fs.watch` is the
verified-available watcher.

## Decisions

1. **node:fs.watch behind a T-Lisp primitive pair.**
   `file-watch-start` returns a per-API-context id; events eval the
   callback with the path HEX-ENCODED (#224's reader boundary — the
   callback name is a fixed validated symbol). `file-watch-stop` is
   IDEMPOTENT (the T-Lisp side clears registries unconditionally);
   `file-watch-list` is the inspection seam. The event payload uses
   the REGISTERED path (fs.watch's filename is basename-only and
   platform-unreliable — the registered path is the stable identity).
2. **auto-revert-mode is global, dirty-guarded, and OFF by default.**
   Global in v1 (buffer-local scoping rides a consumer need — the
   no-consumer-today caveat). One watch per DISTINCT path (buffers
   on one file share). The revert path is the
   switch-scan-revert-restore shape (#127's nameless-primitive
   class) with `buffer-modified-p` as the never-clobber guard.
3. **Callback evals are try/caught and logged** (a throwing callback
   must not take down the watcher loop).

## Consequences

- RFC-028/logseq-mode has its want satisfied at the primitive layer;
  flipping auto-revert on is one `setq`.
- Watches live for the API context's lifetime unless stopped — the
  mode's OFF path and `auto-revert-stop-all` are the cleanup seams.
