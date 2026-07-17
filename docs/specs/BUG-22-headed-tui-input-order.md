# Bug: Headed TUI input chunks execute out of order

## Bug Description

The `eval-20-vim-search` tmax-use playbook passes through the headless JSON-RPC key path but fails when all key steps are driven through a real TUI in tmux. The headed failure occurs on the mixed key sequence `:nohl<Enter>`: instead of executing the complete Ex command and returning to normal mode, Enter can be processed before all characters in the preceding `:nohl` terminal chunk have finished. The remaining `o` is then interpreted as the normal-mode open-line command, which switches the editor to insert mode, and the trailing `h`, `l`, plus the playbook's subsequent `n` are inserted into the new line as `hln`.

Expected behavior: terminal input must be applied in arrival order. `:nohl<Enter>` must execute exactly as colon, `n`, `o`, `h`, `l`, Enter; the editor must return to normal mode, retain the search pattern, leave the buffer unchanged, and allow the following `n` to move to the next match.

Actual behavior: the TUI's asynchronous `stdin` data callbacks can overlap at `await remote.handleKey(...)`. The separately delivered Enter chunk can overtake the still-processing literal chunk, leaving the editor in insert mode with an extra line containing `hln`. The final search assertion then reads the wrong line and fails.

The reproduced results are:

- `bin/tmax-use test tmax-use/playbooks/eval-20-vim-search.yaml` -> **PASS** (`1 passed`).
- `bin/tmax-use test tmax-use/playbooks/eval-20-vim-search.yaml --headed --session tmax` -> **FAIL** (`0 passed, 1 failed`), with line 4 containing `hln` and the status line showing `--INSERT--`.
- The full headed playbook directory run reports `29 passed, 1 failed`; the only failure is `eval-20-vim-search.yaml` with the same state corruption.

## Problem Statement

The native TUI does not serialize terminal `data` events. A single logical key sequence may arrive in multiple chunks, and each chunk starts an independent async callback. When a later chunk arrives while an earlier chunk is awaiting a daemon response, keys from the later chunk can be sent to the daemon before the earlier chunk is complete. This violates the editor's required FIFO input semantics and makes mixed literal/special-key sequences unreliable in both tmux automation and real interactive terminals.

## Solution Statement

Serialize all TUI `stdin` chunks through one FIFO promise chain in `src/client/tui-client.ts`. A chunk must not begin tokenization or key dispatch until the preceding chunk has completed all `remote.handleKey`, render, and render-event work. Keep `pendingInput` inside the serialized processing path so split escape sequences remain ordered. Handle errors inside each queued operation so one rejected chunk does not permanently poison the queue, while preserving the existing `EDITOR_QUIT_SIGNAL` cleanup behavior.

Add a deterministic unit seam that can hold the first chunk's key dispatch open, enqueue a second chunk, and prove the second chunk does not start until the first finishes. Add a headed tmax-use regression playbook that sends `:nohl<Enter>` through tmux and asserts that mode and buffer state remain correct. Do not add sleeps between tmux dispatch groups and do not change search or `:nohl` semantics; timing delays would only mask the production TUI ordering defect.

## Steps to Reproduce

1. From the project root, ensure an existing tmux session named `tmax` is available:
   ```bash
   tmux has-session -t tmax
   ```
2. Run the failing playbook with every key step promoted to the headed tmux path:
   ```bash
   bin/tmax-use test tmax-use/playbooks/eval-20-vim-search.yaml --headed --session tmax
   ```
3. Observe that the last assertion fails:
   ```text
   cursor on second TARGET line post-nohl:
   result_contains: "TARGET lazy dog" NOT found in eval result
   ```
4. Inspect the captured headed frame. Line 4 contains `hln`, and the status line shows `--INSERT--`.
5. Run the headless control:
   ```bash
   bin/tmax-use test tmax-use/playbooks/eval-20-vim-search.yaml
   ```
6. Observe that the same playbook passes headlessly, proving the search implementation and assertions are valid and isolating the defect to the headed TUI input path.

## Root Cause Analysis

`tmax-use/test/runner.ts` deliberately converts `:nohl<Enter>` into tmux dispatch instructions using `parseKeys()` and `tmuxDispatch()`. The resulting instructions are five literal keys followed by one named key:

```json
[
  { "kind": "literal", "value": ":" },
  { "kind": "literal", "value": "n" },
  { "kind": "literal", "value": "o" },
  { "kind": "literal", "value": "h" },
  { "kind": "literal", "value": "l" },
  { "kind": "named", "value": "C-m" }
]
```

`dispatchHeadedKeys()` batches consecutive instructions by kind. It therefore sends `:nohl` with `tmux send-keys -l` and Enter with a second `tmux send-keys C-m` call. This split is necessary because tmux literal and named keys have different dispatch rules; completing the first tmux subprocess only proves that tmux accepted the bytes, not that the TUI finished applying them.

`src/client/tui-client.ts` currently registers an async event listener directly:

```ts
process.stdin.on("data", async (chunk: string) => {
  const tokens = tokenizeTerminalInput(chunk, pendingInput);
  for (const key of tokens.keys) {
    const state = await remote.handleKey(key);
    // render + sendEvent
  }
});
```

Node/Bun does not await an async event listener before emitting the next `data` event. The first callback yields on `remote.handleKey(":")`; the Enter chunk can then start a second callback and call `remote.handleKey("\n")` while the first callback still has `n`, `o`, `h`, and `l` pending. This permits the observed interleaving. After an early Enter exits command mode, `o` runs as a normal-mode command, creates a new line, and enters insert mode; `h`, `l`, and the later search `n` become the visible `hln` corruption.

The headless path does not reproduce the bug because `TmaxClient.keys()` awaits each JSON-RPC `keypress` request in a single loop. The existing search unit coverage and the passing headless playbook further rule out `search-next`, `search-clear-highlights`, and `:nohl` command semantics as the cause.

## Relevant Files

Use these files to fix the bug:

- `src/client/tui-client.ts` - Owns terminal `stdin` processing. Replace overlapping async `data` callbacks with a FIFO queue while preserving tokenization, rendering, error reporting, and quit cleanup.
- `test/unit/tui-client-input-order.test.ts` - New deterministic unit coverage for cross-chunk ordering and queue recovery after a dispatch error.
- `tmax-use/playbooks/headed-tui-input-order.yaml` - New real-TUI regression that drives a mixed literal/Enter command through tmux and asserts the editor remains in normal mode without buffer corruption.
- `tmax-use/playbooks/eval-20-vim-search.yaml` - Existing end-to-end reproduction and post-fix validation for `:nohl` followed by `n`; its assertions should not be weakened.
- `tmax-use/test/runner.ts` - Reference for the headed dispatch boundary. No timing workaround is expected here; its split literal/named tmux writes expose the TUI bug correctly.

### New Files

- `test/unit/tui-client-input-order.test.ts` - Proves terminal chunks are processed strictly FIFO even when the first key dispatch is delayed.
- `tmax-use/playbooks/headed-tui-input-order.yaml` - Reproduces the user-visible mixed-chunk ordering failure through a real tmux TUI.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1: Add deterministic FIFO processing for TUI input chunks

**User Story**: As a tmax user, I want terminal input to execute in the order I typed it so that commands containing both text and special keys behave deterministically.

- In `src/client/tui-client.ts`, extract the per-chunk async work into a small testable function or queue seam without changing terminal token semantics.
- Replace the direct async `process.stdin.on("data", ...)` listener with a non-blocking listener that appends each received chunk to one promise chain.
- Tokenize and update `pendingInput` only when that chunk reaches the head of the queue.
- Within each queued chunk, continue awaiting every `remote.handleKey`, render call, and `remote.sendEvent("render", ...)` before advancing to the next key or chunk.
- Preserve the existing handling for `EDITOR_QUIT_SIGNAL`, ordinary keypress errors, status rendering, and cleanup.
- Catch and handle errors per queued chunk so the shared chain resolves again and later terminal input is still accepted.
- Do not introduce arbitrary delays, debounce behavior, key coalescing, or changes to tmux dispatch.

**Acceptance Criteria**:
- [ ] A later `stdin` chunk cannot invoke `remote.handleKey` until all keys in the previous chunk have completed.
- [ ] Keys within each chunk preserve tokenizer order.
- [ ] Split escape-sequence state in `pendingInput` is updated within the same serialized ordering boundary.
- [ ] One handled keypress error does not permanently block subsequent chunks.
- [ ] Quit-signal cleanup behavior remains unchanged.
- [ ] No sleep or timing constant is added to make the test pass.

### Task 2: Add unit regression coverage for cross-chunk ordering

**User Story**: As a TUI maintainer, I want a deterministic test for overlapping terminal chunks so that FIFO input cannot regress without being detected.

- Create `test/unit/tui-client-input-order.test.ts` against the testable queue seam from Task 1.
- Use a deferred promise to pause dispatch of the first chunk after it starts.
- Enqueue a second chunk while the first is paused and assert that none of the second chunk's keys have reached the fake remote.
- Release the first chunk and assert the final dispatch order for the equivalent of `:nohl` followed by Enter is exactly `:`, `n`, `o`, `h`, `l`, `\n`.
- Add a recovery case where one chunk's handler rejects and verify the next queued chunk still executes after the error is reported.
- Keep tokenizer-specific escape-sequence assertions in their existing tokenizer tests; this test should focus on async ordering.

**Acceptance Criteria**:
- [ ] The ordering test fails against the current overlapping-listener behavior and passes with the FIFO queue.
- [ ] The test proves the second chunk remains blocked while the first chunk is unresolved.
- [ ] The final key order is asserted exactly, not by set membership or partial containment.
- [ ] The error-recovery test proves later input is not lost after a handled failure.
- [ ] `bun test test/unit/tui-client-input-order.test.ts` passes.

### Task 3: Add a headed tmax-use regression playbook

**User Story**: As a tmax user, I want a real-terminal regression test so that command input ordering is verified through tmux, the TUI tokenizer, JSON-RPC, and editor mode handling together.

- Create `tmax-use/playbooks/headed-tui-input-order.yaml` with `name: headed-tui-input-order`.
- Set up a small file with known content and open it in normal mode.
- Send `:nohl<Enter>` in a step marked `headed: true` so the playbook creates a real tmux TUI even without `--session`.
- Assert that the editor returns to normal mode and that the original line content remains exact; include a screen assertion when useful to prove the headed renderer shows normal mode.
- Add a subsequent real key that has an observable normal-mode effect, then assert it was executed as a command rather than inserted as text.
- Keep `cleanup: true` and do not weaken the existing `eval-20-vim-search.yaml` assertions.

**Acceptance Criteria**:
- [ ] The new playbook fails before the fix through the same input-ordering defect.
- [ ] The playbook sends mixed literal and named terminal input through a real tmux TUI.
- [ ] The playbook detects both wrong mode and buffer corruption.
- [ ] `bin/tmax-use test tmax-use/playbooks/headed-tui-input-order.yaml --headed` passes after the fix.
- [ ] `bin/tmax-use test tmax-use/playbooks/eval-20-vim-search.yaml --headed --session tmax` passes without changing its expected results.

### Task 4: Run focused and full validation

**User Story**: As a maintainer, I want the TUI ordering fix validated across unit, headed, headless, type-safety, and full regression gates so that it is safe to ship.

- Re-run the exact headed reproduction and confirm the captured frame remains in normal mode with no `hln` insertion.
- Re-run the headless control to confirm behavior remains unchanged.
- Run the new focused unit test and the existing terminal input/tokenizer tests.
- Run all required source, test, and full-project typechecks.
- Run the complete unit suite and complete tmax-use suite.
- Confirm no `tmax-use-*` tmux session/window or isolated server process remains after the test run.

**Acceptance Criteria**:
- [ ] The original headed `eval-20-vim-search` reproduction passes.
- [ ] The new headed regression playbook passes.
- [ ] The headless `eval-20-vim-search` control still passes.
- [ ] All targeted unit tests pass.
- [ ] `bun run typecheck:src`, `bun run typecheck:test`, and `bun run typecheck` pass with zero errors.
- [ ] `bun run test:unit` passes with zero regressions.
- [ ] `bun run test:tmax-use` passes with zero failures.
- [ ] Test cleanup leaves no headed test window or daemon orphan.

## Tests & E2E Playbooks

This bug must be verified by both unit tests and a tmax-use e2e playbook. Author them as part of the implementation.

### Unit tests

- Create `test/unit/tui-client-input-order.test.ts` to verify FIFO processing of separate terminal chunks with a deliberately unresolved first dispatch.
- Assert the exact combined order `:`, `n`, `o`, `h`, `l`, `\n`.
- Add a queue-recovery test showing that a handled rejection does not block the next chunk.
- Re-run `test/unit/frontend-input.test.ts` and `test/unit/remote-editor.test.ts` to guard tokenizer and JSON-RPC response behavior adjacent to the changed TUI path.
- Run the required full unit gate with `bun run test:unit`.

### tmax-use e2e playbook

- Create `tmax-use/playbooks/headed-tui-input-order.yaml`.
- The playbook must opt into headed dispatch explicitly with `headed: true`, drive `:nohl<Enter>` as one logical sequence, assert mode remains `normal`, and prove the fixture buffer was not modified.
- Run it locally with `bin/tmax-use test tmax-use/playbooks/headed-tui-input-order.yaml --headed`.
- Retain `tmax-use/playbooks/eval-20-vim-search.yaml` as the broader search regression and run it headed against the existing `tmax` session.

### New Files

- `test/unit/tui-client-input-order.test.ts` - Deterministic unit regression for FIFO terminal chunk processing and queue recovery.
- `tmax-use/playbooks/headed-tui-input-order.yaml` - User-visible real-TUI regression for mixed literal and Enter input.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions.

- `bin/tmax-use test tmax-use/playbooks/eval-20-vim-search.yaml --headed --session tmax` - Reproduce before the fix; after the fix it must pass and retain `TARGET lazy dog` after `:nohl` then `n`.
- `bin/tmax-use test tmax-use/playbooks/eval-20-vim-search.yaml` - Headless control; must continue to pass.
- `bin/tmax-use test tmax-use/playbooks/headed-tui-input-order.yaml --headed` - Focused real-TUI regression; must pass without a pre-existing tmux session.
- `bun test test/unit/tui-client-input-order.test.ts` - Run deterministic FIFO and error-recovery unit coverage.
- `bun test test/unit/frontend-input.test.ts test/unit/remote-editor.test.ts` - Verify terminal tokenization and remote response handling remain correct.
- `bun run typecheck:src` - Validate production TypeScript contracts.
- `bun run typecheck:test` - Validate test TypeScript contracts.
- `bun run typecheck` - Validate the complete project TypeScript configuration.
- `bun run test:unit` - Run unit tests with zero regressions.
- `bun run test:tmax-use` - Run all tmax-use e2e playbooks and TypeScript tmax-use tests with zero failures.
- `tmux list-windows -a -F '#{session_name}:#{window_index} #{window_name}' | rg 'tmax-use-'` - Must produce no stale headed test windows after cleanup.
- `ps -Ao pid,ppid,command | rg 'tmax-use/test/cli.ts|src/server/server.ts|tmaxclient --tui'` - Inspect for test-owned orphan processes; none from the completed validation run may remain.

## Notes

- No new library is required.
- The fix belongs in the production TUI input path because real terminals can also deliver one logical sequence across multiple `data` events. Adding a delay in `tmax-use/test/runner.ts` would hide the defect only for automation and would remain timing-dependent.
- The existing search behavior is not the defect: the same playbook passes headlessly, and search/`:nohl` semantics already have unit coverage in `test/unit/search-navigation.test.ts`.
- `--session tmax` promotes every playbook key step to headed dispatch, which exposed this bug. The separate observation that `--headed=strict` currently does not enable headed mode is out of scope for BUG-22 and should be tracked independently rather than folded into this fix.
- The working tree already contains unrelated user changes. Implementation must preserve them and touch only the files named by this spec.
