# UI Test Suite - Current Status

## Date
2026-06-02

## Summary

The UI test harness supports the daemon/client architecture. Tests can now use `tmaxclient --eval` for reliable state queries instead of fragile tmux screen-scraping.

## Test Modes

| Mode | Status | Description |
|------|--------|-------------|
| `daemon-tmux` | Working | Start daemon, TUI in tmux, query via client |
| `tmux` | Working | Start editor directly in tmux (legacy) |
| `direct` | Working | Background process with output capture |

## Working Components

### Infrastructure
- **Daemon/client architecture**: `bin/tmax` starts daemon + TUI, `bin/tmaxclient` for queries
- **Three test modes**: daemon-tmux (default), tmux, direct
- **Daemon query functions**: `tmax_daemon_eval`, `tmax_daemon_mode`, `tmax_daemon_text`
- **Daemon assertions**: `tmax_assert_daemon_mode`, `tmax_assert_daemon_text` (reliable, no screen-scraping)
- **Tmux integration**: Tests run in visible windows within active tmux session
- **Modular architecture**: Core, Operations, Assertions, API layers

### Test Scripts
- `test/ui/tests/01-startup.test.sh` - Application startup with daemon assertions
- `test/ui/tests/02-basic-editing.test.sh` - Basic editing and file operations
- `test/ui/tests/03-mode-switching.test.sh` - Mode transitions with daemon mode detection

### T-Lisp Testing Framework
- Full `deftest`/`test-run`/`test-run-all` lifecycle
- 12+ assertion functions
- Fixture system with setup/teardown and scopes (each/once/all)
- Test suites with `defsuite`/`test-run-suite`
- Coverage tracking
- Async test support

## How to Run

```bash
# From within a tmux session:
bash test/ui/tests/01-startup.test.sh

# Run all:
bash test/ui/run-tests.sh

# Override mode:
TMAX_UI_TEST_MODE=direct bash test/ui/tests/01-startup.test.sh
```

## Files

### Test Infrastructure
- `test/ui/lib/config.sh` - Configuration with daemon mode support
- `test/ui/core/editor.sh` - Editor lifecycle with daemon start/stop
- `test/ui/core/query.sh` - Query functions with daemon and tmux backends
- `test/ui/core/session.sh` - Tmux session management
- `test/ui/core/input.sh` - Key input simulation
- `test/ui/lib/api.sh` - High-level API including daemon functions

### Documentation
- `rules/testing.md` - Bun and T-Lisp testing rules
- `rules/ui-testing.md` - UI testing rules and API reference
- `test/ui/README.md` - Detailed harness documentation
