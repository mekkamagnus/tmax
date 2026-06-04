# tmax UI Test Suite

Python-based functional suite with separate daemon API integration and real-key
renderer E2E categories. Every scenario gets a unique daemon socket, tmux
session, and temporary directory.

## Quick Start

```bash
# Run the full suite (daemon + daemon-tmux)
bun run test:ui

# Run daemon-only tests
bun run test:daemon

# Run daemon-tmux tests only
bun run test:ui:renderer

# Run a single test
uv run python tests/01_startup.py
TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/10_renderer_layout.py

# Run pure harness helper tests
bun run test:ui:helpers
```

## Test Modes

| Mode | Used By | Requires | Purpose |
|------|---------|----------|---------|
| `daemon` | Tests 01-03, 05-09, 11-13 | Bun | JSON-RPC, T-Lisp commands, editor state |
| `daemon-tmux` | Tests 04, 10, 14-15 | Bun + tmux | Real keys and captured TUI output |

Daemon tests may use direct T-Lisp evaluation. Renderer tests must send real
keys and assert captured output. A query failure is a failure; unavailable
renderer assertions are reported as skips, never passes.

## Test Files

### Daemon-Only Workflow Tests
| File | Coverage |
|------|----------|
| `01_startup.py` | Daemon start, mode, no errors |
| `02_basic_editing.py` | File load, insert, save, verify |
| `03_mode_switching.py` | Normal/insert mode transitions |
| `05_command_mode.py` | Command mode, M-x, invalid commands |
| `06_navigation.py` | Cursor movement, word/line/boundary navigation |
| `07_visual_mode.py` | Visual mode enter/exit |
| `08_buffers_files.py` | Multiple files, buffer switching, file creation |
| `09_undo_yank_delete.py` | Delete line, undo/redo, text deletion |
| `11_search_replace.py` | Forward search, no-match behavior |
| `12_daily_drivers.py` | T-Lisp eval, custom functions, API coverage |

### Daemon-Tmux Renderer Tests
| File | Coverage |
|------|----------|
| `04_daemon_tmux_observability.py` | TUI readiness, render count, frame sync |
| `10_renderer_layout.py` | Screen fill, status line, render advancement |
| `14_vim_input.py` | Real-key insert editing, controls, motions, and operators |
| `15_daily_driver_rendering.py` | Splits, tabs, focus, resizing, relative line numbers |

### Helper Tests
| File | Coverage |
|------|----------|
| `test_harness_helpers.py` | Escaping, parsing, isolation, and assertion semantics |

## Harness Architecture

The harness follows strict functional programming:

- **Frozen dataclasses** for `HarnessConfig`, `HarnessState`, `AssertionResult`
- **`Result[T, E]`** (`Ok`/`Err`) and **`Option[T]`** (`Some`/`Nothing`) tagged unions
- **Pure functions** — all operations take `(config, window)` and return `Result`
- **Explicit state threading** — `state = init().unwrap(); state = start(state, file).unwrap()`
- **No mutable global state**, no classes with methods

## Adding New Tests

1. Create `test/ui/tests/NN_name.py`
2. Wrap `start()` and assertions in `try/finally` with `cleanup(state)`.
3. Use daemon operations only in daemon integration tests.
4. Use real input operations and renderer assertions in daemon-tmux tests.
5. Add to `DAEMON_TESTS` or `DAEMON_TMUX_TESTS` in `run_python_suite.py`

## Legacy Bash Tests

The Bash test harness in `test/ui/lib/` is deprecated and is not authoritative.
Do not add or use Bash tests as release validation.

## Harness Modules

| Module | Purpose |
|--------|---------|
| `tmax_harness/types.py` | Core types: Result, Option, frozen dataclasses |
| `tmax_harness/client.py` | `tmaxclient` subprocess wrapper |
| `tmax_harness/config.py` | Config detection and construction |
| `tmax_harness/editor.py` | Editor lifecycle (start/stop/daemon) |
| `tmax_harness/operations.py` | Editor operations (modes, text, navigation, search) |
| `tmax_harness/assertions.py` | Test assertions |
| `tmax_harness/queries.py` | Daemon and tmux queries, wait loops |
| `tmax_harness/session.py` | Tmux session/window operations |
| `tmax_harness/input.py` | Tmux key sending |
| `tmax_harness/tlisp_escape.py` | Safe T-Lisp expression builders |
| `tmax_harness/harness.py` | Top-level API composing all modules |

## File Structure

```
test/ui/
├── README.md                    # This file
├── pyproject.toml               # uv project config
├── run_python_suite.py          # Suite runner
├── tmax_harness/                # Python harness package
│   ├── __init__.py
│   ├── types.py
│   ├── client.py
│   ├── config.py
│   ├── editor.py
│   ├── operations.py
│   ├── assertions.py
│   ├── queries.py
│   ├── session.py
│   ├── input.py
│   ├── tlisp_escape.py
│   └── harness.py
└── tests/
    ├── 01_startup.py
    ├── 02_basic_editing.py
    ├── 03_mode_switching.py
    ├── 04_daemon_tmux_observability.py
    ├── 05_command_mode.py
    ├── 06_navigation.py
    ├── 07_visual_mode.py
    ├── 08_buffers_files.py
    ├── 09_undo_yank_delete.py
    ├── 10_renderer_layout.py
    ├── 11_search_replace.py
    ├── 12_daily_drivers.py
    ├── 13_modes.py
    ├── 14_vim_input.py
    ├── 15_daily_driver_rendering.py
    └── test_harness_helpers.py
```
