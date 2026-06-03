---
scope: test/ui/**/*
---

# UI Testing Rules

Applies to all UI/integration test files in `test/ui/`.

## Python Test Harness (Current)

The Python test harness (`test/ui/tmax_harness/`) uses **strict functional programming style**: frozen dataclasses, `Result`/`Option` types, pure functions, explicit state threading. No classes, no mutable state.

### Test Modes

| Mode | Description | Use when |
|------|-------------|---------|
| `daemon` | Start daemon, query/control through tmaxclient | Default for editor logic tests |
| `daemon-tmux` | Start daemon, run TUI in tmux, query via tmaxclient | Renderer tests only |
| `tmux` | Start editor directly in tmux window | Legacy, no daemon available |
| `direct` | Start editor in background, capture output | CI or non-tmux environments |

Auto-detection: when `TMAX_UI_TEST_MODE=auto` (default), uses `daemon` when Bun is available, otherwise `direct`.

`daemon-tmux` is strict: the harness waits for daemon-reported TUI readiness (`ready`, `firstRenderAt`, `rawModeReady`, `renderCount`) and then verifies the tmux renderer surface. It must fail if the TUI renderer does not actually launch.

### Commands

```bash
# Run individual tests
cd test/ui && uv run python tests/01_startup.py
cd test/ui && uv run python tests/02_basic_editing.py
cd test/ui && uv run python tests/03_mode_switching.py
cd test/ui && TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/04_daemon_tmux_observability.py

# Run all UI tests
cd test/ui && uv run python -m pytest tests/  # (future)

# Override mode
TMAX_UI_TEST_MODE=direct uv run python tests/01_startup.py
TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/01_startup.py
```

### Writing a UI Test

```python
import sys
from tmax_harness import (
    init, start, cleanup, summarize, format_summary,
    assert_running, assert_daemon_mode, assert_no_errors,
    enter_insert, enter_normal, type_text, save_file, quit_editor,
    create_test_file, delete_test_file,
    AssertionResult,
)

def test_my_feature() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    # State threading — each function returns new state
    state = init().unwrap()
    state = start(state, "test.txt").unwrap()

    # Assertions return frozen AssertionResult
    results.append(assert_running(state))
    results.append(assert_daemon_mode(state.config, "NORMAL"))

    # Editing operations
    enter_insert(state.config, state.active_window.unwrap())
    type_text(state.config, state.active_window.unwrap(), "Hello")
    enter_normal(state.config, state.active_window.unwrap())

    # Cleanup
    cleanup(state)
    return tuple(results)

if __name__ == "__main__":
    results = test_my_feature()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
```

### FP Architecture

**State threading pattern:**
```python
state = init().unwrap()              # Result[HarnessState, HarnessError]
state = start(state, "file").unwrap() # Thread state through
cleanup(state)                        # Cleanup at end
```

**Result/Option types:**
- `Result[T, E]` = `Ok[T] | Err[E]` — use `.is_ok()`, `.unwrap()`, `.unwrap_or(default)`
- `Option[T]` = `Some[T] | Nothing` — use `.is_some()`, `.unwrap_or(default)`

**Frozen dataclasses:**
- `HarnessConfig` — environment, paths, timing
- `HarnessState` — config + daemon_pid + editor_pid + active_window
- `AssertionResult` — passed + message + optional details

### API Reference

**Lifecycle (take/return `HarnessState`):**
- `init(overrides=None) -> Result[HarnessState, HarnessError]`
- `start(state, file="") -> Result[HarnessState, HarnessError]`
- `stop(state) -> Result[HarnessState, HarnessError]`
- `cleanup(state) -> Result[HarnessState, HarnessError]`

**Editing (take `config, window`):**
- `enter_insert(config, window)` / `enter_normal(config, window)`
- `type_text(config, window, text)`
- `save_file(config, window)` / `quit_editor(config, window)`
- `move(config, window, direction, count=1)`

**File operations:**
- `create_test_file(path, content) -> Result`
- `delete_test_file(path) -> Result`

**Assertions (return `AssertionResult`):**
- `assert_running(state, msg="")`
- `assert_daemon_mode(config, expected, msg="")` — reliable, uses tmaxclient
- `assert_daemon_text(config, pattern, msg="")`
- `assert_text_visible(config, window, pattern, msg="")` — screen-scraping
- `assert_mode(config, window, expected, msg="")` — auto-selects daemon or screen
- `assert_no_errors(config, window, msg="")`
- `assert_screen_fill(config, window, msg="", tolerance=2)`
- `assert_tui_connected(config, msg="")` — daemon-tmux observability
- `assert_tui_ready(config, msg="")` — requires first render + raw mode readiness
- `assert_render_count_at_least(config, minimum, msg="")`
- `assert_no_client_errors(config, msg="")`
- `assert_frame_editor_sync(config, msg="")`
- `assert_file_exists(path, msg="")` / `assert_file_contains(path, pattern, msg="")`
- `summarize(results) -> AssertionSummary`
- `format_summary(summary) -> str`

### Best Practices

1. Always cleanup on exit — wrap in try/finally
2. Prefer `daemon` mode for editor logic tests
3. Use `daemon-tmux` only when asserting renderer behavior
4. Prefer `assert_daemon_mode` over `assert_mode` in daemon modes
5. Thread state explicitly — never mutate
6. Collect results into a list, convert to tuple at return
7. Use `Result.unwrap_or(state)` to keep state even on failure for cleanup

### Troubleshooting

- **NEVER kill tmux session without approval** — user may have active work
- **Session already exists:** Ask user before killing. Use `tmux list-sessions` first
- **Editor won't start:** Check `project_root`, verify daemon starts with `tmax --daemon`
- **Daemon won't start:** Check socket `/tmp/tmax-$(id -u)/server`, try `tmax --stop` first
- **TUI won't become ready:** Run `tmaxclient --status --json`, `tmaxclient --frames --json`, and inspect recent errors
- **Renderer pane blank:** Check pane command and tmux capture; daemon readiness proves the client connected, tmux capture proves visible rendering
- **Tests timing out:** Increase `TMAX_DEFAULT_TIMEOUT` or `TMAX_STARTUP_WAIT`
- **Keys not being sent:** Verify tmux session exists, check active window
- **Mode detection unreliable:** Use `assert_daemon_mode` instead of `assert_mode`

### Current Coverage

- Startup and initialization: `tests/01_startup.py`
- Basic editing and insert: `tests/02_basic_editing.py`
- Mode switching: `tests/03_mode_switching.py`
- Daemon/tmux observability: `tests/04_daemon_tmux_observability.py`
- Mode loading and status metadata: `tests/13_modes.py`

## Legacy Bash Harness (Deprecated)

The bash harness in `test/ui/lib/`, `test/ui/core/`, `test/ui/ops/`, `test/ui/assert/` is deprecated. It remains for reference during the transition. Key differences from Python:

- Uses global env vars (`TMAX_ACTIVE_WINDOW`, `TMAX_EDITOR_PID`) instead of state threading
- Uses return codes instead of `Result` types
- Assertions mutate global counters instead of returning immutable results
- Source API: `source test/ui/lib/api.sh`
- Run tests: `bash test/ui/tests/01-startup.test.sh`

Do not add new bash tests. All new tests should use the Python harness.
