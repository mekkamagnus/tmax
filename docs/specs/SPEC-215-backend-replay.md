# SPEC-215: backend-replay fixture adapter + module-load guard

**Issue:** #215 (fikra-p1 / RFC-027 §Testing, §Phase 1)
**Status:** Implemented 2026-08-22

## Goal

The keyless-CI keystone: a backend that drives the IDENTICAL pipeline real
backends run (normalize → FAEP batch → thread lifecycle) from recorded
fixtures — no network, no API keys, no CLI installs. Plus the module-load
guard closing the BUG-60 swallowed-parse-error failure mode.

## Design

`src/tlisp/core/fikra/backend-replay.tlisp` (module `fikra/backend-replay`;
requires adapter/event/thread/backend-claude):

- **Fixture format**: raw JSONL lines (the exact wire shapes backend-claude
  normalizes) with `###` separator lines ending chunks. No markers = one
  chunk. Blank lines skipped.
- **Identical-pipeline guarantee**: start-turn joins the next chunk's lines
  and feeds them through backend-claude's REAL line accumulator (reset via
  a new test seam — module vars aren't settable cross-module), so replay
  exercises the same drain + normalize + FAEP batch emission the live
  filter runs. Session events record the handle, mirroring the live path.
- **Synchronous turns**: a replay turn is instantaneous — turn-begin,
  feed chunk, turn-end "completed" — within one start-turn call. Running
  past the fixture ends empty turns (cursor saturates; no crash). No
  fixture loaded → nil + status message.
- Capabilities advertise a `replay` flag; available-p is always t.

Module-load guard (test/unit/fikra-replay.test.ts): every fikra module
parsePrograms Right from the repo path (not the chdir'd temp cwd), and a
deliberately broken module FAILS the tokenize stage (unterminated string →
Left). NOTE: parseProgram takes SOURCE (the first draft passed tokens —
a type error the compiler caught); paren imbalance alone is tolerated by
parseProgram and surfaces at module LOAD (the "Expected ')' to close list"
family seen in #212/#214 dev) — the guard's deterministic layer is the
tokenizer.

## Completion Criteria

- [x] Turn 1: session + text normalize to ONE FAEP batch; session-id
      recorded in thread state (pinned via log kinds + readback).
- [x] `###` markers: each start-turn feeds the next chunk (pinned).
- [x] Tool calls + results + unparseable lines flow through the real
      pipeline; unparseable produces NOTHING (pinned).
- [x] Past-fixture turns end empty; status stays idle; no crash (pinned).
- [x] No-fixture start-turn → nil (pinned). Capabilities/available (pinned).
- [x] Module-load guard, BOTH layers: 10 fikra modules parse clean
      (parseProgram) AND LOAD clean through the editor's real
      require-module path — the layer where the BUG-60 stray-paren class
      actually fails (gate round-1 catch; a fresh editor per module, 20s
      timeout — 10 editors exceed bun's 5s default). Broken module fails
      at tokenize (pinned).
- [x] e2e: fixture turns render into *Fikra* via thread-open; rebuild from
      disk is idempotent with the live buffer (pinned).
- [x] typecheck all projects green; suites green (replay 10 — incl. the
      load-path guard — event 9, thread 9, mode 11 = 39 across 4 files).

## Notes

- New test seam in backend-claude: `fikra-backend-claude-reset-accumulator`
  (exported; same rationale as adopt-process).
- `message` (T-Lisp) is not a global primitive — editor-set-status used.
- The replay backend is the substrate #216 (chat UI), #219 (L1 fixtures),
  and #220 (approval replay tests) build their keyless tests on.
