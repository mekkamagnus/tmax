# Chore: Migrate UI Test Harness from Bash to Python (Functional Style)

## Chore Description

Replace the entire bash UI test harness (~3180 lines across 13 files) with a Python package using **strict functional programming style**. The current bash harness has grown beyond bash's comfort zone: structured output parsing from `tmaxclient --eval`, conditional test logic, assertion tracking, and daemon lifecycle management are all better served by Python.

### Functional Programming Constraints

This harness follows the same FP conventions as the tmax TypeScript core (see `rules/functional-programming.md`). All modules must adhere to:

1. **No classes** — use `frozen=True` dataclasses for data, plain functions for behavior
2. **No mutable state** — all dataclasses are immutable; state changes return new instances (use `dataclasses.replace()`)
3. **No exceptions for control flow** — use `Result[T, E]` and `Option[T]` types for operations that can fail
4. **Pure functions** — same inputs always produce same outputs; side effects (subprocess, tmux, file I/O) isolated to the edges
5. **Explicit state threading** — harness state (`HarnessState`) is a frozen dataclass passed through functions, never mutated in place
6. **Composition over inheritance** — no class hierarchies; build behavior by composing small functions
7. **Type annotations everywhere** — all functions fully annotated

**What the harness does** (in bash today):
- **Config** (`config.sh`, 118 lines) — Environment variables, path resolution, mode detection
- **Session** (`session.sh`, 267 lines) — Tmux session/window create/kill/select
- **Editor** (`editor.sh`, 372 lines) — Daemon start/stop, TUI client lifecycle, mode routing
- **Input** (`input.sh`, 206 lines) — Send keys/commands/text via tmux send-keys
- **Query** (`query.sh`, 399 lines) — Daemon eval, mode/text/cursor queries, screen capture, wait loops
- **Editing** (`editing.sh`, 212 lines) — Mode switching, type text, delete, yank, paste, undo/redo
- **Navigation** (`navigation.sh`, 211 lines) — hjkl movement, word/line/page jumps
- **Files** (`files.sh`, 248 lines) — Save, quit, open, create test files
- **Assertions** (`assertions.sh`, 267 lines) — Pass/fail tracking, mode/text/error/screen-fill checks
- **API** (`api.sh`, 548 lines) — High-level `tmax_*` functions exposing everything above
- **Support** (`common.sh`, `debug.sh`, `test-framework.sh`, 332 lines) — Utilities, logging, test runner

**Python structure:** A `test/ui/tmax_harness/` package with matching modules, run via `uv run` from a `pyproject.toml` in `test/ui/`. Test scripts become Python scripts that import the harness.

## Relevant Files

### New Files
- `test/ui/pyproject.toml` — Project config with `uv` (no external deps, just stdlib)
- `test/ui/tmax_harness/__init__.py` — Package init, re-exports public API
- `test/ui/tmax_harness/types.py` — Core FP types: `Result`, `Option`, `HarnessState`, `HarnessConfig`, `AssertionResult`, error types
- `test/ui/tmax_harness/client.py` — Pure `tmaxclient` wrapper with `Result` return types
- `test/ui/tmax_harness/config.py` — Pure config detection, `HarnessConfig` construction
- `test/ui/tmax_harness/session.py` — Tmux session operations, all return `Result`
- `test/ui/tmax_harness/input.py` — Key sending functions, take `(config, window)` not `self`
- `test/ui/tmax_harness/editor.py` — Editor lifecycle functions, thread `HarnessState` through
- `test/ui/tmax_harness/queries.py` — State query functions, all return `Result` or `Option`
- `test/ui/tmax_harness/operations.py` — Editing/navigation/file operation functions
- `test/ui/tmax_harness/assertions.py` — Pure assertion functions, return `AssertionResult`
- `test/ui/tmax_harness/harness.py` — State-threading harness functions composing all modules

### Files to Rewrite
- `test/ui/tests/01_startup.py` — Rewrite of `01-startup.test.sh`
- `test/ui/tests/02_basic_editing.py` — Rewrite of `02-basic-editing.test.sh`
- `test/ui/tests/03_mode_switching.py` — Rewrite of `03-mode-switching.test.sh`

### Files to Deprecate (keep for reference, don't delete yet)
- All 13 bash files in `test/ui/lib/`, `test/ui/core/`, `test/ui/ops/`, `test/ui/assert/`
- All 3 bash test scripts in `test/ui/tests/`

### Reference Files (read-only)
- `bin/tmax` — Unified CLI for daemon lifecycle
- `bin/tmaxclient` — Client CLI for daemon queries
- `src/server/server.ts` — Server implementation
- `src/client/tui-client.ts` — TUI client
- `src/utils/task-either.ts` — Reference for Result/Either pattern used in tmax core
- `rules/functional-programming.md` — FP rules for the project

### Raw tmaxclient output format (for parsing)

```
(editor-mode)      → normal
(buffer-text)      → (string content or empty)
(cursor-position)  → [0,0]
(buffer-current)   → startup-test.txt
(+ 1 2)            → 3
(buffer-list)      → ["*Messages*","startup-test.txt"]
(cursor-line)      → 0
(cursor-column)    → 0
```

## Step by Step Tasks

### Step 1: Create `test/ui/pyproject.toml`

- Minimal pyproject with `uv` support
- No external dependencies (stdlib only: `subprocess`, `json`, `sys`, `os`, `time`, `re`, `pathlib`, `shutil`, `dataclasses`)
- Project name: `tmax-test-harness`
- Python >= 3.10

### Step 2: Create `test/ui/tmax_harness/types.py` — Core FP Types

- `Result[T, E]` — tagged union: `Ok[T]` | `Err[E]` (no exceptions for control flow)
  - `is_ok() -> bool`, `is_err() -> bool`
  - `unwrap() -> T` (raises only if misused, not for flow control)
  - `unwrap_or(default: T) -> T`
  - `map(fn: Callable) -> Result`, `and_then(fn: Callable) -> Result`
- `Option[T]` — tagged union: `Some[T]` | `Nothing`
  - `is_some() -> bool`, `is_nothing() -> bool`
  - `unwrap_or(default: T) -> T`
  - `map(fn: Callable) -> Option`
- `HarnessConfig` — frozen dataclass: `project_root`, `test_dir`, `socket_path`, `client_cmd`, `daemon_cmd`, `tui_cmd`, `session_name`, `test_window`, `mode`, `key_delay`, `operation_delay`, `startup_wait`, `default_timeout`, `capture_lines`
- `HarnessState` — frozen dataclass: `config: HarnessConfig`, `daemon_pid: Option[int]`, `editor_pid: Option[int]`, `active_window: Option[str]`
- `AssertionResult` — frozen dataclass: `passed: bool`, `message: str`, `details: Option[str]`
- `AssertionSummary` — frozen dataclass: `results: tuple[AssertionResult, ...]` (immutable tuple, not list)
- `HarnessError` — frozen dataclass for error values (not exceptions): `message: str`, `details: Option[str]`
- Helper: `parse_value(raw: str) -> str | int | float | list | bool | None` — pure T-Lisp output parser

### Step 3: Create `test/ui/tmax_harness/client.py`

All functions, no class. Every function takes `config: HarnessConfig` as first arg.

```python
def eval_expr(config: HarnessConfig, expr: str) -> Result[str, HarnessError]: ...
def ping(config: HarnessConfig) -> bool: ...
def get_mode(config: HarnessConfig) -> Result[str, HarnessError]: ...
def get_buffer_text(config: HarnessConfig) -> Result[str, HarnessError]: ...
def get_cursor_position(config: HarnessConfig) -> Result[tuple[int, int], HarnessError]: ...
def get_buffer_name(config: HarnessConfig) -> Result[str, HarnessError]: ...
def get_buffer_list(config: HarnessConfig) -> Result[list[str], HarnessError]: ...
def buffer_contains(config: HarnessConfig, pattern: str) -> Result[bool, HarnessError]: ...
```

- Pure subprocess wrapper — each function calls `tmaxclient --eval` and returns `Result`
- Output parsing delegates to `parse_value` from `types.py`
- No side effects beyond subprocess calls (which are the explicit boundary)

### Step 4: Create `test/ui/tmax_harness/config.py`

All pure functions:

```python
def detect_session() -> Option[str]: ...
def detect_mode(session: Option[str]) -> str: ...  # "daemon-tmux" | "tmux" | "direct"
def load_config(overrides: dict | None = None) -> HarnessConfig: ...
```

- `detect_session()` — try `$TMUX`, then `tmux list-sessions -F ...`
- `load_config()` — build `HarnessConfig` from env vars + detection, return frozen dataclass
- All path resolution is pure computation from config values

### Step 5: Create `test/ui/tmax_harness/session.py`

All functions take `(config: HarnessConfig, ...)` and return `Result`:

```python
def validate(config: HarnessConfig) -> Result[None, HarnessError]: ...
def create_window(config: HarnessConfig, name: str) -> Result[str, HarnessError]: ...
def kill_window(config: HarnessConfig, name: str) -> Result[None, HarnessError]: ...
def select_window(config: HarnessConfig, name: str) -> Result[None, HarnessError]: ...
def list_windows(config: HarnessConfig) -> Result[list[str], HarnessError]: ...
def cleanup(config: HarnessConfig) -> Result[None, HarnessError]: ...
```

### Step 6: Create `test/ui/tmax_harness/input.py`

All functions take `(config: HarnessConfig, window: str, ...)` and return `Result`:

```python
def send_key(config: HarnessConfig, window: str, key: str) -> Result[None, HarnessError]: ...
def send_keys(config: HarnessConfig, window: str, *keys: str) -> Result[None, HarnessError]: ...
def send_command(config: HarnessConfig, window: str, cmd: str) -> Result[None, HarnessError]: ...
def send_text(config: HarnessConfig, window: str, text: str) -> Result[None, HarnessError]: ...
def send_enter(config: HarnessConfig, window: str) -> Result[None, HarnessError]: ...
def send_escape(config: HarnessConfig, window: str) -> Result[None, HarnessError]: ...
def send_vim_command(config: HarnessConfig, window: str, cmd: str) -> Result[None, HarnessError]: ...
```

- Pure key translation function: `translate_key(key: str) -> str` (no IO)
- Delay handling via `time.sleep` at the boundary only

### Step 7: Create `test/ui/tmax_harness/editor.py`

State-threading functions: take `HarnessState`, return `Result[HarnessState, HarnessError]`:

```python
def start_daemon(state: HarnessState) -> Result[HarnessState, HarnessError]: ...
def stop_daemon(state: HarnessState) -> Result[HarnessState, HarnessError]: ...
def daemon_is_running(state: HarnessState) -> bool: ...
def start(state: HarnessState, file: str = "") -> Result[HarnessState, HarnessError]: ...
def stop(state: HarnessState) -> Result[HarnessState, HarnessError]: ...
def restart(state: HarnessState, file: str = "") -> Result[HarnessState, HarnessError]: ...
```

- Each function returns a **new** `HarnessState` with updated `daemon_pid`/`editor_pid`/`active_window`
- Mode routing: `start` inspects `state.config.mode` to choose daemon-tmux/tmux/direct path

### Step 8: Create `test/ui/tmax_harness/queries.py`

Split into daemon queries (take `config`) and tmux queries (take `config, window`):

```python
# Daemon queries
def mode(config: HarnessConfig) -> Result[str, HarnessError]: ...
def buffer_text(config: HarnessConfig) -> Result[str, HarnessError]: ...
def cursor_position(config: HarnessConfig) -> Result[tuple[int, int], HarnessError]: ...

# Tmux queries
def capture_output(config: HarnessConfig, window: str, lines: int = 100) -> Result[str, HarnessError]: ...
def text_visible(config: HarnessConfig, window: str, pattern: str) -> bool: ...
def has_errors(config: HarnessConfig, window: str) -> bool: ...

# Wait loops (boundary functions with side effects)
def wait_for_text(config: HarnessConfig, window: str, pattern: str, timeout: int) -> Result[None, HarnessError]: ...
def wait_for_mode(config: HarnessConfig, window: str, expected: str, timeout: int) -> Result[None, HarnessError]: ...
def wait_for_ready(config: HarnessConfig, window: str, timeout: int) -> Result[None, HarnessError]: ...
```

### Step 9: Create `test/ui/tmax_harness/operations.py`

Higher-level operation functions — compose input + queries:

```python
def enter_insert(config: HarnessConfig, window: str) -> Result[None, HarnessError]: ...
def enter_normal(config: HarnessConfig, window: str) -> Result[None, HarnessError]: ...
def type_text(config: HarnessConfig, window: str, text: str) -> Result[None, HarnessError]: ...
def save_file(config: HarnessConfig, window: str) -> Result[None, HarnessError]: ...
def quit_editor(config: HarnessConfig, window: str) -> Result[None, HarnessError]: ...
def move(config: HarnessConfig, window: str, direction: str, count: int = 1) -> Result[None, HarnessError]: ...
def create_test_file(path: str, content: str) -> Result[None, HarnessError]: ...
def delete_test_file(path: str) -> Result[None, HarnessError]: ...
```

### Step 10: Create `test/ui/tmax_harness/assertions.py`

All pure functions returning `AssertionResult` (frozen dataclass):

```python
def assert_text_visible(config: HarnessConfig, window: str, pattern: str, msg: str = "") -> AssertionResult: ...
def assert_mode(config: HarnessConfig, window: str, expected: str, msg: str = "") -> AssertionResult: ...
def assert_daemon_mode(config: HarnessConfig, expected: str, msg: str = "") -> AssertionResult: ...
def assert_daemon_text(config: HarnessConfig, pattern: str, msg: str = "") -> AssertionResult: ...
def assert_no_errors(config: HarnessConfig, window: str, msg: str = "") -> AssertionResult: ...
def assert_running(state: HarnessState, msg: str = "") -> AssertionResult: ...
def assert_screen_fill(config: HarnessConfig, window: str, msg: str = "", tolerance: int = 2) -> AssertionResult: ...
def assert_file_exists(path: str, msg: str = "") -> AssertionResult: ...
def assert_file_contains(path: str, pattern: str, msg: str = "") -> AssertionResult: ...
def summarize(results: tuple[AssertionResult, ...]) -> AssertionSummary: ...
def format_summary(summary: AssertionSummary) -> str: ...
```

- Each assertion is a **pure function** that checks a condition and returns a frozen `AssertionResult`
- `summarize` aggregates immutable tuple of results into `AssertionSummary`
- `format_summary` is pure string formatting — no IO

### Step 11: Create `test/ui/tmax_harness/harness.py`

State-threading API that composes all modules. Functions thread `HarnessState` through:

```python
def init(overrides: dict | None = None) -> Result[HarnessState, HarnessError]: ...
def start(state: HarnessState, file: str = "") -> Result[HarnessState, HarnessError]: ...
def stop(state: HarnessState) -> Result[HarnessState, HarnessError]: ...
def cleanup(state: HarnessState) -> Result[HarnessState, HarnessError]: ...
```

Convenience query functions (take state, extract what they need):
```python
def get_mode(state: HarnessState) -> Result[str, HarnessError]: ...
def get_text(state: HarnessState) -> Result[str, HarnessError]: ...
def is_running(state: HarnessState) -> bool: ...
```

No class. Just functions. The test script threads state explicitly:

```python
result = harness.init()
if result.is_err():
    print(result.unwrap_err().message)
    sys.exit(1)
state = result.unwrap()

result = harness.start(state, "test.txt")
state = result.unwrap_or(state)  # keep state even on failure for cleanup
# ... run test assertions ...
harness.cleanup(state)
```

### Step 12: Create `test/ui/tmax_harness/__init__.py`

Re-export public API:
```python
from .types import HarnessConfig, HarnessState, Result, Option, AssertionResult, AssertionSummary
from .harness import init, start, stop, cleanup, get_mode, get_text, is_running
from .assertions import (assert_text_visible, assert_mode, assert_daemon_mode,
                          assert_daemon_text, assert_no_errors, assert_running,
                          assert_screen_fill, assert_file_exists, assert_file_contains,
                          summarize, format_summary)
from .operations import (enter_insert, enter_normal, type_text, save_file,
                          quit_editor, move, create_test_file, delete_test_file)
```

### Step 13: Rewrite test scripts in Python

Each test is a plain function. State is threaded explicitly. Assertions collected into an immutable tuple.

```python
# test/ui/tests/01_startup.py
import sys
from tmax_harness import *

def test_startup() -> tuple[AssertionResult, ...]:
    results: list[AssertionResult] = []

    state = init().unwrap()
    state = start(state, "startup-test.txt").unwrap()

    results.append(assert_running(state))
    results.append(assert_daemon_mode(state.config, "NORMAL"))
    results.append(assert_no_errors(state.config, state.active_window.unwrap_or("")))

    cleanup(state)
    return tuple(results)

if __name__ == "__main__":
    results = test_startup()
    summary = summarize(results)
    print(format_summary(summary))
    sys.exit(summary.failed)
```

- `test/ui/tests/01_startup.py` — Startup test
- `test/ui/tests/02_basic_editing.py` — Create file, edit, save, verify
- `test/ui/tests/03_mode_switching.py` — Mode transition tests

### Step 14: Update `rules/ui-testing.md`

- Replace bash examples with Python FP examples
- Document the functional API: state threading, Result/Option types, assertion functions
- Keep bash harness reference in a "Legacy" section

### Step 15: Validate

Run all validation commands.

## Validation Commands

- `cd test/ui && uv run python -c "from tmax_harness import init, HarnessState; print('import OK')"` — Package imports cleanly
- `cd test/ui && uv run python tests/01_startup.py` — Startup test passes
- `cd test/ui && uv run python tests/02_basic_editing.py` — Basic editing test passes
- `cd test/ui && uv run python tests/03_mode_switching.py` — Mode switching test passes
- `cd test/ui && uv run python -c "from tmax_harness import init; r = init(); print(type(r).__name__, r.is_ok())"` — Result type works
- `bun test test/unit/test-tlisp-testing-framework.test.ts` — Bun tests unaffected (regression check)

## Notes

### Why functional style?

The tmax project already uses FP patterns in TypeScript (see `rules/functional-programming.md`): `Result`, `Option`, `Either`, immutable state, pure functions. The Python test harness should follow the same conventions for consistency. Benefits:
- **Testability**: pure functions are trivial to unit test — just call with inputs, check output
- **Debuggability**: frozen state means you can print/compare any point in the test flow
- **No hidden state**: every state change is explicit in the return value
- **Composability**: small functions compose into test scripts naturally

### Why not classes?

Classes couple data and behavior, encourage mutable state (`self.x = ...`), and make it hard to see what a function depends on. The bash harness already suffered from implicit global state (`TMAX_EDITOR_PID`, `TMAX_ACTIVE_WINDOW`). In FP style, all state is explicit in the `HarnessState` dataclass that gets threaded through function calls.

The one acceptable use of `dataclass` is for the frozen data containers (`HarnessConfig`, `HarnessState`, `AssertionResult`). These are purely data — no methods, no mutation.

### Why uv over plain python3?

`uv` provides:
- **Pin-point reproducibility**: `uv.lock` ensures same Python version across machines
- **Virtual env management**: `uv run` auto-creates/uses `.venv` without manual setup
- **Future-proofing**: When we add `pytest` or `libtmux` later, `uv add pytest` just works

That said, the package uses zero external deps — `uv run` is a convenience, not a requirement. `python3 -m tmax_harness` would also work.

### Why not libtmux?

`libtmux` is a Python library for tmux interaction. We considered it but decided against:
- Adds a dependency for what `subprocess.run(["tmux", ...])` already does
- The harness's tmux usage is simple (create window, send keys, capture pane) — no need for an abstraction layer
- If the harness grows to need complex tmux orchestration (synchronized panes, layout management), reconsider then

### Bash files

Don't delete the bash files yet. Keep them in `test/ui/` for reference during the transition. Mark them with a deprecation header comment. Remove in a follow-up chore once Python harness is validated.
