# Chore: Render verification hardening

## Chore Description
Three improvements to prevent the BUG-06 regression pattern where syntax highlighting was reported as "fixed" but wasn't working in the actual running editor:

1. **Render integration test** — Add a test that calls `captureFrame()` end-to-end and asserts actual ANSI escape codes appear in rendered output. Current tests only check `computeHighlightSpans` and `highlightLine` in isolation, never running the full render pipeline to ANSI strings.

2. **Demo runner `--verify` mode** — Add a `--verify` flag to the demo runner that, after running a playbook, captures the screen and checks for expected ANSI sequences. This catches cases where the daemon is stale or highlighting is broken.

3. **Demo runner daemon restart** — Change `ensure_daemon()` to always restart the daemon when `--speed 0` or `--verify` mode is used, ensuring fresh TypeScript modules are loaded. Currently it skips if a daemon is already running, reusing a stale process.

## Relevant Files

- `test/unit/syntax/markdown-highlight.test.ts` — Existing highlight tests that stop at span level. Will add a new `describe` block with render-pipeline integration tests.
- `src/render/capture-frame.ts` — `captureFrame(state, width, height)` renders an `EditorState` to ANSI lines. Used by the new integration tests.
- `src/core/buffer.ts` — `FunctionalTextBufferImpl.create(content)` needed to construct `EditorState` with buffer content.
- `src/core/types.ts` — `EditorState` interface definition.
- `demos/demo-runner.py` — Demo runner that needs `--verify` flag and daemon restart logic.

### New Files

- None. All changes to existing files.

## Step by Step Tasks

### Task 1: Add render integration test for markdown highlighting

**User Story**: As a developer, I want a test that exercises the full render pipeline (buffer → highlight spans → ANSI output) so that theme changes are validated end-to-end, not just at the span level.

- Add a new `describe` block `"markdown syntax highlighting — render pipeline (ANSI output)"` in `test/unit/syntax/markdown-highlight.test.ts`
- Create a helper function that builds an `EditorState` with a `FunctionalTextBufferImpl` containing markdown content, then calls `captureFrame(state, 80, 24)` and returns the rendered lines
- Write tests:
  - `"heading renders with 24-bit color escape"` — put `# Hello` in buffer, call `captureFrame`, assert a rendered line contains `\x1b[38;2;224;108;117m` (heading red)
  - `"bold renders with bold + orange escape"` — put `**bold**` in buffer, assert rendered line contains `\x1b[1m` and `\x1b[38;2;209;154;102m`
  - `"link renders with blue underline escape"` — put `[text](url)` in buffer, assert rendered line contains `\x1b[38;2;97;175;239m`
  - `"plain .txt file renders with no color escapes"` — set `currentFilename` to `"test.txt"`, assert no `\x1b[38;2;` sequences in rendered output
  - `"all markdown token types produce ANSI escapes"` — construct a buffer with one line per token type (heading, bold, italic, link, code, blockquote, list-item, etc.), call `captureFrame`, assert each rendered line contains at least one `\x1b[` escape sequence (proving style was applied, not falling through to empty default)

**Acceptance Criteria**:
- [ ] New test block has at least 5 tests
- [ ] Tests call `captureFrame()` end-to-end, not just `computeHighlightSpans`
- [ ] Tests assert actual ANSI escape bytes in rendered output, not just style objects
- [ ] `bun test test/unit/syntax/markdown-highlight.test.ts` passes

### Task 2: Add `--verify` flag to demo runner

**User Story**: As a developer running a demo in CI or pre-commit, I want a `--verify` flag that checks rendered output contains expected ANSI styling, so that broken highlighting is caught automatically.

- Add `--verify` argument to the argparse parser in `demos/demo-runner.py`
- When `--verify` is set, after all steps complete, capture the screen via `tmaxclient --capture`
- Check the captured output for at least one ANSI 24-bit color escape (`\x1b[38;2;` or `\x1b[48;2;`)
- If no color escapes found, print `FAIL: No syntax highlighting detected in rendered output` and exit with code 1
- Optionally: if the playbook has a `verify_highlight: true` top-level key, also run the ANSI check. This allows playbooks to opt-in to verification without the `--verify` flag.
- Add `verify_highlight: true` to `demos/markdown.yaml`
- Print `✓ Syntax highlighting verified in rendered output` on success

**Acceptance Criteria**:
- [ ] `--verify` flag accepted by demo runner
- [ ] `python3 demos/demo-runner.py demos/markdown.yaml --speed 0 --verify` passes when highlighting works
- [ ] Demo runner exits non-zero when no ANSI color escapes found in captured output
- [ ] `demos/markdown.yaml` has `verify_highlight: true`

### Task 3: Add daemon restart to demo runner for --speed 0 and --verify

**User Story**: As a developer, I want the demo runner to always start a fresh daemon in `--speed 0` and `--verify` modes so that stale TypeScript modules don't mask bugs.

- Modify `ensure_daemon()` in `demos/demo-runner.py` to accept a `force_restart` parameter
- When `force_restart` is `True`, stop any existing daemon (`tmaxclient --stop` or `tmax --stop`) before starting a new one
- In `run_playbook()`, pass `force_restart=True` to `ensure_daemon()` when `dry_run=False` and (`speed == 0` or `verify=True`)
- Add a brief sleep (1s) after stopping to allow socket cleanup before starting the new daemon

**Acceptance Criteria**:
- [ ] `ensure_daemon(force_restart=True)` stops existing daemon before starting new one
- [ ] `--speed 0` always gets a fresh daemon
- [ ] `--verify` always gets a fresh daemon
- [ ] Normal visual demos (speed > 0, no --verify) reuse existing daemon as before

### Task 4: Validate everything end-to-end

- Run `bun run typecheck:src` and `bun run typecheck:test`
- Run `bun test test/unit/syntax/markdown-highlight.test.ts`
- Run `python3 demos/demo-runner.py demos/markdown.yaml --speed 0 --verify`

**Acceptance Criteria**:
- [ ] All type checks pass
- [ ] All tests pass
- [ ] Demo runner with `--verify` exits 0

## Validation Commands
- `bun run typecheck:src` — Source TypeScript compiles
- `bun run typecheck:test` — Test TypeScript compiles
- `bun test test/unit/syntax/markdown-highlight.test.ts` — All highlight tests pass including new render pipeline tests
- `python3 demos/demo-runner.py demos/markdown.yaml --speed 0 --verify` — Demo validates ANSI highlighting in rendered output

## Notes
- The render integration test is the most valuable change — it would have caught BUG-06 without needing a daemon at all.
- The `--verify` flag and daemon restart are defense-in-depth for the daemon/client path specifically.
- Keep the demo runner changes minimal — this is a chore, not a rewrite.
