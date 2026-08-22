# SPEC-222: Fikra thread/project machinery — creation, list, switching, archive

**Issue:** #222 (fikra-p4 / RFC-027 §D7, §Phase 4)
**Status:** Implemented 2026-08-22

## Goal

Everything beyond Phase 1's single-main-thread subset: thread creation
with generated ids (SPC a t), the *Fikra-Threads* list buffer (SPC a T),
thread switching (focus/buffer/modeline), per-thread chat buffers, and
soft-delete archive.

## Design

**thread.tlisp** (#222 additions):

- `fikra-thread-buffer-name`: PER-THREAD chat buffer — main keeps the
  historical `*Fikra*` (back-compat), other threads get
  `*Fikra-<id>*`. Nil-safe (events can render before any focus). All the
  former `*Fikra*` literals in event/capture/approvals/chat/thread now go
  through it — concurrent threads stream to separate buffers.
- `fikra-thread-new` (SPC a t): generated `fix-<n>` id (first free number
  on disk), **child inherits the parent runtime mode** (#219 state), own
  state dir + chat buffer, focused. `let*` (the id binding reads root —
  parallel `let` saw an unbound symbol).
- `fikra-thread-switch`: focus + FAEP log re-point + chat buffer +
  rebuild from THAT thread's log + lighter refresh. Concurrent threads
  keep independent state (status/turn-count belong to the focused id).
- `fikra-thread-archive`: soft delete — sets `archived` in state.json,
  refuses on main; `fikra-thread-archived-p` reads disk (a restarted
  editor sees it). Disk truth keeps listing the dir; LIST FILTERING
  (rows) excludes archived.
- `fikra-thread-ids` / `fikra-thread-rows`: disk listing of the project's
  `.tmax/fikra/threads/` (registry-only would forget threads across
  restarts); rows carry id/backend/mode/location(local|worktree)/status/
  turns for the non-archived set.

**threads.tlisp** (new): the `*Fikra-Threads*` buffer — header with the
project root grouping label, column rows with a `▶` selection marker,
buffer-local keymap: `j`/`k` (+arrows) move, `RET` switches, `d` archives
+ refreshes, `n` creates. Render resets the cursor before rewriting
(buffer-insert is cursor-relative) and the turns column pads (nil-safe
for disk rows from older state formats).

**event.tlisp**: lazy `require-module fikra/thread` in emit-batch +
rebuild (the event↔thread cycle forbids top-level).

**mode.tlisp**: `SPC a t` (new thread) + `SPC a T` (list), lazy requires.

## Completion Criteria

- [x] New thread: generated fix-1 id, own state dir + own buffer focused,
      ids increment (fix-2 …) (pinned).
- [x] Child threads inherit the parent runtime mode (pinned).
- [x] Switch swaps focus, FAEP log pointer, buffer, and modeline; each
      thread's buffer replays ONLY its own log — no cross-thread content
      bleed (pinned both directions).
- [x] Two live threads keep independent turn/status state — main running
      turn 1, the new thread idle/0; switching back restores (pinned).
- [x] Archive hides from rows (disk truth still lists it — soft delete),
      main refuses, a fresh editor sees the archived flag from state.json
      (pinned).
- [x] The list renders the project label + every non-archived thread with
      the location column — `local` and, for a worktree thread,
      `worktree` (pinned).
- [x] j/k move the selection with end-clamping; RET switches to the
      selected thread's buffer; d archives + refreshes without the
      archived thread (pinned).
- [x] SPC a t / SPC a T registered (pinned via key-binding lookup).
- [x] typecheck green; fikra-threads 8/8; the full fikra batch green
      (modulo the documented load flakes).

## Notes

- Project grouping is by the CURRENT project root (the editor session's
  cwd); the zcode multi-project listing rides multi-root daemons (future)
  — the row/group structure is ready for it.
- Per-thread PROCESSES: each thread's backend spawn uses the thread's own
  working dir + session state (from #213/#221); multiple live turns run
  concurrently by construction (process-per-turn).
