# SPEC-213: Fikra thread core (minimal main-thread subset)

**Issue:** #213 (fikra-p1 / RFC-027 §D3, §D7, §Phase 1)
**Status:** Implemented 2026-08-21

## Goal

The MINIMAL Phase-1 thread subset: one implicit "main" thread per project —
state machine, persistence, reopen-after-restart, project-root detection.
No thread creation/list/worktrees (Phase 4). Replaces the old globals
(fikra-message-history / fikra-turn-status-val in chat.tlisp are #216's
cleanup).

## Design

`src/tlisp/core/fikra/thread.tlisp` (module `fikra/thread`; requires
fikra/event + fikra/chat):

- **Project root**: `git rev-parse --show-toplevel` (cwd fallback). Thread
  state lives under `<root>/.tmax/fikra/threads/main/` (gitignored).
- **init**: create/load the main thread; wire FAEP's log at the thread's
  events.jsonl (FAEP is the only integration seam). Idempotent.
- **open/reopen**: init + create `*Fikra*` when absent (buffer-list check —
  buffer-exists-p is not a global) + attach its buffer-local keymap + REPLAY
  the full log into the buffer — the daemon-restart path.
- **Persistence** (state.json via json-encode/read): id, backend,
  session-id, runtime-mode, turn-count. `status` is RUNTIME-ONLY — a thread
  left "running" by a crash loads back as idle (pinned), turn-count
  survives (pinned). Forward-compatible load: persisted fields overlay
  fresh defaults; unknown fields ignored.
- **State machine** (checked, illegal transitions error): idle→running→
  {idle|error|interrupted}; running→confirming→running; error/interrupted
  recover to running. `to=idle` is always legal (open/reset path).
- **Turn lifecycle** (#214's adapter drives): turn-begin bumps turn-count,
  sets running, emits turn-start (turn field emitted as a NUMBER — FAEP's
  replay normalizes numeric-or-string turn fields); turn-end is the
  AUTHORITATIVE end (§D3 — checkpoint capture is #217's async follow-up and
  never blocks the next turn), emits turn-end and maps completed→idle,
  interrupted→interrupted, else error.
- session-id setter persists immediately (#214 calls it on the first init
  event).

## Completion Criteria

- [x] init creates `.tmax/fikra/threads/main` under the git root (macOS
      realpath-normalized in test) and wires FAEP (log-path pinned).
- [x] session-id persists and survives a fresh editor (pinned).
- [x] Crash-mid-turn loads back idle with turn-count intact (pinned).
- [x] Legal lifecycle transitions + confirming round-trip + interrupt FROM
      confirming (approval-pending interrupt — #210 sweeps the prompt to
      reject) (pinned); illegal transitions error (pinned). turn-begin
      validates the transition BEFORE bumping and persists the bumped count
      (a crash mid-turn still shows the turn happened) (pinned).
- [x] cwd fallback trimmed (gate catch: untrimmed pwd output).
- [x] Turn begin/end emit turn-start/turn-end with correct statuses;
      turn-end "error" settles error (pinned via log kinds + status).
- [x] Reopen replays history into `*Fikra*` for a fresh editor (pinned);
      fresh repo opens with empty `*Fikra*`, no crash, no log file.
- [x] `.tmax/` gitignored (the first append attempt silently failed —
      `||` bound to `head`; fixed with grep -q).
- [x] Tests: test/unit/fikra-thread.test.ts (9 — incl. illegal-begin-does-
      not-bump) + fikra-event updated for numeric turn fields (9). typecheck all projects green; fikra suites
      70/70 (thread, event, mode, primitives, keymap-local, io-encode).

## Notes

- Buffer ops used are GLOBAL primitives only (buffer-list/buffer-create/
  buffer-set-read-only/buffer-switch); buffer-exists-p is module-scoped.
- The security hook flagged execSync in the test — switched to
  execFileSync with an args array (constant command, but free hygiene).
- #214 wires its adapter: turn-begin/turn-end + set-session-id + FAEP
  log path via init; #216 replaces chat.tlisp's globals.
