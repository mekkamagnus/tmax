# Chore: UI Test Suite - Use Active Tmux Session

## Chore Description

The current UI test harness creates its own isolated tmux session (`tmax-ui-tests`) which is invisible to the user. When tests run, the user cannot see the editor window or observe the test execution visually. This chore requires modifying the UI test suite to:

1. **Detect and use the current active tmux session** instead of creating a new isolated session
2. **Create a visible window** named `test-editor` in the active session where tests run
3. **Keep the window visible** during test execution so both user and AI can observe the editor behavior
4. **Maintain window after tests complete** for manual inspection (with optional cleanup)

This enables interactive testing where the user/AI can watch tests execute in real-time, debug issues visually, and manually inspect the editor state after automated tests finish.

## Relevant Files

Use these files to resolve the chore:

### Existing Files to Modify

- **test/ui/lib/config.sh**
  - Currently defines `TMAX_SESSION="tmax-ui-tests"` (hardcoded isolated session)
  - Needs to detect active tmux session dynamically
  - Should add option to keep windows open after tests

- **test/ui/core/session.sh**
  - `session_create()` - Creates new isolated session, needs to reuse existing session
  - `session_kill()` - Kills entire session, needs to only kill test window
  - `session_create_window()` - Creates window in TMAX_SESSION, should use active session
  - Need to add `session_cleanup()` - Only kills test window, not entire session
  - Need to add `session_get_active()` - Detect current active tmux session

- **test/ui/lib/api.sh**
  - `tmax_init()` - Calls session_create, needs to handle existing session
  - `tmax_cleanup()` - Calls session_kill, needs to only kill test window
  - Need to add `tmax_cleanup_full()` - Optional full cleanup for CI/CD
  - Export `TMAX_KEEP_WINDOW` environment variable to control cleanup behavior

- **test/ui/tests/*.test.sh**
  - All test files call `tmax_cleanup` which kills entire session
  - Should use `tmax_cleanup` (window only) or `tmax_cleanup_full` (session)
  - Should add user-visible status messages indicating test progress

- **test/ui/run-tests.sh**
  - Runs all tests in sequence
  - Should add option to keep windows open between tests for debugging
  - Should display which window is being used for testing

### New Files to Create

- **test/ui/interactive-test.sh**
  - Interactive test runner that keeps windows visible
  - Shows real-time test progress in status line
  - Provides manual inspection prompt between tests
  - Allows user to continue/quit after each test

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### H3: Update Configuration to Detect Active Session

- Modify `test/ui/lib/config.sh`:
  - Add function to detect active tmux session: `tmux display-message -p '#S'`
  - Set `TMAX_SESSION` to detected session name instead of hardcoded `tmax-ui-tests`
  - Add fallback: if no tmux session exists, show error and exit
  - Add `TMAX_KEEP_WINDOW=false` config option (keep test window after tests)
  - Add `TMAX_TEST_WINDOW="test-editor"` config (window name for tests)

### H3: Update Session Management for Reuse

- Modify `test/ui/core/session.sh`:
  - Update `session_create()`:
    - Remove `session_kill` call (don't destroy existing session)
    - Check if session exists using `session_exists()`
    - If exists: log "Using existing session: $TMAX_SESSION"
    - If not exists: create new session with `tmux new-session -d -s "$TMAX_SESSION"`
    - Return 0 in both cases

  - Add `session_get_active()`:
    - Run `tmux display-message -p '#S'` to get active session
    - Echo the session name
    - Return error if not in tmux

  - Add `session_create_test_window()`:
    - Create window named `test-editor` in active session
    - Log "Creating test window in session: $TMAX_SESSION"
    - Use `tmux new-window -t "$TMAX_SESSION" -n "$TMAX_TEST_WINDOW"`
    - Select the window so it's visible: `tmux select-window -t "$TMAX_SESSION:$TMAX_TEST_WINDOW"`
    - Wait for window to be ready
    - Return window name

  - Add `session_cleanup()` (new function):
    - Only kill the test window: `tmux kill-window -t "$TMAX_SESSION:$TMAX_TEST_WINDOW"`
    - Log "Test window cleaned up: $TMAX_TEST_WINDOW"
    - Don't kill the entire session
    - Return 0

  - Keep `session_kill()` unchanged (for full cleanup in CI/CD)

### H3: Update Editor Lifecycle to Use Test Window

- Modify `test/ui/core/editor.sh`:
  - Update `editor_start()`:
    - Change from `session_create_window "$window_name"` to `session_create_test_window()`
    - The window is now automatically selected and visible
    - Log "Starting editor in visible window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
    - Remove explicit window selection (already done in session_create_test_window)

  - Update `editor_stop()`:
    - Check if `TMAX_KEEP_WINDOW` is true
    - If true: Don't kill window, just log "Editor stopped (window kept for inspection)"
    - If false: Call `session_cleanup()` to kill test window

### H3: Update API Functions for Cleanup Control

- Modify `test/ui/lib/api.sh`:
  - Update `tmax_init()`:
    - Call `session_get_active()` to detect current session
    - Set `TMAX_SESSION` to detected session
    - Log "Using active tmux session: $TMAX_SESSION"
    - Call `session_create()` (which now reuses existing session)
    - Display message: "Tests will run in visible window: $TMAX_SESSION:$TMAX_TEST_WINDOW"

  - Update `tmax_cleanup()`:
    - Check `TMAX_KEEP_WINDOW` environment variable
    - If false: Call `session_cleanup()` (kill test window only)
    - If true: Log "Test window kept for manual inspection (session: $TMAX_SESSION, window: $TMAX_TEST_WINDOW)"
    - Don't kill entire session

  - Add `tmax_cleanup_full()`:
    - Call `session_kill()` to kill entire session
    - Use this for CI/CD or when user wants full cleanup
    - Log "Full cleanup: tmux session $TMAX_SESSION killed"

  - Update `tmax_start()`:
    - Call `session_create_test_window()` instead of `session_create_window()`
    - Window is automatically visible

### H3: Add Test Progress Visibility

- Modify `test/ui/lib/api.sh`:
  - Add `tmax_status_message()`:
    - Display status in tmux window's status line or via log
    - Show current test name and step
    - Example: "Test: 01-startup - Starting editor..."

  - Add `tmax_wait_prompt()`:
    - Optional prompt after test completion
    - Display: "Test complete. Press Enter to continue or Ctrl+C to inspect..."
    - Only show if `TMAX_INTERACTIVE=true`

### H3: Create Interactive Test Runner

- Create `test/ui/interactive-test.sh`:
  - Source `lib/api.sh`
  - Set `TMAX_KEEP_WINDOW=true` and `TMAX_INTERACTIVE=true`
  - Run tests sequentially with:
    - Clear status message before each test
    - Show test name in window title
    - Keep window visible during test
    - Show "Press Enter to continue..." prompt after each test
    - Allow user to press Ctrl+C to stop and inspect window
  - On Ctrl+C: Display "Inspection mode. Window kept open. Press Enter when done to continue..."
  - Final summary after all tests
  - Keep final window open for manual inspection
  - Log "Test window kept for inspection: $TMAX_SESSION:$TMAX_TEST_WINDOW"

### H3: Update Test Files for Window Visibility

- Modify all `test/ui/tests/*.test.sh` files:
  - Add clear logging at test start: `echo "=== Running in visible window: $TMAX_SESSION:$TMAX_TEST_WINDOW ==="`
  - Use `tmax_cleanup` (not `session_kill`) at end
  - Remove cleanup of test files that interferes with inspection
  - Add comment: "# Window kept open for inspection - manually close when done"

### H3: Update Test Runner for CI/CD Compatibility

- Modify `test/ui/run-tests.sh`:
  - Add `--interactive` flag for keeping windows
  - Default behavior (no flag): Set `TMAX_KEEP_WINDOW=false`, use `tmax_cleanup_full()`
  - With `--interactive`: Set `TMAX_KEEP_WINDOW=true`, use `tmax_cleanup()`, run `interactive-test.sh`
  - Add environment variable check: `if [[ -n "$TMUX" ]]; then` to detect if in tmux
  - If not in tmux: Show error "Not in tmux session. Run tests from within tmux."
  - Add summary line at end: "Test window location: $TMAX_SESSION:$TMAX_TEST_WINDOW"

### H3: Add Validation for Active Session

- Modify `test/ui/core/session.sh`:
  - Add `session_validate()`:
    - Check if tmux is running: `command -v tmux`
    - Check if in tmux session: `[[ -n "$TMUX" ]]`
    - Check if can get active session: `tmux display-message -p '#S'`
    - If any check fails: Log error and exit with clear message
    - Return 0 if all checks pass

  - Call `session_validate()` at start of `tmax_init()`

### H3: Create Documentation for Interactive Testing

- Create `test/ui/INTERACTIVE.md`:
  - Explain how to run tests visibly in current tmux session
  - Usage: `cd test/ui && bash interactive-test.sh`
  - Or: `TMAX_KEEP_WINDOW=true bash run-tests.sh --interactive`
  - Explain window naming: `{active-session}:test-editor`
  - Explain cleanup options (keep window vs. full cleanup)
  - Add troubleshooting section for common issues

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `tmux list-sessions` - Verify tmux is running and show active sessions
- `cd /home/mekael/Documents/tmax && source test/ui/lib/api.sh && tmax_init` - Initialize test harness (should use active session)
- `tmux list-windows -t tmax | grep test-editor` - Verify test-editor window exists in active session
- `tmux send-keys -t tmax:test-editor "echo test" Enter` - Verify window accepts input
- `tmux capture-pane -t tmax:test-editor -p` - Verify window content is accessible
- `cd test/ui && bash interactive-test.sh` - Run interactive test suite (should be visible)
- `tmux list-windows -t tmax` - After test, verify test-editor window still exists for inspection
- `TMAX_KEEP_WINDOW=false bash test/ui/run-tests.sh` - Run non-interactive (should cleanup properly)
- `grep "session_get_active\|session_create_test_window\|session_cleanup" test/ui/core/session.sh` - Verify new functions exist
- `grep "TMAX_KEEP_WINDOW\|tmax_cleanup_full" test/ui/lib/api.sh` - Verify cleanup control exists

## Notes

### Current Session Detection

The active tmux session is detected using:
```bash
tmux display-message -p '#S'
```

This returns the current session name (e.g., "tmax"). The test harness must:
1. Detect this session at initialization
2. Use it instead of creating "tmax-ui-tests"
3. Create "test-editor" window within this session
4. Keep the session alive after tests complete

### Window Naming Convention

The test window will be named `test-editor` and accessible as:
- `{detected-session}:test-editor` (e.g., "tmax:test-editor")
- This makes it easy for users to find and switch to the test window

### Cleanup Behavior

Two cleanup modes:
1. **Default (CI/CD)**: `TMAX_KEEP_WINDOW=false` - Kill test window after each test
2. **Interactive (Development)**: `TMAX_KEEP_WINDOW=true` - Keep test window for inspection

### AI Assistant Benefits

When Claude Code runs tests:
1. The test window opens visibly in the active session
2. Tests execute in real-time, visible to both user and AI
3. AI can capture window content: `tmux capture-pane -t {session}:test-editor -p`
4. After tests, window stays open for manual inspection
5. User can switch to window: `tmux select-window -t {session}:test-editor`

### Migration Path

This change maintains backward compatibility:
- CI/CD can use non-interactive mode (no windows kept)
- Development uses interactive mode (windows visible and kept)
- Existing tests work with minimal changes (just use `tmax_cleanup` instead of manual cleanup)

### Current State

The current implementation creates isolated session "tmax-ui-tests" which:
- Works for automated testing
- Is invisible to the user
- Makes debugging difficult
- Prevents real-time observation

After this chore:
- Tests run in visible window within active session
- User/AI can watch test execution
- Easier to debug failures
- Supports both automated and interactive workflows
