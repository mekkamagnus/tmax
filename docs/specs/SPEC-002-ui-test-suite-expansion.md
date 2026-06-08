# Feature: Expanded UI Test Suite

## Feature Description
Expand the Python UI testing suite so it covers the current tmax user workflows and daemon/TUI architecture in a reliable, daemon-first way. The suite should verify editor behavior through `tmaxclient` and the tmax daemon by default, then use `daemon-tmux` only for tests that must prove the terminal renderer itself is visible, synchronized, and correctly laid out.

This feature adds missing Python harness capabilities, ports the useful remaining legacy bash UI tests, and introduces workflow tests for command mode, M-x, navigation, visual mode, buffers and files, delete/yank/change/put operators, undo/redo, search/replace, renderer layout, and daily-driver features such as major mode detection, indentation, dired, and custom key bindings where currently supported.

The value is a UI suite that matches how tmax is now intended to be exercised: simple and deterministic daemon/client tests for editor logic, with explicit daemon-observed readiness before any tmux renderer assertions.

## User Story
As a tmax maintainer and AI test harness operator
I want comprehensive daemon-first UI workflow coverage
So that regressions in editor behavior, daemon/client synchronization, and TUI rendering are caught quickly without relying on brittle tmux-only tests.

## Problem Statement
The current Python UI suite validates startup, basic editing, mode switching, and daemon-tmux observability. That proves the new harness works, but it does not yet cover much of the functionality advertised by tmax:

- command mode and M-x workflows
- navigation across characters, words, lines, and file boundaries
- visual selection behavior
- buffers, file open/save flows, and messages
- delete, yank, change, put, undo, redo, and count-prefix behavior
- search and replace workflows
- renderer layout, status line, cursor display, and screen fill
- major mode, syntax, indentation, dired, hooks, and key binding customization

Several legacy bash tests still exist for command mode, layout, and keymap customization, but the bash harness is deprecated and should not be extended. The Python harness also needs more operations and assertions before these workflows can be tested cleanly without falling back to tmux key injection for non-renderer behavior.

## Solution Statement
Add a broader Python UI test suite and the harness primitives it needs. The harness should keep its strict functional programming style: frozen dataclasses, `Result`/`Option`, pure helper functions, explicit state threading, and no mutable global state.

The suite will split coverage by responsibility:

- `daemon` mode is the default for editor logic and workflow tests. It controls tmax through `tmaxclient`, queries structured daemon state, and avoids tmux.
- `daemon-tmux` mode is reserved for renderer tests. It starts the TUI in tmux, waits for daemon-reported TUI readiness, then verifies the visible terminal surface.
- `tmux` and `direct` stay as compatibility paths, but new tests must not depend on them unless a feature cannot be exercised through daemon/client APIs.

The implementation should add missing daemon operations, assertions, and a small suite runner, then introduce Python tests that cover the recommended workflows. Legacy bash scenarios should be ported where still relevant instead of creating new bash tests.

## Relevant Files
Use these files to implement the feature:

- `README.md` - Source of current advertised tmax behavior and workflows to cover.
- `rules/ui-testing.md` - UI testing policy; update coverage, commands, daemon-vs-renderer guidance, and harness expectations.
- `test/ui/README.md` - Human-facing UI test documentation; update with the expanded Python suite and runner commands.
- `test/ui/TEST_STATUS.md` - Track current Python coverage and remaining deprecated bash coverage.
- `test/ui/pyproject.toml` - Existing `uv` project configuration for the Python harness.
- `test/ui/tmax_harness/types.py` - Frozen dataclasses and `Result`/`Option` types; add structured value types only when useful.
- `test/ui/tmax_harness/client.py` - `tmaxclient` wrapper; add safe eval/query helpers and JSON status helpers for new workflows.
- `test/ui/tmax_harness/editor.py` - Harness lifecycle; preserve daemon-first startup and daemon-tmux readiness.
- `test/ui/tmax_harness/operations.py` - Add functional operations for commands, M-x, movement, visual mode, buffers, search, replace, and operators.
- `test/ui/tmax_harness/assertions.py` - Add assertions for cursor, buffers, files, status line, messages, selections, search results, renderer layout, and daemon/TUI sync.
- `test/ui/tmax_harness/queries.py` - Add query helpers for mode, cursor, buffer text, buffer list, filename, status message, messages buffer, major mode, and frame metadata.
- `test/ui/tmax_harness/input.py` - Keep tmux key sending scoped to renderer-only cases and compatibility fallback.
- `test/ui/tmax_harness/session.py` - Ensure cleanup remains safe with active user tmux sessions and daemon sockets.
- `test/ui/tests/01_startup.py` - Existing startup coverage; extend only if new common assertions are needed.
- `test/ui/tests/02_basic_editing.py` - Existing editing smoke coverage; keep as the small P0 editing test.
- `test/ui/tests/03_mode_switching.py` - Existing mode-switching smoke coverage; keep as the small P0 modal test.
- `test/ui/tests/04_daemon_tmux_observability.py` - Existing renderer readiness coverage; keep focused on daemon-tmux observability.
- `test/ui/tests/01-startup.test.sh` - Legacy startup reference; no new work unless porting missed behavior.
- `test/ui/tests/04-full-height-layout.test.sh` - Legacy renderer layout scenario to port to Python.
- `test/ui/tests/04-keymap-customization.test.sh` - Legacy keymap scenario to port to Python where behavior is still supported.
- `test/ui/tests/05-command-mode-cursor-focus.test.sh` - Legacy command-mode focus scenario to port to Python.
- `test/ui/tests/06-command-mode-backspace.test.sh` - Legacy command-mode backspace scenario to port to Python.
- `src/editor/tlisp-api.ts` - Editor API exposed to tests through T-Lisp eval; use existing functions rather than adding test-only hooks.
- `src/tlisp/core-bindings.tlisp` - Default key binding behavior for modal workflows.
- `src/editor/editor.ts` - Terminal editor behavior and command handling reference.
- `src/server/server.ts` - Daemon protocol and observability status source.
- `bin/tmaxclient` - CLI used by the harness to query/control daemon state.

### New Files
- `test/ui/run_python_suite.py` - Functional suite runner that executes Python UI tests in the correct modes with cleanup-friendly reporting.
- `test/ui/tests/05_command_mode.py` - Command mode and M-x workflow coverage.
- `test/ui/tests/06_navigation.py` - Cursor, word, line, and boundary navigation coverage.
- `test/ui/tests/07_visual_mode.py` - Visual mode selection and visual operator coverage.
- `test/ui/tests/08_buffers_files.py` - Buffer switching, file open/save/create, and message coverage.
- `test/ui/tests/09_undo_yank_delete.py` - Delete, yank, change, put, undo, redo, and count-prefix coverage.
- `test/ui/tests/10_renderer_layout.py` - Daemon-tmux renderer surface, status line, cursor, and screen fill coverage.
- `test/ui/tests/11_search_replace.py` - Search forward/backward, no-match behavior, and replace workflow coverage.
- `test/ui/tests/12_daily_drivers.py` - Major mode, syntax/indentation, dired, hooks, init, and custom key binding coverage for supported behavior.
- `test/ui/tests/test_harness_helpers.py` - Optional Python unit tests for pure harness helpers such as T-Lisp string escaping and status parsing.

## Implementation Plan
### Phase 1: Foundation
Audit current Python and legacy bash UI coverage, then add the missing harness primitives needed to express new tests through daemon/client APIs. This includes safe T-Lisp string escaping, structured daemon queries, cursor and buffer assertions, command/M-x helpers, search/replace helpers, renderer layout assertions, and a suite runner.

### Phase 2: Core Implementation
Add the expanded Python test files in priority order. Start with command mode, navigation, buffers/files, and editing operators because these cover the highest-risk daily editing workflows. Port the useful legacy bash tests during this phase so deprecated coverage has Python equivalents.

### Phase 3: Integration
Add daemon-tmux renderer layout tests, daily-driver feature tests, documentation updates, and validation commands. Ensure daemon-only tests do not require tmux and daemon-tmux tests always wait for structured daemon readiness before capturing the terminal surface.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Audit Existing UI Coverage
- Review current Python tests and list the behavior each one covers.
- Review legacy bash tests and identify which scenarios still matter.
- Update `test/ui/TEST_STATUS.md` with a coverage map before adding new tests.
- Confirm that all new workflow tests can run in `daemon` mode unless they assert renderer output.

### Step 2: Add Safe Daemon Eval Helpers
- Add a pure helper that escapes T-Lisp strings containing quotes, backslashes, newlines, tabs, and non-printable characters.
- Add helper functions that build T-Lisp expressions from typed arguments instead of interpolating ad hoc strings.
- Add optional unit coverage in `test/ui/tests/test_harness_helpers.py` for expression building and JSON parsing helpers.
- Replace any unsafe expression construction in existing Python operations.

### Step 3: Add Core Query Helpers
- Add daemon query functions for current mode, current buffer name, current filename, buffer text, buffer line, buffer list, cursor line, cursor column, status message, messages buffer text, and frame metadata.
- Keep query functions pure at the boundary: accept `HarnessConfig`, return `Result[T, HarnessError]`.
- Preserve existing `assert_daemon_mode`, `assert_daemon_text`, and observability assertions.

### Step 4: Add Cursor and Navigation Operations
- Add daemon/client operations for absolute cursor movement.
- Add daemon/client operations for relative movement, line start/end, top/bottom, word forward/backward/end, and page-style movement where supported.
- Ensure `move()` does not require a tmux window in daemon mode.
- Add cursor assertions for exact position and boundary clamping.

### Step 5: Add Command Mode and M-x Operations
- Add helpers to enter command mode, type command text, backspace command text, execute commands, cancel command mode, enter M-x mode, type M-x text, execute M-x commands, and cancel M-x mode.
- Prefer daemon APIs for command execution when they represent the same behavior.
- Use daemon-tmux only for focus/cursor renderer assertions that require visible terminal behavior.

### Step 6: Add Buffer and File Operations
- Add helpers to open files, create new buffers, switch buffers, list buffers, save the current buffer, save to a new path, and query modified state where supported.
- Add assertions for file existence, file content, current buffer, current filename, buffer list membership, and messages buffer content.
- Include paths with spaces and missing-file behavior in helper design.

### Step 7: Add Visual Mode and Selection Operations
- Add helpers to enter visual mode, move the selection, cancel selection, yank selection, delete selection, and query selection state where supported.
- Add assertions for selected range and resulting buffer text.
- If selection state is not observable yet, add the minimum daemon query needed through existing editor API patterns rather than using screen scraping.

### Step 8: Add Editing Operator Operations
- Add helpers for delete character, delete line, yank line, put, change, undo, redo, and count prefixes.
- Use actual key binding behavior where daemon APIs can route through keypress handling.
- Use direct T-Lisp functions only when they match the same editor behavior and do not bypass the feature under test.

### Step 9: Add Search and Replace Operations
- Add helpers for search forward, search backward, repeat search, search no-match handling, replace current match, replace all, and cancel replace.
- Add assertions for cursor position after search, buffer text after replace, and status/message output for no matches.
- Include tests for special characters in search and replacement text if supported.

### Step 10: Add Renderer Assertions
- Add daemon-tmux assertions for visible screen content, screen fill, status line placement, mode display, filename display, cursor position display, terminal dimensions, and render count advancement.
- Require daemon readiness fields before every tmux capture: TUI connected, ready, raw mode ready, first render present, and render count at least one.
- On failure, include status JSON, frames JSON, recent errors, pane command, and pane capture in assertion details.

### Step 11: Add Suite Runner
- Create `test/ui/run_python_suite.py`.
- Run daemon-mode workflow tests by default.
- Run daemon-tmux tests only for files that require renderer verification.
- Print a concise per-test summary and exit non-zero on any failure.
- Avoid pytest as a required dependency unless explicitly added and documented.

### Step 12: Add Command Mode Tests
- Create `test/ui/tests/05_command_mode.py`.
- Test `:w`, `:q` or safe quit behavior, invalid command no-crash behavior, command text backspace, and command cancellation.
- Test M-x entry and execution for at least one deterministic command.
- Port `05-command-mode-cursor-focus.test.sh` and `06-command-mode-backspace.test.sh` to Python equivalents.

### Step 13: Add Navigation Tests
- Create `test/ui/tests/06_navigation.py`.
- Test `h`, `j`, `k`, `l` equivalent movement through daemon/client workflow.
- Test line start/end, top/bottom, word forward/backward/end, and boundary clamping.
- Verify both cursor query state and resulting visible state where daemon-tmux coverage applies.

### Step 14: Add Visual Mode Tests
- Create `test/ui/tests/07_visual_mode.py`.
- Test entering/exiting visual mode.
- Test selection movement updates the selected range.
- Test visual yank/delete behavior and resulting buffer text.
- Include cancellation behavior so stale selections do not leak into later operations.

### Step 15: Add Buffer and File Tests
- Create `test/ui/tests/08_buffers_files.py`.
- Test opening two files, switching buffers, listing buffers, saving an existing file, saving a new file, and opening a missing file.
- Assert messages buffer output for file operations where deterministic.
- Include a filename with spaces.

### Step 16: Add Operator and Undo Tests
- Create `test/ui/tests/09_undo_yank_delete.py`.
- Test delete character, delete line, yank line, put, change text, undo, redo, and count-prefix behavior.
- Verify buffer text after each operation.
- Include undo/redo after file save when behavior is defined.

### Step 17: Add Renderer Layout Tests
- Create `test/ui/tests/10_renderer_layout.py`.
- Force `TMAX_UI_TEST_MODE=daemon-tmux` in the test or fail early when the mode is wrong.
- Port `04-full-height-layout.test.sh` to Python.
- Assert screen fill, status line bottom placement, visible mode, visible filename/buffer name, visible cursor coordinates, and render count advancement after a daemon-side edit.

### Step 18: Add Search and Replace Tests
- Create `test/ui/tests/11_search_replace.py`.
- Test forward search, backward search, repeat search, no-match behavior, replace current match, replace all matches, and cancel behavior.
- Verify cursor position, buffer text, and status/message output.

### Step 19: Add Daily-Driver Feature Tests
- Create `test/ui/tests/12_daily_drivers.py`.
- Test major mode auto-detection for at least one file type with deterministic behavior.
- Test indentation command behavior where currently supported.
- Test dired open/refresh or mark behavior where currently supported.
- Test custom key binding loading through an isolated init file.
- If any advertised behavior is incomplete, capture the exact expected behavior and file a follow-up bug instead of weakening the test silently.

### Step 20: Update Documentation
- Update `rules/ui-testing.md` with the expanded coverage map and new suite runner command.
- Update `test/ui/README.md` with how to run daemon-only and daemon-tmux subsets.
- Update `test/ui/TEST_STATUS.md` with Python equivalents for legacy bash scenarios and remaining gaps.
- Document that no new bash tests should be added.

### Step 21: Run Validation Commands
- Run every command listed in the Validation Commands section.
- Fix all failures before marking the feature complete.
- Record any product bugs exposed by new tests as separate bug specs rather than hiding failures in the harness.

## Testing Strategy
### Unit Tests
- Test pure T-Lisp string escaping and expression-building helpers.
- Test JSON parsing helpers for daemon status, client, frame, and error payloads.
- Test pure result aggregation used by the suite runner.
- Test path-generation helpers for filenames with spaces and unusual characters.

### Integration Tests
- Run all daemon-mode Python UI tests to verify editor workflows without tmux.
- Run daemon-tmux renderer tests to verify TUI startup, readiness, render sync, layout, and visible output.
- Run current observability tests to ensure the renderer readiness contract remains intact.
- Run relevant Bun unit tests for daemon observability and T-Lisp behavior.

### Edge Cases
- Existing user tmux sessions must not be killed.
- Stale daemon socket from a previous failed run.
- Stale harness-created tmux window from a previous failed run.
- TUI connected but not raw-mode ready.
- TUI raw-mode ready but no first render.
- Renderer pane running a shell instead of `tmaxclient --tui`.
- Strings containing quotes, backslashes, newlines, tabs, Unicode, and empty strings.
- File paths containing spaces.
- Missing files and empty files.
- Cursor movement at top, bottom, beginning of line, and end of line.
- Search with no matches.
- Replace text containing the search text.
- Multiple buffers with the same basename in different directories.
- Test failure cleanup after partial daemon/tmux startup.

## Acceptance Criteria
- All new UI tests are written in Python and use the strict functional harness style.
- No new bash tests are added.
- Daemon-mode tests cover startup, basic editing, mode switching, command mode, M-x, navigation, visual mode, buffers/files, operators, undo/redo, search/replace, and supported daily-driver workflows.
- Daemon-tmux tests cover only renderer behavior: TUI readiness, visible rendering, screen fill, status line layout, cursor display, and render synchronization.
- Legacy bash command-mode, backspace, full-height layout, and keymap customization scenarios have Python equivalents or documented follow-up bugs.
- `move()` and related operations work in daemon mode without requiring a tmux window.
- Harness operations build T-Lisp expressions through safe helpers rather than ad hoc string interpolation.
- Test failures include enough diagnostics to debug daemon state, frame state, recent errors, and tmux renderer output.
- The suite runner can run the daemon subset and daemon-tmux subset with a non-zero exit on failure.
- Documentation reflects the expanded suite and the daemon-first testing policy.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun test test/unit/server-observability.test.ts` - Run daemon observability unit tests.
- `bun test test/unit/test-tlisp-testing-framework.test.ts` - Verify the T-Lisp testing framework still passes.
- `cd test/ui && uv run python tests/test_harness_helpers.py` - Run pure Python harness helper tests if the optional helper test file is added.
- `cd test/ui && uv run python tests/01_startup.py` - Run daemon-only startup test.
- `cd test/ui && uv run python tests/02_basic_editing.py` - Run daemon-only editing smoke test.
- `cd test/ui && uv run python tests/03_mode_switching.py` - Run daemon-only mode switching test.
- `cd test/ui && uv run python tests/05_command_mode.py` - Run command mode and M-x workflow test.
- `cd test/ui && uv run python tests/06_navigation.py` - Run navigation workflow test.
- `cd test/ui && uv run python tests/07_visual_mode.py` - Run visual mode workflow test.
- `cd test/ui && uv run python tests/08_buffers_files.py` - Run buffers and files workflow test.
- `cd test/ui && uv run python tests/09_undo_yank_delete.py` - Run editing operator and undo/redo workflow test.
- `cd test/ui && uv run python tests/11_search_replace.py` - Run search and replace workflow test.
- `cd test/ui && uv run python tests/12_daily_drivers.py` - Run supported daily-driver workflow test.
- `cd test/ui && TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/04_daemon_tmux_observability.py` - Run daemon-tmux observability test.
- `cd test/ui && TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/10_renderer_layout.py` - Run daemon-tmux renderer layout test.
- `cd test/ui && uv run python run_python_suite.py` - Run the full Python UI suite through the suite runner.

## Notes
No new dependency is expected. Keep using `uv` to execute the Python harness and Python standard-library modules unless a specific dependency becomes necessary and is added with `uv add`.

Do not use tmux as a general editor-control layer. Tmux should prove that the TUI renderer launched and drew the expected terminal surface; daemon/client APIs should prove editor behavior.

Some daily-driver tests may expose incomplete or unstable product behavior. When that happens, keep the expected behavior explicit and file a follow-up bug spec rather than weakening the UI suite.
