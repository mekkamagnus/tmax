# tmax UI Test Harness - Quick Reference

## For Claude Code / AI Assistants

### Initialize and Use

```bash
# Load the harness
source test/ui/lib/api.sh

# Quick start
tmax_init && tmax_start

# Do some editing
tmax_type "Hello World"
tmax_save
tmax_quit

# Cleanup
tmax_cleanup
```

## Common Patterns

### Start Editor and Test Something

```bash
source test/ui/lib/api.sh
tmax_init
tmax_start [file]

# ... your test code ...

tmax_quit && tmax_cleanup
```

### Type Text and Verify

```bash
tmax_insert
tmax_type "test text"
tmax_normal
tmax_assert_text "test text"
```

### Test Mode Switching

```bash
tmax_assert_mode "NORMAL"
tmax_insert
tmax_assert_mode "INSERT"
tmax_normal
tmax_assert_mode "NORMAL"
```

### File Operations

```bash
# Create test file
tmax_create_test_file "demo.txt" "content"

# Open and edit
tmax_start "demo.txt"
tmax_type " more"
tmax_save_quit

# Verify
tmax_check_file "demo.txt" "content more"
```

## All tmax_* Functions

### Lifecycle
- `tmax_init` - Initialize test harness
- `tmax_cleanup` - Cleanup and shutdown
- `tmax_start [file]` - Start editor
- `tmax_stop` - Stop editor
- `tmax_restart [file]` - Restart editor

### Editing
- `tmax_insert` - Enter insert mode
- `tmax_normal` - Enter normal mode
- `tmax_command` - Enter command mode
- `tmax_type <text>` - Type text
- `tmax_type_line <text>` - Type and return to normal
- `tmax_save` - Save file
- `tmax_quit` - Quit
- `tmax_save_quit` - Save and quit

### Navigation
- `tmax_move <dir> [count]` - Move (up/down/left/right)
- `tmax_goto_line <n>` - Go to line
- `tmax_first_line` - Go to first line
- `tmax_last_line` - Go to last line

### Query
- `tmax_mode` - Get current mode
- `tmax_visible <pattern>` - Check if text visible
- `tmax_text` - Get all visible text
- `tmax_running` - Check if running

### Assertion
- `tmax_assert_text <pattern>` - Assert text visible
- `tmax_assert_mode <mode>` - Assert mode
- `tmax_assert_no_errors` - Assert no errors
- `tmax_summary` - Print summary

### Debug
- `tmax_debug` - Enable debug mode
- `tmax_nodebug` - Disable debug mode
- `tmax_state` - Show state
- `tmax_dump` - Dump state to file
- `tmax_screenshot` - Save screenshot

### Helpers
- `tmax_wait_for <pattern> [timeout]` - Wait for text
- `tmax_wait_for_mode <mode> [timeout]` - Wait for mode
- `tmax_sleep <seconds>` - Sleep
- `tmax_quick_edit <file> <content>` - Quick edit workflow
- `tmax_create_test_file <file> <content>` - Create test file
- `tmax_check_file <file> <pattern>` - Verify file content

## Example: Complete Test

```bash
#!/bin/bash
source test/ui/lib/api.sh

tmax_init
trap 'tmax_cleanup' EXIT  # Ensure cleanup

tmax_start

# Test basic editing
tmax_insert
tmax_type "Hello"
tmax_normal
tmax_assert_text "Hello"

# Test file save
tmax_create_test_file "test.txt" "line1"
tmax_start "test.txt"
tmax_type " line2"
tmax_save
tmax_quit

# Verify file
tmax_check_file "test.txt" "line2"

# Show results
tmax_summary
```

## Getting Help

```bash
source test/ui/lib/api.sh
tmax_list_functions    # List all functions
tmax_help <function>   # Get help for specific function
```

## Tips

1. **Always cleanup**: Use `trap 'tmax_cleanup' EXIT` to ensure cleanup
2. **Check results**: Call `tmax_summary` at the end of tests
3. **Debug mode**: Use `tmax_debug` to see what's happening
4. **Manual inspection**: Use `tmux attach -t tmax-ui-tests` to see the editor
5. **State queries**: Use `tmax_mode`, `tmax_text` to inspect state

## Manual Testing

For manual testing with visual feedback:

```bash
source test/ui/lib/api.sh
tmax_init
tmax_start

# Make changes in another terminal:
#   tmux attach -t tmax-ui-tests

# When done, detach (Ctrl+B, D) and:
tmax_cleanup
```
