# SPEC-266 — fikra thread root follows the client editor's project (#298)

## Goal

`fikra-thread-root` currently resolves the project root via `git rev-parse`
against the **daemon's process cwd**. A daemon started from repo A that serves
a client editing in dir B targets the WRONG project for every thread artifact
(root, log, ± rows, diff viewer, checkpoints, worktrees). The root must
resolve against the **client's working context** and be persisted on the
thread record as the single source every consumer reads.

## Normative design

- **Client context** = the current buffer's file directory when a file buffer
  is attached, else the connected client's launch directory, else the daemon
  cwd (embedded editors — identical to legacy behavior). The context dir is
  threaded into `fikra-thread-root` resolution at thread creation and
  **persisted** as `context-dir` on the thread record (`state.json`).
- **Resolution**: `git rev-parse --show-toplevel` executed with the context
  dir as the process cwd (`shell-command`'s new optional cwd argument — same
  capability as `make-process`'s `:cwd`; no cwd inheritance). Fallback: the
  context dir itself.
- **Client launch dir plumbing**: the TUI client sends `clientCwd` in the
  `connect-frame` handshake; the daemon stores it on the serving editor
  (transient runtime state, the `spacePressed` pattern) and exposes it to
  T-Lisp via the `client-launch-dir` primitive (nil when no client attached).
- **Legacy threads**: records persisted BEFORE this fix (no `context-dir`
  field) keep the legacy daemon-cwd resolution — no silent re-targeting of
  old threads — and are marked `legacy` in the thread list (location column).
- **Single source**: every consumer (thread log path, tree-diff/checkpoint,
  worktree ops, revert, diff viewer) reads the persisted root
  (`fikra-thread-field "root"`) and runs its git/shell steps with that root
  as cwd (`fikra-thread-root-shell`) — no consumer re-resolves independently
  or implicitly depends on the daemon cwd.

## Completion criteria

- [ ] Repro test: daemon cwd = dir A, client context = dir B (a git repo) →
      thread root, log, and diff artifacts (checkpoint refs) all land under
      B's `.tmax`; nothing writes into A.
- [ ] Legacy-thread test: a record without `context-dir` resolves via the
      daemon cwd and is labeled legacy in the thread list.
- [ ] Buffer-file context: attached client with a file open in dir C threads
      against C.
- [ ] `client-launch-dir` primitive: nil with no client; the connect-frame
      handshake stores the client's cwd on the editor.
- [ ] `shell-command` accepts an optional cwd argument; fikra's bare git call
      sites (checkpoint predicates, worktree, revert) run rooted at the
      persisted thread root.

## Out of scope

- The daemon-side interpreter/session split for `make-process` filter
  callbacks (separate streaming-render arc).
- Multi-root daemons / cross-project thread grouping.
