# UI Test Automation via File-Based IPC

## Status

**accepted** (2026-02-04)

## Context

The tmax editor's UI test suite (`test/ui/`) was completely non-functional due to a fundamental incompatibility between the test harness and the editor's input handling:

### Problem Statement

1. **tmux send-keys Incompatibility**: The test harness used `tmux send-keys` to simulate keyboard input, but this method doesn't work with applications that read terminal input in raw mode. Keys are processed by the shell and never reach the application's stdin.

2. **Ink's useInput Hook Requirements**: The editor uses Ink's `useInput` hook to capture keystrokes, which requires:
   - stdin to be a TTY (which it is in tmux)
   - Terminal to be in raw mode for proper character-by-character input
   - Direct connection to the terminal input stream

3. **Test Failures**: All three UI test suites were failing:
   - 01-startup.test.sh: Display worked, but input failed
   - 02-basic-editing.test.sh: Mode switching and text typing failed
   - 03-mode-switching.test.sh: Mode changes didn't register

4. **Attempted Solutions That Failed**:
   - Using `tmux send-keys -l` (literal mode): Didn't work with raw mode
   - Named pipes (FIFOs): Node.js/Bun's `fs.mkfifoSync()` doesn't exist
   - Direct stdin injection: Requires shell-level process manipulation

### Root Cause Analysis

The fundamental issue is that when `tmux send-keys` sends keystrokes to a tmux pane:
1. The keystrokes go to the shell's input buffer
2. When an application takes over the terminal in raw mode
3. The shell's input is NOT forwarded to the application
4. The application reads directly from the terminal device
5. But the keystrokes were consumed by the shell

This is a known limitation documented in the tmux community: tmux send-keys is incompatible with raw mode terminal applications.

## Decision

Implemented a **file-based IPC (Inter-Process Communication) system** for automated input delivery:

### Architecture

```
Test Harness                    Editor Component
     │                                 │
     ├─ Write key to file ───────▶│ Poll file every 100ms
     │                                 │
     ▼                                 ▼
/tmp/tmax-test-input.txt          Read new input
     │                                 │
     │◀─────────────────────────────┤
           Process keys via T-Lisp
```

### Implementation Details

1. **File Polling in Editor Component** (`src/frontend/components/Editor.tsx`):
   - Created `useEffect` hook that polls `/tmp/tmax-test-input.txt` every 100ms
   - Tracks file position to only read new content (incremental reading)
   - Processes each character through `executeTlisp()` for T-Lisp interpretation

2. **Key Translation** (`test/ui/core/input.sh`):
   - Created `input_translate_key()` function to convert special key names to control characters:
     - `"C-["` → `\x1b` (Escape)
     - `"Enter"` → `\x0d` (Return)
     - `"Backspace"` → `\x7f` (Backspace)
     - `"Space"` → ` ` (Space)
     - `"Tab"` → `\x09` (Tab)

3. **Input Writing** (`test/ui/core/input.sh`):
   - Updated all input functions (`input_send_key`, `input_send_text`) to write to the file
   - Fallback to tmux send-keys for non-test environments
   - Debug logging for troubleshooting

4. **Test Mode Configuration** (`test/ui/lib/config.sh`):
   - `TMAX_TEST_MODE=true`: Skips alternate screen buffer for tmux capture
   - `TMAX_TEST_INPUT_FIFO`: Path to input file (configurable)

5. **Alternate Screen Buffer** (`src/main.tsx`):
   - Disabled when `TMAX_TEST_MODE=true`
   - Allows tmux's `capture-pane` to see editor output

### Configuration

```bash
# Environment variables
export TMAX_TEST_MODE=true              # Skip alt screen, enable polling
export TMAX_TEST_INPUT_FIFO=/tmp/tmax-test-input.txt  # Input file path

# Editor component behavior
- Polls file every 100ms
- Reads only new content (tracks position)
- Processes each character via T-Lisp
```

## Consequences

### Positive

1. **Tests Now Work**: All 18/18 UI tests pass (100% pass rate)
   - 01-startup.test.sh: 4/4 ✅
   - 02-basic-editing.test.sh: 5/5 ✅
   - 03-mode-switching.test.sh: 9/9 ✅

2. **Reliable Input Delivery**: File-based approach guarantees input reaches the editor
   - No dependency on shell or tmux input handling
   - Works consistently across different terminal configurations
   - Predictable timing (100ms polling interval)

3. **Debuggable**: Input trace visible in debug log
   - Can see exactly what keys were sent
   - File contents can be inspected manually
   - Easy to add more debugging if needed

4. **Portable**: Works on any platform with file I/O
   - No Unix-specific IPC mechanisms (FIFOs, sockets)
   - No external dependencies
   - Cross-platform compatible

5. **Extensible**: Can be enhanced for more complex testing scenarios
   - Could add timing information
   - Could support macros/sequences
   - Could add input validation

### Negative

1. **Polling Overhead**: Editor polls file every 100ms during testing
   - Minimal CPU impact (small file, quick reads)
   - Only active in test mode (not in production)
   - 100ms latency on input (acceptable for tests)

2. **Complexity**: Added ~150 lines of code across multiple files
   - Editor component: ~60 lines for polling logic
   - Input handling: ~40 lines for key translation
   - Configuration: ~10 lines for environment setup

3. **Test-Only Code**: File polling code only used during testing
   - Doesn't affect production behavior
   - Requires conditional logic (`if (testInputFifo)`)
   - Adds maintenance burden for test infrastructure

4. **External State Dependency**: Tests rely on filesystem state
   - Need to ensure file is cleaned up between tests
   - Potential for race conditions (mitigated by tracking position)
   - File could be manipulated externally (unlikely in practice)

### Neutral

1. **Production Behavior Unchanged**: File polling only activates when `TMAX_TEST_INPUT_FIFO` is set
   - Normal editor usage unaffected
   - No performance impact in production
   - No additional dependencies in production builds

2. **Test API Unchanged**: Test harness functions (`tmax_insert`, `tmax_type`, etc.) work the same
   - Tests don't need to be rewritten
   - Test authors use the same interface
   - Implementation detail is abstracted away

3. **Debug Mode Compatible**: Works with `--dev` flag and verbose logging
   - Debug output captured in test logs
   - Can trace input delivery through the system
   - Helps diagnose test failures

## Implementation

- Modified `src/main.tsx`: Skip alternate screen buffer in test mode
- Modified `src/frontend/components/Editor.tsx`: Added file polling logic (~60 lines)
- Modified `test/ui/lib/config.sh`: Added test mode configuration
- Modified `test/ui/core/editor.sh`: Export environment variables before starting editor
- Modified `test/ui/core/input.sh`: Added key translation and file writing functions (~40 lines)
- Modified `test/ui/lib/api.sh`: Added FIFO cleanup on initialization

## Related Decisions

- [ADR 009: Core Testing Framework MVP](009-core-testing-framework-mvp.md) - Established UI test harness architecture
- [ADR 003: Final Architecture - T-Lisp First](003-final-architecture-tlisp-first.md) - T-Lisp drives all editor functionality

## Alternatives Considered

### 1. tmux send-keys with Literal Flag
**Status**: ❌ Rejected
**Reason**: Doesn't work with raw mode applications
**Details**: Tried `tmux send-keys -l` but keys still didn't reach the editor

### 2. Named Pipes (FIFOs)
**Status**: ❌ Rejected
**Reason**: Node.js/Bun's `fs` module doesn't support `mkfifoSync()`
**Details**: Attempted to create FIFO but got `TypeError: fs.mkfifoSync is not a function`

### 3. Unix Domain Sockets
**Status**: ❌ Not attempted
**Reason**: More complex than file-based approach
**Details**: Would require socket server/client, adds significant complexity

### 4. Process stdin Injection
**Status**: ❌ Not attempted
**Reason**: Complex process manipulation, platform-specific
**Details**: Would need to inject into process stdin stream directly

### 5. tmux Control Mode
**Status**: ⚠️ Considered but not implemented
**Reason**: More complex than file-based approach
**Details**: tmux `-C` flag provides control mode, but requires significant test harness refactoring

## Lessons Learned

1. **Raw Mode Compatibility**: tmux send-keys fundamentally incompatible with raw mode terminal applications
2. **Simple Solutions Win**: File-based polling is simple, reliable, and easy to debug
3. **Test Infrastructure Matters**: Investment in test infrastructure pays off in long-term maintainability
4. **Incremental Problem Solving**: Each attempt revealed new information, leading to the final solution
5. **Debug Logging Critical**: Comprehensive debug logging made it possible to trace input through the system

## Future Improvements

1. **Reduce Polling Frequency**: Could increase interval to 200ms if CPU usage becomes concern
2. **Add Input Macros**: Could support predefined sequences (e.g., "type_word", "delete_line")
3. **Timing Validation**: Could add assertions about input timing for performance testing
4. **Multi-Editor Support**: Could support testing multiple editor instances simultaneously
5. **Input Replay**: Could record and replay input sequences for debugging

## References

- tmux send-keys documentation: `man tmux` (section on send-keys)
- Ink useInput hook: https://github.com/vadimdeminodes/ink#input
- Terminal raw mode: `man termios` (Unix) or `man termios` (macOS)
- Previous research docs:
  - `docs/tmux-send-keys-guide.md` - tmux send-keys investigation
  - `docs/ui-test-python-vs-bash-analysis.md` - Test framework comparison
  - `docs/ui-test-refactoring-opportunities.md` - Earlier test improvements
