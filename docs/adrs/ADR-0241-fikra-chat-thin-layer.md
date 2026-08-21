# The Fikra chat UI as a thin layer; acyclic fikra modules

## Status

Accepted (2026-08-22, #216 / [SPEC-216](../specs/SPEC-216-chat-ui-thin-layer.md))

## Context

Phase 1's substrate (FAEP, threads, adapters, replay) needed a chat UI wired
to it — and the old chat.tlisp globals, the capture double-eval bug, and
three module dependency cycles stood in the way.

## Decision

chat.tlisp is a THIN layer: open = thread-open (history replay) + buffer-
local keymap + dynamic lighter; send = FAEP user text + backend start-turn;
status delegates to the thread state machine. Lazy `require-module` inside
keymap-bound commands is THE pattern for breaking module cycles without
losing the SPC a UX (mode↔chat, mode↔capture, chat↔thread all broken this
way). thread.tlisp hardens: un-initialized reads as idle; fikra-thread-state
LAZY-INITIALIZES with init's full contract so pre-init turn lifecycle from
backends can't crash or write to an unwired log.

Test discipline landed with it: temp-git-repo-per-test isolation for every
suite that touches thread state (repoDirs-array cleanup), and the
`bun test --timeout 20000` batch mechanism (per-test timeout objects are a
bun-types dead end).

## Consequences

- Fikra Phase 1 complete: FAEP → threads → adapters → replay → chat UI, all
  keyless-testable via backend-replay.
- The gate saga (4 rounds + fresh-cycle re-gate) is itself the record: it
  caught the shared-log test coupling, a LOST edit (applied + verified +
  absent from the tree — cause undetermined), and a temp-dir leak. The
  accounting is in the spec; the discipline is the point.
- #219 inherits: TAB tool-block expand, per-FAEP-event lighter hook, and
  the init-after-lazy-init state-reload edge.
