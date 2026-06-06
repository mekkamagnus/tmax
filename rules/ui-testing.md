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
| `daemon` | Start an isolated daemon, query/control through tmaxclient | Daemon API integration tests |
| `daemon-tmux` | Start an isolated daemon and TUI in an isolated tmux session | Renderer E2E tests only |
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

# Run authoritative suite categories
bun run test:daemon
bun run test:ui:renderer
bun run test:ui
bun run test:ui:helpers

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
    try:
        state = start(state, "test.txt").unwrap()

        # Assertions return frozen AssertionResult
        results.append(assert_running(state))
        results.append(assert_daemon_mode(state.config, "NORMAL"))

        # Editing operations
        enter_insert(state.config, state.active_window.unwrap())
        type_text(state.config, state.active_window.unwrap(), "Hello")
        enter_normal(state.config, state.active_window.unwrap())

        return tuple(results)
    finally:
        cleanup(state)

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

1. Always clean up in `finally`.
2. Use the generated per-run socket, tmux session, and temporary directory.
3. Never stop, replace, or remove a daemon, tmux resource, or path the run did not create.
4. Use `daemon` for API/state integration and never make renderer claims there.
5. Use `daemon-tmux` for renderer behavior; send real keys and inspect captured output.
6. Drive input through `tmaxclient --key`; tmux is only the renderer surface for `daemon-tmux`.
7. Before manual tmux debugging, run `bun run tmux:audit` and prefer the existing `tmax` session over creating ad hoc sessions.
8. Treat query failures as failures and report skips/expected failures separately.
9. Thread state explicitly and collect immutable assertion results.

### Troubleshooting

- **Never kill a shared tmux session or default user daemon.**
- **Resource already exists:** the harness must refuse to attach or replace it.
- **Editor won't start:** Check `project_root`, verify daemon starts with `tmax --daemon`
- **Daemon won't start:** inspect the per-run socket under `/tmp/tmax-ui-tests/<run-id>/server`
- **TUI won't become ready:** query the per-run socket and inspect recent errors
- **Renderer pane blank:** Check pane command and tmux capture; daemon readiness proves the client connected, tmux capture proves visible rendering
- **Tests timing out:** Increase `TMAX_DEFAULT_TIMEOUT` or `TMAX_STARTUP_WAIT`
- **Keys not being sent:** Verify `tmaxclient --key` reaches the configured socket; then check frame status and recent client errors
- **Mode detection unreliable:** Use `assert_daemon_mode` instead of `assert_mode`
- **Too many tmax tmux sessions:** Run `bun run tmux:audit`; stale detached harness shells can be removed with `bun run tmux:cleanup-stale`

### Current Coverage

- Startup and initialization: `tests/01_startup.py`
- Basic editing and insert: `tests/02_basic_editing.py`
- Mode switching: `tests/03_mode_switching.py`
- Daemon/tmux observability: `tests/04_daemon_tmux_observability.py`
- Mode loading and status metadata: `tests/13_modes.py`
- Real-key Vim input and insert editing: `tests/14_vim_input.py`
- Splits, tabs, focus, resizing, and relative line numbers: `tests/15_daily_driver_rendering.py`

## Legacy Bash Harness (Deprecated)

The bash harness in `test/ui/lib/`, `test/ui/core/`, `test/ui/ops/`, `test/ui/assert/` is deprecated. It remains for reference during the transition. Key differences from Python:

- Uses global env vars (`TMAX_ACTIVE_WINDOW`, `TMAX_EDITOR_PID`) instead of state threading
- Uses return codes instead of `Result` types
- Assertions mutate global counters instead of returning immutable results

Do not run the Bash harness as validation or add new Bash tests. All new tests
must use the isolated Python harness.
