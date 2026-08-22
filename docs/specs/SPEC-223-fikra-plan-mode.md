# SPEC-223: Fikra plan interaction mode

**Issue:** #223 (fikra-p5 / RFC-027 §Phase 5)
**Status:** Implemented 2026-08-22

## Goal

Plan as a thread INTERACTION MODE (t3code model: `default`/`plan` — a
thread property, not an event): `SPC a p` toggles; plan turns run
READ-ONLY and propose a markdown plan; the y/e/n approval flow gates the
implementation turn.

## Design

`src/tlisp/core/fikra/plan.tlisp` (new):

- **Interaction mode**: the thread field `interaction` (persisted in
  state.json; unset = default). `fikra-plan-toggle` (SPC a p) flips it
  and clears any pending approval when leaving plan mode.
- **Read-only plan turns**: `fikra-plan-claude-flags` = the NATIVE
  `--permission-mode plan` (claude's recorded 2.1.195 surface has it)
  PLUS `--disallowedTools Edit,Write,NotebookEdit,MultiEdit`
  belt-and-braces — a plan turn never edits. `fikra-backend-claude-args`
  substitutes these for the runtime-mode flags when the focused thread is
  in plan interaction (nil-safe detection).
- **Plan capture**: `fikra-plan-capture-from-log` parses the thread's own
  JSONL log (single pass; JSON per line, no string surgery) and collects
  the text-delta content after the LAST turn-start, excluding the user
  echo. The plan is ordinary FAEP content — diffable, checkpointed.
- **Approval flow** (`fikra-plan-offer-approval` when a plan turn
  completes): captures the plan, renders the familiar review prompt
  (a `permission-request` "plan review" event), binds y/e/n in the
  thread's chat buffer:
  - **y** `fikra-plan-approve`: interaction → default (the runtime mode
    resumes), a `plan-approved` decision event, and an IMPLEMENTATION
    turn whose prompt carries the plan ("Implement this plan: …").
  - **e** `fikra-plan-edit`: the plan round-trips through the writable
    `*Fikra-Plan*` buffer (writable AFTER switching to it —
    buffer-set-read-only acts on the CURRENT buffer); `y` there approves
    the EDITED text, `n` returns the plan unchanged (still pending).
  - **n** `fikra-plan-discard`: the thread goes idle, `plan-discarded`
    recorded, plan mode stays for the next attempt.

**Supporting changes**: `thread.tlisp` persists `interaction` (both write
paths kept in sync); `mode.tlisp` binds SPC a p (lazy require).

## Completion Criteria

- [x] SPC a p toggles plan/default; the property persists in state.json
      and reloads (pinned; unset-default vs explicit-default both pinned).
- [x] SPC a p registered via key-binding lookup (pinned).
- [x] Plan turns run READ-ONLY: claude args carry `--permission-mode
      plan` + `--disallowedTools Edit,…` (and never bypassPermissions);
      default turns keep the runtime-mode flags (pinned).
- [x] A plan-mode turn makes NO edits — the log holds no file-change or
      tool-call events; the plan itself is ordinary text-delta content
      (pinned).
- [x] The offer captures the plan (user echo EXCLUDED — pinned via
      captured content) and renders the review prompt in the chat buffer.
- [x] y spawns the implementation turn carrying the plan text;
      interaction returns to default; `plan-approved` recorded (pinned).
- [x] e round-trips the plan through the editable buffer; n returns the
      plan unchanged; the EDITED plan is what approves (pinned end-to-end
      including a second edit round after cancel).
- [x] n discards: thread idle, no implementation turn, plan mode stays,
      `plan-discarded` recorded (pinned).
- [x] typecheck green; fikra-plan 13/13; the fikra batch green (modulo the
      documented load flakes).

## Gate round — the wiring + isolation findings (all fixed)

- **The offer had NO production call site** (test-only): the turn-end
  LIFECYCLE fn now offers automatically on a completed plan-interaction
  turn (lazy require; every backend gets it — the sentinel path).
- **Approval state was module-global against #222's per-thread model** (a
  toggle on B cleared A's pending; a stray y could approve A's plan into
  focused B): pending/text are thread-keyed maps; toggle/discard/approve
  touch only the focused thread's entries.
- **Trust promotion could contradict the plan deny list**: plan turns now
  NEVER carry `--allowedTools` (deny precedence by construction — the
  flag is simply absent in plan interaction; pinned WITH accumulated
  trust, and restoration after leaving plan mode).
- New pins: the auto-offer from turn-end (echo excluded from the captured
  plan), cross-thread isolation, the interaction field's reopen reload,
  and the empty-log capture → nil. The no-edits evidence: argv-level (the
  flags) is the real guarantee; the replay fixture's event log is
  consistent with it by construction.

## Notes

- The offer fires from the turn-end LIFECYCLE fn (every backend's
  sentinel path); emitting a bare turn-end EVENT does not offer.
- Backends without a native plan preset fall back to the strictest flags
  + `--disallowedTools` (the same fn reads naturally for both).
