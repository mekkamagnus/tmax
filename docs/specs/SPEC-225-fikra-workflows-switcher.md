# SPEC-225: Fikra workflows re-bound to threads + backend switcher

**Issue:** #225 (fikra-p5 / RFC-027 §Phase 5 + RFC-013 §T-Lisp API)
**Status:** Implemented 2026-08-22

## Goal

Close the RFC-013 workflow surface now that threads exist: the workflows
(SPC a e/f/r/g + review) create-or-append LABELED threads instead of
one-shot calls; the backend switcher (SPC a b) switches mid-conversation
with the event log carrying over; custom workflows register from
init.tlisp (thread-aware).

## Design

`src/tlisp/core/fikra/workflow.tlisp` (rewritten):

- **Labeled threads**: `fikra-workflow-open label prompt` reuses the
  thread whose state.json `workflow` field equals the label (disk scan —
  survives restarts) or creates one (`fikra-thread-new`, runtime-mode
  inheritance rides #222) and records the label via the set-field+save
  path. Repeated invocations APPEND turns to the SAME conversation.
- **Context snapshots FIRST** (`fikra-build-context` before the thread
  switch — switching threads switches the current buffer to the
  workflow's chat buffer; reading context after the switch captured the
  empty chat buffer). `fikra-build-context` unchanged in contract
  (user-overridable via setq; buffer-mode→major-mode-get — the old
  `buffer-mode` symbol never existed).
- **Custom workflows**: `fikra-register-workflow name prompt` +
  `fikra-run-named-workflow name` (own labeled thread; unknown refused
  with a status). The RFC-013 defmacro shape reduces to this function
  pair (defworkflow's :context/:on-response keys were never implemented
  anywhere; the registration pair is the honest surface).

**Thread state** (`thread.tlisp`): the `workflow` field persists in BOTH
write paths; `turn-begin` records the backend ACTUALLY driving the turn
(`fikra-turn-backend-name` — the adapter's current selection with the
thread field as fallback), so a mid-thread switch shows in turn-starts.

**Backend switcher**: `fikra-set-backend` (#214) is mid-conversation safe
by construction (FAEP logs are backend-agnostic); `fikra-start` (#225
probe catch) NO LONGER overrides an explicit backend selection — it only
auto-selects when the current backend is "none". `SPC a b` (existing
binding) remains the entry.

**chat-open focus fix**: init-or-load runs only when NO thread is focused
— a workflow that just created/switched its own thread must not be
dragged back to main.

## Completion Criteria

- [x] explain creates a labeled thread (`workflow: "explain"` in
      state.json), focused, with the specialized prompt + buffer context
      in its OWN log, turn-start present, streaming via replay (pinned).
- [x] Repeated invocations append (3 turns → 3 turn-starts in ONE
      thread; exactly one fix-* workflow thread exists) (pinned).
- [x] Each workflow gets its own labeled thread (explain→fix-1,
      fix→fix-2, prompts in the right logs) (pinned).
- [x] The label survives a restart (on-disk + a fresh editor's
      thread-for scan finds it) (pinned).
- [x] Workflow threads inherit the runtime mode (pinned).
- [x] Custom workflows register/run/list; unknown refused (pinned).
- [x] Backend switch mid-thread: the SAME event log continues, history
      intact, the second turn-start records the NEW backend (pinned).
- [x] Both real backends register + replay; the switcher binding exists
      (pinned).
- [x] fikra-start never clobbers an explicit backend selection (the
      probe catch — pinned implicitly by every workflow test running on
      the forced replay backend).
- [x] fikra-build-context includes file/mode/selection/buffer (pinned).
- [x] typecheck green; fikra-workflows 11/11 (incl. the archive-routing + origin-context gate pins); the touched-suite batch green.

## Gate round — routing + context-drift findings (all fixed)

- **Archive resurrection**: the label scan matched ANY thread with the
  workflow field — an ARCHIVED workflow thread would be resurrected and
  forever starve a same-labeled successor. The scan now skips archived
  rows AND archive clears the workflow label (belt and braces; pinned:
  archive → no route → a fresh fix-2 thread takes over).
- **Cross-invocation context drift**: after a workflow turn the user sits
  in the chat buffer, so a SECOND invocation snapshotted the chat
  transcript as "context". Each workflow now remembers its ORIGIN buffer
  (first invocation) and re-snapshots from it (pinned: the second
  invocation's echo carries the origin buffer's content, not the chat).

## Notes

- The replay backend refuses turns without a loaded fixture — tests load
  one per turn (a turn consumes a chunk).
- `SPC a b`'s available/●○o popup listing is the existing
  `fikra-backend-prompt` (first-available); a full picker buffer rides
  the threads-list UI pattern when wanted.
