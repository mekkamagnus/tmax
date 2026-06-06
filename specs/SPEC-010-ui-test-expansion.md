# Feature: UI Test Suite Expansion (Tests 17–24)

## Feature Description
Add 8 new UI tests covering implemented but untested editor features: count prefix, text objects, yank ring, macro recording, window splitting, config loading, indentation, and T-Lisp module loading. These features have unit tests and T-Lisp API bindings but no end-to-end UI test coverage.

## User Story
As a tmax developer
I want comprehensive UI test coverage for all implemented editor features
So that regressions are caught before they reach users

## Problem Statement
16 UI tests cover basic editing, modes, navigation, visual mode, buffers, undo/yank, search, rendering, and buffer completion. But 8 implemented features have zero UI test coverage: count prefix (`3j`, `5dd`), text objects (`diw`, `ci"`), yank ring (`M-y`), macro recording (`qa..q..@a`), window splitting (`C-w s/v/w/q`), config loading (`init.tlisp`), indentation, and T-Lisp module loading.

## Solution Statement
Create 8 new test files (17–24) following existing patterns. Most use daemon mode (fast, direct state queries). Window splitting uses daemon-tmux mode (needs TUI rendering). Register each in `run_python_suite.py`.

## Relevant Files

- `test/ui/tests/` — New test files go here, numbered 17–24
- `test/ui/run_python_suite.py` — Add new test names to `DAEMON_TESTS` or `DAEMON_TMUX_TESTS`
- `test/ui/tmax_harness/operations.py` — Existing harness operations (may need minor additions)
- `test/ui/tmax_harness/client.py` — Client API for daemon queries
- `test/ui/tmax_harness/input.py` — Key input helpers
- `test/ui/tmax_harness/assertions.py` — Assertion helpers
- `src/tlisp/core/commands/vim-counts.tlisp` — Count prefix T-Lisp state
- `src/tlisp/core/commands/operators.tlisp` — Operator-pending state machine
- `src/tlisp/core/commands/vim-dispatch.tlisp` — Central normal-mode dispatcher
- `src/tlisp/core/commands/windows.tlisp` — Window split commands
- `src/editor/api/text-objects-ops.ts` — Text object T-Lisp API
- `src/editor/api/macro-recording.ts` — Macro recording implementation

### New Files
- `test/ui/tests/17_count_prefix.py`
- `test/ui/tests/18_text_objects.py`
- `test/ui/tests/19_yank_ring.py`
- `test/ui/tests/20_macro_recording.py`
- `test/ui/tests/21_window_splitting.py`
- `test/ui/tests/22_config_loading.py`
- `test/ui/tests/23_indentation.py`
- `test/ui/tests/24_module_loading.py`

## Implementation Plan

### Phase 1: Daemon-mode logic tests (17–20, 22–24)
Create 7 tests that exercise editor logic through the daemon client. No tmux required. These test the vim state machine, T-Lisp commands, and editor state mutations.

### Phase 2: Daemon-tmux visual test (21)
Create 1 test for window splitting that verifies TUI rendering of split panes.

### Phase 3: Registration
Add all new test filenames to `run_python_suite.py`.

## Step by Step Tasks

### Task 1: Create test 17 — Count prefix

**User Story**: As an editor user, I want `3j` to move down 3 lines and `5dd` to delete 5 lines so that I can operate efficiently with count prefixes.

- Create `test/ui/tests/17_count_prefix.py` (daemon mode)
- Test `3j` moves cursor down 3 lines
- Test `5l` moves cursor right 5 columns
- Test `2dd` deletes 2 lines
- Test `3x` deletes 3 characters
- Test `2w` moves 2 words forward
- Test count active query via `(count-active)` and `(count-get)`
- Test count reset via `Escape`

**Acceptance Criteria**:
- [ ] `3j` moves cursor from line 0 to line 3
- [ ] `2dd` removes exactly 2 lines from buffer
- [ ] `3x` removes 3 characters from cursor position
- [ ] Escape clears an active count

### Task 2: Create test 18 — Text objects

**User Story**: As an editor user, I want `diw` to delete the inner word and `ci"` to change text inside quotes so that I can edit structurally.

- Create `test/ui/tests/18_text_objects.py` (daemon mode)
- Test `(delete-inner-word)` via daemon eval
- Test `(delete-around-word)` via daemon eval
- Test `(change-inner-double-quote)` via daemon eval — verify mode changes to insert
- Test `(delete-inner-paren)` via daemon eval
- Test `(delete-inner-brace)` via daemon eval
- Test each with cursor positioned inside the target text object

**Acceptance Criteria**:
- [ ] `delete-inner-word` removes the word under cursor, leaves surrounding whitespace
- [ ] `delete-around-word` removes the word and trailing whitespace
- [ ] `change-inner-double-quote` deletes content inside quotes and enters insert mode
- [ ] `delete-inner-paren` deletes content between matching parens

### Task 3: Create test 19 — Yank ring

**User Story**: As an editor user, I want `M-y` to cycle through previously yanked text so that I can access my kill ring history.

- Create `test/ui/tests/19_yank_ring.py` (daemon mode)
- Create test file with multiple distinct lines
- Delete word 1 (stores in kill ring), delete word 2 (pushes to kill ring)
- Yank — should get word 2 (most recent)
- Send `M-y` (yank-pop) — should cycle to word 1
- Verify kill ring length via T-Lisp query if available

**Acceptance Criteria**:
- [ ] First yank returns most recently deleted text
- [ ] `M-y` after yank cycles to previous kill ring entry
- [ ] Multiple `M-y` presses cycle through all entries

### Task 4: Create test 20 — Macro recording

**User Story**: As an editor user, I want `qa..q` to record a macro and `@a` to replay it so that I can automate repetitive edits.

- Create `test/ui/tests/20_macro_recording.py` (daemon mode)
- Test macro recording lifecycle via T-Lisp API:
  - `(macro-start-recording "a")` → verify `(macro-recording-p)` returns true
  - Perform some edits
  - `(macro-stop-recording)` → verify `(macro-recording-p)` returns false
  - `(macro-execute "a")` → verify edits are replayed
- Test `(macro-execute-last)` (@@) replays most recent macro
- Test that recording to invalid register fails gracefully

**Acceptance Criteria**:
- [ ] Macro recording captures keystrokes to a register
- [ ] Macro execution replays recorded keystrokes
- [ ] `macro-execute-last` replays the most recently executed macro
- [ ] Invalid register names are rejected

### Task 5: Create test 21 — Window splitting

**User Story**: As an editor user, I want `C-w s` to split the window horizontally and `C-w w` to switch panes so that I can view multiple locations simultaneously.

- Create `test/ui/tests/21_window_splitting.py` (daemon-tmux mode)
- Test horizontal split: send `C-w` then `s` — verify two panes visible in tmux
- Test pane switch: send `C-w` then `w` — verify cursor moves to other pane
- Test vertical split: send `C-w` then `v` — verify split
- Test pane close: send `C-w` then `q` — verify pane closes
- Use `assert_text_visible` to verify content in both panes

**Acceptance Criteria**:
- [ ] `C-w s` creates a horizontal split (2 tmux panes)
- [ ] `C-w v` creates a vertical split
- [ ] `C-w w` switches focus between panes
- [ ] `C-w q` closes the current pane

### Task 6: Create test 22 — Config loading

**User Story**: As an editor user, I want tmax to load `~/.config/tmax/init.tlisp` on startup so that my custom settings take effect.

- Create `test/ui/tests/22_config_loading.py` (daemon mode)
- Create a temp `init.tlisp` that defines a custom T-Lisp function (e.g., `(defun test-init-loaded () t)`)
- Start the editor with the temp config directory
- Evaluate `(test-init-loaded)` — should return `t`
- Clean up temp config

**Acceptance Criteria**:
- [ ] Functions defined in `init.tlisp` are available after startup
- [ ] Missing `init.tlisp` does not cause startup failure
- [ ] Syntax errors in `init.tlisp` do not crash the editor

### Task 7: Create test 23 — Indentation

**User Story**: As an editor user, I want `Tab` to auto-indent the current line so that my code stays properly formatted.

- Create `test/ui/tests/23_indentation.py` (daemon mode)
- Create test file with unindented code (e.g., Lisp or Python)
- Position cursor on a line that should be indented
- Trigger indent via `Tab` key or T-Lisp `(indent-current-line)`
- Verify the line was indented correctly

**Acceptance Criteria**:
- [ ] Indent command adjusts line indentation
- [ ] Already-correct indentation is not changed
- [ ] Indent works with language-specific modes

### Task 8: Create test 24 — T-Lisp module loading

**User Story**: As an editor user, I want `require-module` to load T-Lisp modules so that I can extend the editor with custom modules.

- Create `test/ui/tests/24_module_loading.py` (daemon mode)
- Create a temp `.tlisp` module file with exported functions
- Evaluate `(require-module path/to/module)` via daemon
- Verify the module's exported function is callable
- Verify loading a nonexistent module returns an error, not a crash

**Acceptance Criteria**:
- [ ] `require-module` loads and executes a T-Lisp module file
- [ ] Exported functions from the module are available after loading
- [ ] Loading a nonexistent module returns an error without crashing

### Task 9: Register new tests in runner

**User Story**: As a developer, I want `bun run test:ui` to discover and run all 24 tests so that CI validates the full suite.

- Add tests 17–20, 22–24 to `DAEMON_TESTS` in `run_python_suite.py`
- Add test 21 to `DAEMON_TMUX_TESTS` in `run_python_suite.py`

**Acceptance Criteria**:
- [ ] `run_python_suite.py` lists all 24 tests
- [ ] `bun run test:ui` runs all 24 tests

### Task 10: Run validation suite

**User Story**: As a developer, I want all tests to pass with zero regressions before merging.

- Run full UI test suite
- Run daemon test suite
- Run typecheck

**Acceptance Criteria**:
- [ ] `bun run test:ui` — all tests pass
- [ ] `bun run test:daemon` — all tests pass
- [ ] `bun run typecheck` — zero errors

## Testing Strategy

### Unit Tests
No new unit tests — these ARE the tests. The features being tested already have unit test coverage.

### Integration Tests
All 8 new tests are integration tests that exercise the full daemon → editor → T-Lisp → state query pipeline.

### Edge Cases
- Count prefix: `0` at start of line vs as digit in count (e.g., `10j`)
- Text objects: cursor at boundary of text object, nested delimiters
- Yank ring: empty kill ring, single entry
- Macro: empty macro, nested macro recording (should reject)
- Window split: closing last pane, splitting already-split pane
- Config: syntax error in init.tlisp, missing config directory
- Indentation: empty lines, lines with only whitespace
- Modules: circular requires, syntax errors in module files

## Acceptance Criteria
- All 8 new test files pass individually
- Full suite (24 tests) passes with zero failures
- No regressions in existing 16 tests
- Zero typecheck errors

## Validation Commands
```bash
bun run test:ui        # All tests must pass (24 total)
bun run test:daemon    # All daemon tests must pass (11 total)
bun run typecheck      # Zero type errors
```

## Notes
- All daemon-mode tests should follow the pattern from `06_navigation.py` and `09_undo_yank_delete.py`
- The one daemon-tmux test (21) should follow `14_vim_input.py` and `16_buffer_completion.py`
- For tests that need T-Lisp functions not yet exposed as key bindings (e.g., text objects), use `client.eval_expr()` to call them directly
- The macro recording test may need to use T-Lisp API calls since the key path (`q`, `a`, `q`, `@a`) depends on vim-dispatch wiring — verify the key path works first, fall back to direct API calls if needed
- For test 22 (config loading), check how the daemon's `--config-dir` or `XDG_CONFIG_HOME` override works to point to a temp directory
