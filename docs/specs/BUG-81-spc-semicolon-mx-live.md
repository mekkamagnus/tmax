# Bug: `SPC ;` (M-x entry) unreliable/broken in the LIVE embedded editor (engine-correct in fixtures)

## Goals

- `SPC ;` reliably opens M-x in the live editor, matching the engine behavior proven in unit fixtures.

## Completion Criteria (Definition of Done)

- [ ] Root cause identified from a live repro: WHY does `handleKey(" ")` + `handleKey(";")` enter mx mode in unit fixtures but not in the live embedded Steep editor?
- [ ] Fix landed; live e2e (tmux + the mekkapi tab): `SPC ;` opens the M-x prompt and a typed command dispatches.
- [ ] Unit regression added for whatever the live-specific cause was.
- [ ] `bun run typecheck` + key-handling suites green.

## Known facts (investigated 2026-08-15, discovered during SPEC-119 e2e)

- **Engine is correct**: in a unit fixture, `editor.handleKey(" ")` then
  `handleKey(";")` → mode flips to `mx` (probe committed alongside this spec's
  discovery session). `(keymap-ref (current-keymap) "SPC ;")` →
  `(execute-extended-command)`, `(keymap-prefix-p ... "SPC ;")` → false —
  the binding is exactly right.
- **Live embedded Steep is not**: with `tmux send-keys -l " "` then `-l ";"`
  the SPC popup appears but ";" does not dispatch — the popup persists and the
  mode stays normal. With tmux's NAMED key `Semicolon`, something weirder
  happens: an "l" + newline is inserted at the start of the buffer and the
  editor lands in INSERT mode (buffer damage, unsaved — discarded with :q!).
- **Inconsistent across delivery paths**: the same sequence worked once in the
  herdr pane (M-x opened, "No match" prompt shown) and failed on retry —
  suggests a race or input-tokenization difference on the ";" byte path
  (`src/frontend/render/input.ts` tokenizeTerminalInput) rather than the
  handler logic.
- Not caused by SPEC-119's branch: reproduces identically on main
  (`a702cfc`).
- Not config: no `~/.config/tmax/init.tlisp` exists.

## Likely suspects (unchecked)

- `tokenizeTerminalInput` handling of ";" (escape-sequence adjacency?).
- The which-key schedule callback racing the second key (fixture has no real
  terminal so `wk.schedule` may never fire there — the popup-active state
  machine may consume the key).
- The herdr-vs-tmux delivery difference (send-text vs send-keys encoding of
  ";").

## Relevant Files

- `src/frontend/render/input.ts` — key tokenization.
- `src/editor/handlers/normal-handler.ts` — SPC-leader handling + which-key schedule.
- `src/tlisp/core/bindings/normal.tlisp:283` — the "SPC ;" binding (verified correct).

## Severity

high — M-x is a primary entry point ("SPC ;" per README/CLAUDE.md); if it is
flaky live, every M-x-only command is hard to reach.
