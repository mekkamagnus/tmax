# tmax UI Test Harness

A modular, AI-friendly test harness for controlling tmax editor via tmux. Designed for automated UI testing and manual debugging.

## Quick Start

```bash
# Source the API
source test/ui/lib/api.sh

# Initialize
tmax_init

# Start editor
tmax_start

# Do something
tmax_type "Hello World"

# Save and quit
tmax_save_quit

# Cleanup
tmax_cleanup
```

## Architecture

The test harness is organized into layers:

### 1. **Core Layer** (`core/`)
Low-level tmux and editor operations
- `session.sh` - Tmux session management
- `input.sh` - Sending keys and commands
- `query.sh` - Querying editor state
- `editor.sh` - Editor lifecycle (start/stop/restart)

### 2. **Operations Layer** (`ops/`)
High-level editing operations
- `editing.sh` - Mode changes, typing, deletion
- `navigation.sh` - Cursor movement
- `files.sh` - File operations

### 3. **Assertion Layer** (`assert/`)
Test verification
- `assertions.sh` - Assertions and test tracking

### 4. **API Layer** (`lib/`)
Public interface for AI assistants
- `api.sh` - Main entry point with `tmax_*` functions
- `config.sh` - Configuration
- `debug.sh` - Debug utilities

## Configuration

Environment variables (set before sourcing `api.sh`):

```bash
export TMAX_SESSION="my-test-session"     # Tmux session name
export TMAX_DEBUG=true                    # Enable debug logging
export TMAX_DEFAULT_TIMEOUT=15            # Default wait timeout
export TMAX_PROJECT_ROOT="/path/to/tmax"  # Project directory
```

## API Reference

### Lifecycle

```bash
tmax_init                    # Initialize test harness (create session)
tmax_cleanup                 # Cleanup (kill session)
tmax_start [file]            # Start editor (optionally open file)
tmax_stop                    # Stop editor
tmax_restart [file]          # Restart editor
```

### Editing

```bash
tmax_insert                  # Enter insert mode
tmax_normal                  # Enter normal mode
tmax_command                 # Enter command mode
tmax_type <text>             # Type text in insert mode
tmax_type_line <text>        # Type text and return to normal mode
tmax_save                    # Save file
tmax_quit                    # Quit editor
tmax_save_quit               # Save and quit
```

### Navigation

```bash
tmax_move <dir> [count]      # Move cursor (up/down/left/right)
tmax_goto_line <n>           # Go to line number
tmax_first_line              # Go to first line
tmax_last_line               # Go to last line
```

### Query

```bash
tmax_mode                    # Get current mode
tmax_visible <pattern>       # Check if text is visible
tmax_text                    # Get all visible text
tmax_running                 # Check if editor is running
```

### Assertion

```bash
tmax_assert_text <pattern>   # Assert text is visible
tmax_assert_mode <mode>      # Assert current mode
tmax_assert_no_errors        # Assert no errors present
tmax_summary                 # Print assertion summary
```

### Debug

```bash
tmax_debug                   # Enable debug mode
tmax_nodebug                 # Disable debug mode
tmax_state                   # Show current editor state
tmax_dump                    # Dump state to file
tmax_screenshot [file]       # Capture screenshot
```

### Helpers

```bash
tmax_wait_for <pattern>      # Wait for text to appear
tmax_wait_for_mode <mode>    # Wait for mode change
tmax_sleep <seconds>         # Sleep for N seconds
tmax_quick_edit <file> <content>  # Start, edit, save, quit
tmax_create_test_file <file> <content>  # Create test file
tmax_check_file <file> <pattern>       # Verify file content
```

## Usage Examples

### Example 1: Basic Editing Test

```bash
source test/ui/lib/api.sh

tmax_init
tmax_start test-file.txt

tmax_type "Hello World"
tmax_save
tmax_quit

tmax_cleanup
```

### Example 2: Mode Switching Test

```bash
source test/ui/lib/api.sh

tmax_init
tmax_start

tmax_assert_mode "NORMAL"
tmax_insert
tmax_assert_mode "INSERT"
tmax_normal
tmax_assert_mode "NORMAL"

tmax_summary
tmax_cleanup
```

### Example 3: File Operations

```bash
source test/ui/lib/api.sh

tmax_init
tmax_create_test_file "demo.txt" "Initial content"

tmax_start "demo.txt"
tmax_assert_text "Initial content"

tmax_type " - Appended"
tmax_save
tmax_quit

tmax_check_file "demo.txt" "Appended"
tmax_cleanup
```

### Example 4: Navigation Test

```bash
source test/ui/lib/api.sh

tmax_init
tmax_start

# Type multiple lines
for i in {1..20}; do
  tmax_type_line "Line $i"
done

# Navigate around
tmax_move down 10
tmax_move right 5
tmax_goto_line 1
tmax_last_line

tmax_cleanup
```

### Example 5: Error Handling

```bash
source test/ui/lib/api.sh

tmax_init
tmax_start

# Try to open non-existent file
tmax_command
tmax_type "/nonexistent/file.txt"
tmax_normal

tmax_assert_no_errors
tmax_summary

tmax_quit
tmax_cleanup
```

## Low-Level API

For more control, use core modules directly:

```bash
source test/ui/lib/api.sh

session_create
session_create_window "my-window"
session_set_active_window "my-window"

input_send_command "deno task start"
query_wait_for_text "Welcome"
query_capture_output

session_kill_window "my-window"
session_kill
```

## Writing Test Scripts

Organize tests as executable scripts:

```bash
#!/bin/bash
# test/ui/tests/my-test.test.sh

source ../lib/api.sh

test_my_feature() {
  tmax_init
  tmax_start

  # Test logic here
  tmax_type "test"
  tmax_assert_text "test"

  tmax_summary

  tmax_cleanup
}

# Run test
test_my_feature
```

## Debugging Failed Tests

When a test fails:

```bash
# Enable debug mode
tmax_debug

# Run your test
...

# Inspect state
tmax_state        # Show current state
tmax_dump         # Dump to file
tmax_screenshot   # Save screenshot

# Manually inspect
# (In another terminal): tmux attach -t tmax-ui-tests
```

## Manual Testing

For interactive testing:

```bash
source test/ui/lib/api.sh

tmax_init
tmax_start

# Make changes manually
# Then use query functions:
tmax_mode
tmax_text
tmax_running

# When done:
session_attach  # Attach to tmux session
# Or:
tmax_cleanup    # Clean up
```

## Best Practices

### 1. **Always cleanup**
```bash
tmax_init
trap 'tmax_cleanup' EXIT  # Cleanup on exit
```

### 2. **Use assertions for validation**
```bash
tmax_assert_mode "INSERT"
tmax_assert_text "Hello"
```

### 3. **Check assertions**
```bash
tmax_summary  # Always call at end
exit $?       # Exit with assertion status
```

### 4. **Enable debug when developing**
```bash
tmax_debug
# ... run tests ...
tmax_nodebug  # Disable for production runs
```

### 5. **Use helper functions for common patterns**
```bash
tmax_quick_edit "file.txt" "content"  # Instead of manual steps
```

## Troubleshooting

### Session already exists
```bash
tmux kill-session -t tmax-ui-tests  # Kill manually
# Or:
tmax_cleanup  # Use cleanup function
```

### Editor won't start
- Check TMAX_PROJECT_ROOT is correct
- Ensure `deno task start` works manually
- Enable debug mode: `tmax_debug`

### Tests timing out
- Increase TMAX_DEFAULT_TIMEOUT
- Increase TMAX_STARTUP_WAIT
- Check if editor is actually starting

### Keys not being sent
- Verify session exists: `tmux list-sessions`
- Verify window exists: `session_list_windows`
- Check active window: `session_get_active_window`

## Integration with Claude Code

The test harness is designed for AI assistant usage:

```bash
# Claude can source and use directly
source test/ui/lib/api.sh

# Simple, intention-revealing functions
tmax_start
tmax_type "Hello"
tmax_save
tmax_quit

# Clear feedback
tmax_mode        # Returns: INSERT
tmax_running     # Returns: 0 (true)

# Built-in assertions
tmax_assert_text "Hello"
tmax_assert_mode "NORMAL"
```

## File Structure

```
test/ui/
├── README.md              # This file
├── lib/
│   ├── api.sh            # Main API (tmax_* functions)
│   ├── config.sh         # Configuration
│   └── debug.sh          # Debug utilities
├── core/
│   ├── session.sh        # Tmux session management
│   ├── input.sh          # Sending keys/commands
│   ├── query.sh          # State queries
│   └── editor.sh         # Editor lifecycle
├── ops/
│   ├── editing.sh        # Editing operations
│   ├── navigation.sh     # Navigation operations
│   └── files.sh          # File operations
├── assert/
│   └── assertions.sh     # Test assertions
└── tests/
    ├── 01-startup.test.sh
    ├── 02-editing.test.sh
    └── ...
```

## Contributing

When adding new features:

1. Add low-level implementation in appropriate `core/` or `ops/` module
2. Add high-level wrapper in `lib/api.sh` with `tmax_` prefix
3. Add assertions in `assert/assertions.sh` if needed
4. Update this README with examples
5. Write test cases in `tests/`

## License

Same as tmax project.
