# SPEC-216: Chat UI — thin layer over Phase 1

**Issue:** #216 (fikra-p1 / RFC-027 §UI, §Phase 1)
**Status:** Implemented 2026-08-22

## Goal

Wire the `*Fikra*` chat UI to the Phase-1 stack: threads own state (#213),
FAEP owns rendering (#212), adapters own turns (#214). Fix the known
skeleton defects (capture double-paren bug), retire the old globals, and
make the module dependency graph ACYCLIC.

## Design

**chat.tlisp** is now thin: `fikra-chat-open` = mode-start (caller's job)
→ thread-open (replay history) → ensure-buffer-keymap (#206 chain) →
refresh-lighter. `fikra-turn-send` emits the user text to FAEP then calls
`fikra-backend-start-turn`. `fikra-turn-interrupt` → backend abort (guard
from #214). `fikra-turn-status` delegates to the thread state machine. The
modeline rides `minor-mode-set-lighter` (#211): `fikra:<backend><state>`
with ●/◉/?/◈/✗; refreshed at the interactive entry points (#219 wires the
per-FAEP-event hook). The OLD globals (fikra-message-history,
fikra-turn-status-val) are gone.

**Acyclic module graph** (the dev fight of this issue — three cycles
found and broken):
- mode↔chat: chat no longer requires mode; the SPC a a binding runs
  `(fikra-start)` then lazy-`require-module fikra/chat`.
- mode↔capture: same — SPC a i lazy-requires capture; capture never
  requires mode (bindings imply mode is active).
- chat↔thread: thread no longer requires chat; chat-open attaches the
  buffer-local keymap AFTER thread-open returns.

**capture.tlisp**: the `((member ...))` double-eval bug FIXED; the
`buffer-switch "default"` fixture-artifact peek replaced (reads the
capture buffer directly); no-push/no-editor-mode builtins replaced
(cons-history, editor-set-mode); submit lazy-requires chat.

**thread.tlisp hardening** (found by driving chat through replay without
explicit init): `fikra-thread-status` reads un-initialized as idle (nil
never reaches string= transitions); `fikra-thread-state` LAZY-INITIALIZES
the main thread with init's full contract (mkdir + load + FAEP log
wiring) so backends firing turn lifecycle pre-init can't crash or write
to an unwired log.

## Completion Criteria

- [x] open: creates `*Fikra*`, attaches buffer-local keymap (RET →
      follow-link), minor mode active, backend set (pinned).
- [x] open replays thread history; re-open idempotent (pinned).
- [x] turn-send through the replay backend: user text + AI reply render;
      thread settles idle (pinned). No backend → nil + guidance (pinned).
- [x] Modeline lighter reflects backend + state; ◉ while running (pinned).
- [x] Capture regression: open→type→submit→SECOND open cycle works — the
      `((member))` bug is dead (pinned).
- [x] Old globals gone (defvar-level assertions); status delegates to the
      thread state machine (pinned).
- [x] fikra-mode.test.ts chat assertions updated to the thin-layer API.
- [x] TEST ISOLATION (gate round-2 catch, the decisive one): the #214
      real-subprocess abort test asserted exactly-1 turn-end in the SHARED
      repo-tree log (.tmax under the real git toplevel) — logs accumulated
      across runs, so run-2+ failed deterministically. backend-claude's
      suite now runs each test in its OWN temp git repo (beforeEach
      mkdtemp+git-init+chdir, afterAll restore). ACCOUNTING NOTE (gate
      round-3): the first application of this edit was LOST from the tree
      (cause undetermined — the verifier found it absent after my batch
      evidence was recorded); re-applied and re-verified AFTER that
      finding: two consecutive 61/61 batches with NO cleanup between and
      0 .tmax entries in the repo tree after both.
- [x] typecheck 4/4 green; ALL SIX fikra suites green TOGETHER, TWICE
      CONSECUTIVELY (61/61, 131s + 124s), via `bun test --timeout 20000
      <six suites>`. HONEST RESIDUAL: one earlier post-isolation batch
      pair hit a single unnamed 1-fail (load family, did not reproduce in
      two subsequent green batches); the 5s default also flakes
      systematically under six-suite load — the CLI flag is the mechanism
      (per-test timeout objects are a bun-types dead end).
- [x] workflow.tlisp lazy-requires fikra/chat before its calls (gate
      round-1 catch — removing mode's eager load left SPC a e/f/r/g/s
      entry points unguarded; workflow→chat is cycle-free).
- [x] Minor noted for #219: explicit init after a lazy-init reloads
      state.json, discarding unsaved in-memory turn-count.

## Notes

- Lazy `require-module` in keymap commands is the pattern for breaking
  module cycles without losing the SPC a UX.
- capture's history uses cons (no push builtin).
- TAB tool-block expand/collapse deferred with #219's richer chat work.
