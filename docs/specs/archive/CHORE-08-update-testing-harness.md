# Chore: Update Testing and UI-Testing Harness

## Chore Description

The project has evolved significantly since the testing infrastructure was built. The UI test harness (`test/ui/`) was designed for an Ink-based editor that had no event loop and couldn't be captured by tmux. Since then, the project has gained:

1. **A working daemon/client architecture** (`bin/tmax` / `bin/tmaxclient`) with JSON-RPC over Unix sockets
2. **Native T-Lisp testing** (`deftest`, `test-run`, `test-run-all`, assertions, fixtures, suites) fully implemented in `src/tlisp/test-framework.ts`
3. **A TUI client** (`src/client/tui-client.ts`) that renders via ANSI escape sequences (captureable by tmux)

The current UI test harness needs updating to:
- Use the **daemon/client workflow** (`tmax` / `tmaxclient`) instead of `bun run src/main.tsx --dev` (which doesn't exist/work)
- Add a **daemon-based test mode** that uses `tmaxclient --eval` to query and manipulate editor state reliably
- Update the **T-Lisp testing rules** in `rules/testing.md` to document the full testing framework capabilities
- Update the **UI testing rules** in `rules/ui-testing.md` to reflect the daemon/client workflow
- Update `test/ui/TEST_STATUS.md` to reflect current state (editor now works, daemon exists)

## Relevant Files

### Test Rules (to update)
- `rules/testing.md` - Testing rules doc, needs T-Lisp testing section expanded with full API reference
- `rules/ui-testing.md` - UI testing rules, needs daemon/client mode documented alongside tmux mode

### Test Status (to update)
- `test/ui/TEST_STATUS.md` - Badly outdated, says editor doesn't work (it does now via daemon)

### Test Infrastructure (to update)
- `test/ui/lib/config.sh` - Config: `TMAX_START_CMD` points to non-existent `src/main.tsx --dev`, needs daemon mode
- `test/ui/core/editor.sh` - Editor lifecycle: needs daemon-aware start/stop (start daemon, then TUI client)
- `test/ui/core/query.sh` - Query functions: needs daemon query via `tmaxclient --eval` for reliable state inspection
- `test/ui/core/session.sh` - Session management: may need updates for daemon lifecycle
- `test/ui/lib/api.sh` - High-level API: may need new daemon-based helpers

### Test Scripts (to update/validate)
- `test/ui/tests/01-startup.test.sh` - Startup test, needs to work with daemon
- `test/ui/tests/02-basic-editing.test.sh` - Basic editing test
- `test/ui/tests/03-mode-switching.test.sh` - Mode switching test

### Reference Files (read-only, for context)
- `bin/tmax` - Unified CLI: daemon start, TUI launch, eval
- `bin/tmaxclient` - Client CLI: eval, ping, messages, buffers, TUI mode
- `src/server/server.ts` - Daemon server implementation
- `src/client/tui-client.ts` - TUI client
- `src/tlisp/test-framework.ts` - T-Lisp testing framework (already complete)
- `src/tlisp/test-output.ts` - Test output formatting
- `src/tlisp/test-coverage.ts` - Coverage tracking
- `src/tlisp/test-registry.ts` - Test registry

## Step by Step Tasks

### Step 1: Update `test/ui/lib/config.sh` — Add Daemon Mode Configuration

- Add a `TMAX_TEST_MODE` variable: `"daemon-tmux"` (new default), `"tmux"` (old), `"direct"` (existing)
- In daemon-tmux mode:
  - `TMAX_START_CMD` becomes `bun $PROJECT_DIR/src/server/server.ts` (daemon)
  - `TMAX_TUI_CMD` becomes `bun $PROJECT_DIR/src/client/tui-client.ts` (TUI client)
  - `TMAX_CLIENT_CMD` becomes `$PROJECT_DIR/bin/tmaxclient`
- Keep existing `TMAX_START_CMD` for backward compatibility when `TMAX_TEST_MODE=tmux`
- Add daemon socket path variable: `TMAX_SOCKET="/tmp/tmax-$(id -u)/server"`
- Add `TMAX_DAEMON_PID` state variable

### Step 2: Update `test/ui/core/editor.sh` — Daemon-Aware Lifecycle

- Add `daemon_start()` function: start the daemon in background, wait for socket via `tmaxclient --ping`
- Add `daemon_stop()` function: `tmax --stop`
- Modify `editor_start()`:
  - If `TMAX_TEST_MODE=daemon-tmux`: start daemon first, then start TUI client in tmux window
  - If `TMAX_TEST_MODE=tmux`: existing behavior
  - If `TMAX_TEST_MODE=direct`: existing behavior
- Modify `editor_stop()`:
  - If daemon-tmux mode: quit TUI client, then stop daemon
- Add `daemon_eval()` helper: run `tmaxclient --eval EXPR` and return result

### Step 3: Update `test/ui/core/query.sh` — Daemon Query Support

- Add `query_daemon_eval()` function: evaluate T-Lisp expression via daemon and return result
- Add `query_daemon_mode()`: use `(editor-mode)` via daemon for reliable mode detection
- Add `query_daemon_buffer_text()`: use `(buffer-text)` via daemon for reliable text inspection
- Add `query_daemon_cursor_position()`: use `(cursor-position)` via daemon
- Update `query_get_mode()` to prefer daemon query when available (more reliable than screen scraping)
- Update `query_wait_for_ready()` to use `tmaxclient --ping` in daemon mode

### Step 4: Update `test/ui/lib/api.sh` — Add Daemon API Functions

- Add `tmax_daemon_eval()`: evaluate T-Lisp via daemon
- Add `tmax_daemon_mode()`: get mode via daemon
- Add `tmax_daemon_text()`: get buffer text via daemon
- Add `tmax_assert_daemon_mode()`: assert mode via daemon (reliable)
- Add `tmax_assert_daemon_text()`: assert buffer contains text via daemon
- Export new functions

### Step 5: Update `test/ui/tests/` — Fix Existing Tests

- Update `01-startup.test.sh` to use daemon-tmux mode
- Update `02-basic-editing.test.sh` to use daemon-based assertions where reliable
- Update `03-mode-switching.test.sh` to use daemon-based mode queries
- Key change: tests should use `tmax_start` which now handles daemon lifecycle internally

### Step 6: Update `rules/testing.md` — Document Full T-Lisp Testing

- Expand "T-Lisp Test Rules" section with complete API reference:
  - All assertion functions (assert-true, assert-false, assert-equal, assert-not-equal, assert-contains, assert-contains-string, assert-matches, assert-type, assert->=, assert-<, assert-in-delta, assert-eventually)
  - Test lifecycle (deftest, test-run, test-run-all, test-run-suite)
  - Fixture system (deffixture, use-fixtures with :scope each|once|all)
  - Suite system (defsuite, list-suites)
  - Coverage commands (coverage-enable, coverage-percentage, coverage-report, coverage-threshold, etc.)
  - Output configuration (set-output-mode, set-color-mode, set-progress-indicator)
  - Async testing (set-async-timeout, async-all, done callback)
- Add section on running T-Lisp tests via daemon: `tmax -e '(test-run-all)'`
- Add section on running T-Lisp tests via Bun: reference `test/unit/test-tlisp-testing-framework.test.ts`

### Step 7: Update `rules/ui-testing.md` — Document Daemon/Tmux Mode

- Add "Daemon/Tmux Mode" as primary testing mode
- Document the three test modes: `daemon-tmux` (default), `tmux`, `direct`
- Update "Writing a UI Test" example to show daemon-based testing
- Add daemon-specific API reference:
  - `tmax_daemon_eval` — evaluate T-Lisp via daemon
  - `tmax_daemon_mode` — reliable mode query
  - `tmax_daemon_text` — reliable buffer text
  - `tmax_assert_daemon_mode` — reliable mode assertion
  - `tmax_assert_daemon_text` — reliable text assertion
- Update "Current Coverage" section
- Update "Troubleshooting" section with daemon-specific issues

### Step 8: Update `test/ui/TEST_STATUS.md` — Reflect Current State

- Remove "Blocking Issues" section (editor now works via daemon)
- Update to show: daemon is functional, TUI client works, tests can use daemon-tmux mode
- Document remaining issues (if any) after running updated tests
- Update date to current date

### Step 9: Validation

Run all validation commands to confirm zero regressions.

## Validation Commands

- `bunx tsc --noEmit` — Type-check all TypeScript with zero errors
- `bun test test/unit/test-tlisp-testing-framework.test.ts` — T-Lisp testing framework tests pass
- `bun test test/unit/tlisp-api.test.ts` — T-Lisp API tests pass
- `bun test test/unit/editor.test.ts` — Editor unit tests pass
- `source test/ui/lib/api.sh && tmax_list_functions` — UI harness loads without errors
- `bash -n test/ui/lib/config.sh` — Config syntax valid
- `bash -n test/ui/core/editor.sh` — Editor module syntax valid
- `bash -n test/ui/core/query.sh` — Query module syntax valid
- `bash -n test/ui/lib/api.sh` — API module syntax valid

## Notes

### Key Insight: Daemon vs Direct Editing

The current UI tests try to start the editor directly (`bun run src/main.tsx --dev`) which doesn't exist as a working standalone entry point. The daemon architecture (`tmax --daemon` + TUI client) is the working workflow. The updated harness should:

1. Start the daemon in background
2. Launch TUI client in tmux window (for visual verification)
3. Use `tmaxclient --eval` for reliable state queries (instead of fragile screen-scraping)
4. Use tmux capture as a secondary verification method

### T-Lisp Testing Framework

The T-Lisp testing framework is already complete and well-implemented. The rules documentation needs to catch up to reflect what exists. No changes to `src/tlisp/test-framework.ts` are needed.

### Backward Compatibility

The old `tmux` and `direct` modes should continue to work for anyone who has a working standalone editor setup. The new `daemon-tmux` mode becomes the default.
