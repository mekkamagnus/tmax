# Bug: `SPC ;` (M-x entry) unreliable/broken in the LIVE embedded editor (engine-correct in fixtures)

## Goals

- `SPC ;` reliably opens M-x in the live editor, matching the engine behavior proven in unit fixtures.

## Completion Criteria (Definition of Done)

- [x] Root cause identified from a live repro (chunk-level stdin instrumentation): (a) the repro's `;` was never delivered — tmux send-keys eats standalone `;` arguments as command separators; (b) latent real bug — concurrent dispatch of coalesced keys in src/steep/input.ts (`void this.handler(...)`), fixed by serialized dispatch. Full detail in Resolution below.
- [x] Fix landed; live e2e (tmux): `SPC ;` opens the M-x prompt — verified in both delivery patterns (separate writes and coalesced single chunk).
- [ ] ~~and a typed command dispatches~~ — **moved to #226 (BUG-83)**: verification uncovered that accepted M-x commands do not visibly execute (quit signal + errors swallowed in the minibuffer accept path). That is a separate accept-layer bug, not the #195 entry flakiness; this half of the original criterion belongs to #226's DoD.
- [x] Unit regression added for the live-specific cause (concurrent dispatch of coalesced keys): test/unit/steep-input.test.ts serialization suite + test/unit/spc-semicolon-mx.test.ts real-editor regressions.
- [x] `bun run typecheck` (all 4 projects, exit 0) + key-handling suites green (80 tests, 0 fail across steep-input, spc-semicolon-mx, terminal-input-tokenizer, steep-which-key, frontend-input, keymap-*, key-resolution-modes, macro-handler, steep/).

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

## Resolution (2026-08-21, #195)

**Verdict: the editor was not broken by the primary reported mechanism — the
repro methodology never delivered the `;`. One real latent bug was found and
fixed on the way.**

### Root cause (live-repro verified, tmux-instrumented)

1. **tmux `send-keys` eats any standalone `;` argument as its own command
   separator** — with or without `-l`. Verified by chunk-level instrumentation
   of the editor's stdin reader: `send-keys -l ";"` and `send-keys -l ' ;'`
   deliver only the space (chunk `raw=" "`); the `;` never reaches the
   process. `'a;b'` (one word containing `;`) passes through fine. The
   observed "popup appears but `;` doesn't dispatch" is fully explained: the
   which-key 1000 ms timer fired and rendered the SPC popup because no second
   key ever arrived.
2. **The `Semicolon` named-key damage** (`l` + newline inserted, INSERT mode):
   tmux does not recognize `Semicolon` as a key name and falls back to sending
   the literal text `Semicolon` — the letters type into the editor (`i`
   enters insert mode, etc.). Repro artifact, not an editor bug.
3. **Real latent bug (fixed): concurrent key dispatch.** `src/steep/input.ts`
   dispatched each tokenized key with `void this.handler(message)` — keys
   coalesced into one stdin chunk (real terminals do this on fast typing)
   ran CONCURRENTLY, so the second key could read leader/prefix state
   (`spacePressed`, `whichKeyPrefix`) before the first key's async
   `handleKey` had set it. The unit fixture passed only because it awaits
   each `handleKey` sequentially — this was the genuine engine-vs-live
   difference the issue suspected.

### Fix

`src/steep/input.ts`: serialized dispatch (`dispatchSerialized`) — a promise
chain per Input instance; every key runs to completion before the next, both
within a chunk and across overlapping chunks. Regression tests in
`test/unit/steep-input.test.ts` (no interleaving; second key observes
asynchronously-set leader state — the BUG-81 scenario; overlapping chunks
serialize; chain survives a rejecting handler).

### Live e2e (tmux, embedded Steep, after fix)

- Separate writes, `;` delivered via `paste-buffer` (immune to the tmux `;`
  parser quirk): `SPC` then `;` → **M-X mode**, probe confirms
  `spaceActive=true prefix="SPC"` at the `;`.
- Coalesced single chunk (`paste-buffer` of `" ;"`, one stdin read): both keys
  dispatch sequentially → **M-X mode**.
- Typed input in M-x reaches the minibuffer and Enter closes the session
  (mx → normal) — pinned in `test/unit/spc-semicolon-mx.test.ts`.

### Out-of-scope discovery → #226 (BUG-83)

While verifying the "typed command dispatches" criterion we found a SEPARATE
bug: accepted M-x commands do not visibly execute — `M-x editor-quit` does
not exit the editor (live and in-process; the quit signal is swallowed in the
minibuffer accept path), `M-x switch-to-buffer` prompts nothing, and command
errors never surface in the status line. That is an accept-layer execution
bug, not the #195 entry flakiness; filed as #226 with the evidence. #195's
scope (reliable M-x ENTRY) is complete.

### Repro-methodology note for future e2e

`tmux send-keys` cannot deliver a standalone `;` to a pane. Use
`printf ';' | tmux load-buffer - && tmux paste-buffer -t <pane>` (or embed
the `;` in a longer literal). This quirk likely explains the historical
herdr-vs-tmux flakiness in this issue's reproduction attempts.
