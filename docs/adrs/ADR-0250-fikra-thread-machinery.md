# ADR-0250: Fikra thread machinery — per-thread buffers, disk-truth listing, soft-delete archive

**Date:** 2026-08-22
**Status:** Accepted
**Issue:** #222
**Spec:** SPEC-222

## Context

RFC-027 §D7 Phase 4: threads beyond `main` — creation, listing,
switching, archive. Phase 1's subset hard-wired one `*Fikra*` buffer and
one in-memory registry entry; the event renderer checked
`buffer-current == "*Fikra*"` literally.

## Decision

1. **Per-thread chat buffers.** `fikra-thread-buffer-name` — `*Fikra*`
   for main (back-compat with every existing test/binding), 
   `*Fikra-<id>*` otherwise — is the single source every module consults
   (the literal is gone from event/capture/approvals/chat/thread).
   Concurrent threads stream to separate buffers; switching replays each
   thread's own FAEP log into its own buffer, so isolation holds by
   construction.
2. **Thread listing reads DISK, not the registry.** The in-memory
   registry forgets threads across restarts; `fikra-thread-ids` lists
   `.tmax/fikra/threads/` (the registry stays the state cache).
   List FILTERING (archived exclusion) is a rows-level concern — disk
   truth keeps everything.
3. **Archive is a soft delete.** A flag in state.json; main is exempt.
   Real deletion belongs to the retention policy (which already exports
   diffs on worktree close).
4. **Generated ids `fix-<n>`** — first free number on disk (collision-
   safe across restarts). Children inherit the parent's runtime mode:
   a `full-access` parent spawns `full-access` children.
5. **The cycle rule holds**: event↔thread remains lazy-required inside
   the render functions.

## Consequences

- Switching threads is a focus change: state, log pointer, buffer, and
  modeline all follow the focused id; nothing about other threads
  changes.
- The list buffer's rows are a VIEW (pad-tolerant of older state.json
  shapes); actions (RET/d/n) operate through the same thread fns the
  keymap exposes.
- Multi-project grouping (zcode model) waits on multi-root daemons; the
  group-by-root structure is in place.
