# ADR-0292 — fikra thread roots resolve from the client's working context

- **Status**: Accepted
- **Date**: 2026-11-21
- **Issue**: #298
- **Spec**: SPEC-266

## Context

`fikra-thread-root` resolved the project root by running `git rev-parse
--show-toplevel` through `shell-command`, which inherits the **daemon's
process cwd**. A daemon started from repo A serving a TUI client editing in
dir B put every thread artifact — root, FAEP log, checkpoint refs, worktree
ops, revert plans — in the WRONG project. This bit the user 4+ times in one
day (#298).

## Decision

1. **Client context chain** (T-Lisp owns the logic): the current buffer's
   file directory when a file buffer is attached → else the connected
   client's launch directory → else the daemon cwd (embedded editors —
   identical to legacy behavior). Computed by `fikra-thread-context-dir`
   (thread.tlisp).
2. **Client launch dir plumbing** (TS primitives only): the TUI client sends
   `clientCwd: process.cwd()` in the `connect-frame` handshake; the daemon
   records it on the serving editor via `Editor.setClientLaunchDir`
   (transient runtime state, the `spacePressed` pattern — not model state)
   after workspace activation; T-Lisp reads it via the `client-launch-dir`
   primitive (nil with no client).
3. **Resolution**: `git rev-parse --show-toplevel` executed with the context
   dir as the process cwd — `shell-command` gained an optional second
   (cwd) argument, the synchronous twin of `make-process`'s `:cwd`. No cwd
   inheritance, no `cd` chains.
4. **Persistence**: the context dir is stored as `context-dir` on the thread
   record (`state.json`, both write paths) and the root re-resolves from it
   on every load — one source. Child threads inherit the parent's context.
5. **Legacy threads**: a record with NO `context-dir` (pre-#298) keeps the
   legacy daemon-cwd resolution (`fikra-thread-root`, now legacy-only) and
   is flagged `legacy` — the thread list shows it in the location column.
   Old threads are never silently re-targeted.
6. **Consumers read the persisted root**: `fikra-thread-root-shell` runs a
   command with the record's root as cwd. The previously-bare git sites —
   checkpoint's `fikra-git-fikra-p`/`fikra-git-unborn-p`, worktree's
   ref-verify/dirty/enter/handoff/close/export, revert's entire plan, and
   backend-claude's mcp mkdir — now run rooted there. No consumer
   re-resolves independently.

## Consequences

- `shell-command`'s optional cwd is a general primitive (any caller can
  scope execution); the CHORE-44 baselines were refrozen
  (426→427 APIs, +2 Editor methods).
- `fikra-thread-load-row`'s return type stays the raw json alist
  (workflow.tlisp iterates it); row-for normalizes to a hashmap locally.
- Embedded editors are unaffected by construction (context falls back to
  the daemon cwd = the old resolution).
- Legacy records are IMMUTABLE in their legacy-ness: their loaded state
  carries a nil context-dir, so every save persists `"context-dir": null`
  and the record can never be silently migrated to a different project.
- The daemon-side interpreter/session split for `make-process` filter
  callbacks remains out of scope (separate streaming-render arc).

## Limitations

- `clientCwd` is client-supplied and used unvalidated as a process-cwd
  source; it is per-editor, last-connect-wins (a second client attaching
  to the same workspace overwrites the recorded launch dir). A client's
  dir is CLEARED when that client disconnects (value-equality guarded), so
  a stale context never outlives its client — but the clear cannot restore
  an earlier client's overwritten value. Acceptable for the local
  single-user daemon this serves; a multi-user daemon would need per-frame
  contexts.
