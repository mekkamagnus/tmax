---
scope: test/ui/**/*
---

# UI Testing Rules

Applies to all UI/integration test files in `test/ui/`.

## Commands

```bash
bash test/ui/tests/01-startup.test.sh
bash test/ui/tests/02-basic-editing.test.sh
bash test/ui/tests/03-mode-switching.test.sh
```

## Test Harness

Tmux-based integration tests for end-to-end verification of the terminal interface. Source the API at `test/ui/lib/api.sh`.

### Writing a UI Test

```bash
#!/bin/bash
source ../lib/api.sh

test_my_feature() {
  echo "=== Test: My Feature ==="
  tmax_init

  tmax_create_test_file "test.txt" "Initial content"
  tmax_start "test.txt"
  tmax_wait_for_ready 10

  tmax_insert
  tmax_assert_mode "INSERT"
  tmax_type "Appended text"

  tmax_assert_text "Appended text"
  tmax_save
  tmax_quit

  tmax_check_file "test.txt" "Appended text"
  tmax_summary
  tmax_cleanup
}

test_my_feature
```

### API Reference

**Lifecycle:**
- `tmax_init` - Initialize test harness (create tmux session)
- `tmax_cleanup` - Cleanup (kill session, remove test files)
- `tmax_start [file]` - Start editor (optionally open file)
- `tmax_stop` - Stop editor
- `tmax_restart [file]` - Restart editor

**Editing:**
- `tmax_insert` - Enter insert mode
- `tmax_normal` - Enter normal mode
- `tmax_command` - Enter command mode
- `tmax_type <text>` - Type text in insert mode
- `tmax_save` - Save file
- `tmax_quit` - Quit editor
- `tmax_save_quit` - Save and quit

**Assertions:**
- `tmax_assert_text <pattern>` - Assert text is visible
- `tmax_assert_mode <mode>` - Assert current mode
- `tmax_assert_no_errors` - Assert no errors present
- `tmax_summary` - Print assertion summary

**Query:**
- `tmax_mode` - Get current mode
- `tmax_visible <pattern>` - Check if text is visible
- `tmax_text` - Get all visible text
- `tmax_running` - Check if editor is running

**Debug:**
- `tmax_debug` / `tmax_nodebug` - Toggle debug mode
- `tmax_state` - Show current editor state
- `tmax_dump` - Dump state to file
- `tmax_screenshot [file]` - Capture screenshot

### Best Practices

1. Always cleanup on exit:
   ```bash
   tmax_init
   trap 'tmax_cleanup' EXIT
   ```
2. Use assertions for validation
3. Check results: `tmax_summary` then `exit $?`
4. Enable debug when developing: `tmax_debug`
5. Test file operations end-to-end with `tmax_create_test_file` / `tmax_check_file`

### Troubleshooting

- **NEVER kill tmux session without approval** — user may have active work
- **Session already exists:** Ask user before killing. Use `tmux list-sessions` first
- **Editor won't start:** Check `TMAX_PROJECT_ROOT`, verify `bun run start` works
- **Tests timing out:** Increase `TMAX_DEFAULT_TIMEOUT` or `TMAX_STARTUP_WAIT`
- **Keys not being sent:** Verify tmux session exists, check active window

### Manual Testing

```bash
source test/ui/lib/api.sh
tmax_init
tmax_start "test.txt"
# Make changes manually in tmux session
tmax_mode
tmax_text
tmax_screenshot "debug.txt"
# When done: session_attach or tmax_cleanup
```

### Current Coverage

- Startup and initialization: `01-startup.test.sh`
- Basic editing and insert: `02-basic-editing.test.sh`
- Mode switching: `03-mode-switching.test.sh`
- Total: 15 assertions across 3 test suites (93.3% pass rate)

For detailed documentation, see `test/ui/README.md`.
