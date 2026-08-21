# Fikra thread core: state machine, persistence, reopen

## Status

Accepted (2026-08-21, #213 / [SPEC-213](../specs/SPEC-213-fikra-thread-core.md))

## Context

Phase 1's minimal thread subset: one implicit "main" thread per project with
a checked lifecycle, durable facts, and daemon-restart reopen — the state
#214's adapter drives.

## Decision

`fikra/thread` (T-Lisp over #212's FAEP): project root = git toplevel;
state under `<root>/.tmax/fikra/threads/main/` (gitignored). init wires
FAEP's log (the only seam); open/reopen replays the full log into *Fikra*.
state.json persists DURABLE facts only (backend, session-id, runtime-mode,
turn-count); `status` is runtime-only — a crash-mid-turn loads back idle
with the count intact. The state machine CHECKS transitions (illegal moves
error; confirming→interrupted legal — interrupt during a pending approval);
turn-begin validates BEFORE bumping and persists the bumped count
immediately; turn-end is the authoritative §D3 end (checkpoints are #217's
async follow-up).

## Consequences

- #214 wires: init (log path) + turn-begin/end + set-session-id.
- Only global buffer primitives used (buffer-list membership —
  buffer-exists-p is module-scoped; the old chat.tlisp cross-module calls
  remain #214/#216's known breakage).
- Turn fields are emitted as numbers; FAEP replay normalizes
  numeric-or-string turn fields.
- The gate's two rounds caught: interrupt-from-confirming (added),
  validate-before-bump (reordered + pinned), untrimmed cwd, and a
  claim-accuracy error I made in an evidence comment (owned + corrected) —
  the adversarial loop is doing its job on reporting discipline too.
