# SPEC-274 — the pausing fixture backend: the L2 gate exercised (#303)

## Goal

Exercise the `[y] Allow [n] Reject [a] Always` gate's full loop — pause →
decision → resume — in a graded capture, without a live CLI (the
installed claude lacks `--permission-prompt-tool`; live mediation is the
fikra-native-backend arc's named follow-up, honestly out of scope here).

## The fixture backend (`src/tlisp/core/fikra/backend-pausing.tlisp`)

Replay's sibling: streams a scripted turn up to a permission-request,
then PAUSES awaiting an out-of-band decision (a recorded variable the
pump polls — not keystrokes, not a CLI), then streams the branch
matching the decision to turn-end. Permission chunks carry EXPLICIT
`tool`/`scope` fields (the fixture declares the pair; the live event
format's pair question is the live follow-up). Matching = exact pair
equality.

- `y` allows THIS request (the allow-continuation branch streams).
- `n` rejects (the denial branch renders; clean turn-end).
- `a` persists per-thread: the thread record carries an
  `approval-allow-list` of (tool, scope) pairs — persisted in
  state.json (both json-encode writers carry it: the main save and the
  background-session writer)
  and reloaded threads retain it (tolerant of the json alist round-trip).
  The NEXT matching pair SKIPS the pause; a non-matching pair (either
  field differs) still pauses — tested across a save/reload.
- Thread state machine honored: pause sets confirming; finish walks
  confirming → running → idle (the legal approval round-trip edges).

## Completion criteria

- [x] Pausing fixture backend with the poll-based decision seam;
      scripted allow/deny/always branches
- [x] y/n/a each drive the correct branch; `a` persists per-thread and
      suppresses the next matching pause; thread-scoped only (a sibling
      thread with an empty allow-list pauses on the same pair; both
      non-match axes — tool-differing and scope-differing — pause)
- [x] Graded capture: the full pause→decide→resume frame sequence
      (the pause frame with the [y/n/a] prompt; the resumed frame gains
      the continuation + completion — the answered popup stays as
      append-only history). The DECISION renders in the frame:
      permission-allowed/permission-denied now have renderer cases
      (= allowed [this request | always for this tool+scope] / =
      denied — the turn ended) — gate r1 caught them log-only
