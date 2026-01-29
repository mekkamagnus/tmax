# Interactive UI Testing Guide

This guide explains how to run UI tests in interactive mode where you can see the editor window and watch tests execute in real-time.

## Overview

The UI test harness now supports two modes:

1. **Non-Interactive Mode** (default): Tests run in background, windows auto-cleanup
2. **Interactive Mode**: Tests run in visible window, windows stay open for inspection

## Quick Start

### Interactive Testing (Visible Windows)

```bash
# Option 1: Using the interactive test runner
cd test/ui
bash interactive-test.sh

# Option 2: Using the test runner with --interactive flag
cd test/ui
bash run-tests.sh --interactive

# Option 3: Using environment variable
cd test/ui
TMAX_KEEP_WINDOW=true bash run-tests.sh
```

### Non-Interactive Testing (CI/CD)

```bash
# Default mode - windows cleaned up automatically
cd test/ui
bash run-tests.sh
```

## What You'll See

### Before Interactive Mode

You run tests but don't see anything happening. Tests run in background.

### After Interactive Mode

1. **New Window Appears**: A new tmux window named `test-editor` opens
2. **Editor Starts**: The tmax editor starts in that window
3. **Tests Execute**: Watch keystrokes being sent, text being typed, modes switching
4. **Window Stays Open**: After tests finish, window stays open for manual inspection

### Window Location

The test window will be: `{current-tmux-session}:test-editor`

For example, if you're in session "tmax", the test window is: `tmax:test-editor`

## Usage Examples

### Example 1: Run All Tests Interactively

```bash
# From your tmux session
cd /home/mekael/Documents/tmax/test/ui
bash interactive-test.sh
```

**What happens:**
1. New window "test-editor" opens in your current tmux session
2. Each test runs visibly
3. Windows stay open after tests complete
4. Summary shows test results
5. Instructions for closing windows are displayed

### Example 2: Run Single Test

```bash
# From your tmux session
cd /home/mekael/Documents/tmax/test/ui/tests
source ../lib/api.sh
export TMAX_KEEP_WINDOW=true
tmax_init
tmax_start "test.txt"
# ... perform test actions ...
tmax_quit
# Window stays open for inspection
```

### Example 3: Debug Failed Test

```bash
# Run tests interactively
cd test/ui
bash interactive-test.sh

# When test fails, switch to test window
tmux select-window -t tmax:test-editor

# Inspect the editor state manually
# Try commands, check buffer content, verify mode

# When done, close the window
tmux kill-window -t tmax:test-editor
```

## Window Management

### Switch to Test Window

```bash
# While test is running or after it completes
tmux select-window -t tmax:test-editor
```

### List All Windows in Session

```bash
tmux list-windows -t tmax
```

### Capture Window Content

```bash
# See what's currently displayed in test window
tmux capture-pane -t tmax:test-editor -p

# Save to file
tmux capture-pane -t tmax:test-editor -p > /tmp/test-output.txt
```

### Close Test Window Manually

```bash
tmux kill-window -t tmax:test-editor
```

### Close Entire Session (Not Recommended)

```bash
tmux kill-session -t tmax
```

## Using with Claude Code

When Claude Code runs UI tests, the test window will be visible in your tmux session. This means:

1. **Real-Time Observation**: Watch Claude Code send keys, type text, switch modes
2. **Debug Failures**: See exactly what went wrong when a test fails
3. **Manual Inspection**: Switch to window and test manually after automated test
4. **State Capture**: Claude can capture window content for analysis

### Example Claude Code Session

```bash
# User: Run the UI tests
# Claude: cd test/ui && bash interactive-test.sh

# [New window "test-editor" opens]

# [User sees editor starting in the window]

# [Claude sends keys: "i", "Hello World", "Escape"]

# [User watches text appear in real-time]

# [Test completes, window stays open]

# User: Switch to test window to inspect
# Claude: tmux select-window -t tmax:test-editor
```

## Configuration Options

### Environment Variables

- **TMAX_KEEP_WINDOW** (`true`/`false`): Keep test windows open after tests
- **TMAX_INTERACTIVE** (`true`/`false`): Enable interactive mode features
- **TMAX_SESSION**: Override detected tmux session name
- **TMAX_TEST_WINDOW**: Override test window name (default: "test-editor")

### Command-Line Flags

- `--interactive`, `-i`: Enable interactive mode
- `--help`, `-h`: Show help message

## Troubleshooting

### "Not in tmux session" Warning

**Problem**: You're not running tests from within a tmux session.

**Solution**: Either:
- Start tmux: `tmux new-session -d`
- Attach to existing tmux session
- Run in non-interactive mode (windows will be in background)

### "Window already exists" Message

**Problem**: Test window from previous test is still open.

**Solution**: Close it manually:
```bash
tmux kill-window -t tmax:test-editor
```

Or run full cleanup:
```bash
source test/ui/lib/api.sh
tmax_cleanup_full
```

### Tests Failing Because Editor Not Ready

**Problem**: Editor not starting within timeout period.

**Solutions**:
1. Switch to test window and see what's happening
2. Increase timeout: `export TMAX_DEFAULT_TIMEOUT=15`
3. Check if Deno-ink version is working (it may not be fully implemented yet)

### Can't See Test Window

**Problem**: Test window created but not visible.

**Solutions**:
1. List windows: `tmux list-windows -t tmax`
2. Select window: `tmux select-window -t tmax:test-editor`
3. Check window index: `tmux display-message -p '#I'`

## Best Practices

### For Development

1. **Use interactive mode**: See what's happening while developing tests
2. **Keep windows open**: Inspect state between tests
3. **Manual testing first**: Verify editor works before automating

### For Debugging

1. **Run single test**: Focus on one failing test
2. **Switch to window**: See actual editor state
3. **Capture content**: Save window output for analysis
4. **Try manually**: Reproduce issue manually

### For CI/CD

1. **Use non-interactive mode**: Default `run-tests.sh`
2. **Auto-cleanup enabled**: Windows cleaned up automatically
3. **Check exit codes**: Non-zero means tests failed

## Examples

### Creating Your Own Interactive Test

```bash
#!/bin/bash
source ../lib/api.sh

# Enable interactive mode
export TMAX_KEEP_WINDOW=true
export TMAX_INTERACTIVE=true

# Initialize (uses active tmux session)
tmax_init

# Start editor (visible window opens)
tmax_start "my-test.txt"

# Your test actions here
tmax_insert
tmax_type "Hello from interactive test!"
tmax_normal

# Verify
tmax_assert_text "Hello from interactive test!"

# Save and quit
tmax_save_quit

# Window stays open - inspect manually
echo "Test complete. Window: $TMAX_SESSION:$TMAX_TEST_WINDOW"
echo "Switch to window with: tmux select-window -t $TMAX_SESSION:$TMAX_TEST_WINDOW"
```

## API Reference

### Key Functions for Interactive Testing

```bash
# Initialize (detects active tmux session)
tmax_init

# Start editor in visible window
tmax_start [file]

# Cleanup options
tmax_cleanup          # Only if TMAX_KEEP_WINDOW=false
tmax_cleanup_full     # Always kills session

# Window info
echo "Session: $TMAX_SESSION"
echo "Window: $TMAX_TEST_WINDOW"

# Switch to test window
tmux select-window -t $TMAX_SESSION:$TMAX_TEST_WINDOW

# Capture window content
tmux capture-pane -t $TMAX_SESSION:$TMAX_TEST_WINDOW -p
```

## Summary

Interactive UI testing makes test execution visible and debuggable:

✅ **Visible Windows**: See tests execute in real-time
✅ **Keep for Inspection**: Windows stay open after tests
✅ **Easy Debugging**: Switch to window, inspect state manually
✅ **AI-Friendly**: Claude Code can observe and you can watch
✅ **CI/CD Compatible**: Non-interactive mode for automation

For more information, see `README.md` and `QUICKSTART.md` in this directory.
