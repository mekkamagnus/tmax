# SPEC-023: Complete Deno-ink TUI Implementation

## Chore Description

Transform tmax into a fully functional, production-ready Deno-ink terminal UI application following the **Emacs architecture**: T-Lisp as the core engine (like Emacs Lisp) with React/ink as a thin UI rendering layer. The project currently has a partial React/ink implementation with basic components but lacks critical functionality including proper file handling, working event loops, T-Lisp integration, and UI test compatibility.

**Architecture Principle: T-Lisp First (Like Emacs)**
```
User Input (Keyboard)
  ↓
React/ink UI (Thin Layer: Capture + Render)
  ↓
T-Lisp Interpreter (Core: All Logic)
  ↓
Editor State (Pure Data)
  ↓
React/ink UI (Render State)
```

**Current State:**
- React components exist but have TOO MUCH LOGIC (should be in T-Lisp)
- Basic movement and editing works in demo mode
- Crashes on file errors
- No visible output in tmux environments
- UI tests completely broken (0% passing)
- T-Lisp integration incomplete (React bypasses T-Lisp for some operations)
- Missing proper event loop
- No alternate screen buffer management

**Target State:**
- **T-Lisp as the core** (all editor logic in T-Lisp, like Emacs)
- **React as thin UI layer** (only capture input + render output, no business logic)
- Fully functional Deno-ink TUI that works in real terminals and tmux
- Robust file I/O with graceful error handling
- Complete T-Lisp interpreter integration
- All UI tests passing (100% blackbox testing)
- Production-ready error handling and edge cases
- Proper cleanup and resource management

**Key Design Decisions:**
- React components are DUMB - just UI rendering, no business logic
- All editor operations go through T-Lisp functions
- Unit tests test T-Lisp API and core logic
- UI tests are blackbox (simulate user typing in terminal)
- Frontend tests test React rendering integration only

## Relevant Files

### Core Application Files

- **src/main.ts** (CREATE - Rename from main-ink.ts)
  - Why: Single entry point using standard naming convention
  - Changes: Rename main-ink.ts → main.ts, initialize T-Lisp interpreter, integrate with Editor class

- **src/editor/editor.ts** (KEEP & ENHANCE)
  - Why: Core Editor class with T-Lisp integration (like Emacs core)
  - Changes: Ensure all operations go through T-Lisp, add React state callbacks, keep all business logic

- **src/editor/tlisp-api.ts** (ENHANCE)
  - Why: T-Lisp functions - ALL editor logic lives here (like Emacs Lisp)
  - Changes: Complete API coverage, ensure all functions work with Editor state, add React state synchronization

- **src/frontend/components/Editor.tsx** (SIMPLIFY)
  - Why: Thin React UI layer - ONLY capture input and render state
  - Changes: Remove business logic, just call T-Lisp functions and render resulting state

- **src/frontend/hooks/useEditorState.ts** (ENHANCE)
  - Why: Bridge React state with T-Lisp/Editor state
  - Changes: Add T-Lisp execution, synchronize Editor state with React state

- **src/frontend/ink-adapter.ts** (MINIMAL CHANGES)
  - Why: Bridges functional terminal interface with Deno-ink
  - Changes: Already good, just ensure TTY handling works for testing

- **src/tlisp/** (NO CHANGES - CORE IS GOOD)
  - Why: T-Lisp interpreter (tokenizer, parser, evaluator)
  - Changes: None - the interpreter is solid and complete

### UI Test Infrastructure

- **test/ui/lib/config.sh**
  - Why: Test harness configuration
  - Changes: Already updated to use --dev flag for Deno-ink

- **test/ui/core/query.sh**
  - Why: Mode detection and state queries for tests
  - Changes: Improve pattern matching for React UI status line

- **test/ui/tests/** (ALL TESTS)
  - Why: **Blackbox integration tests** - simulate real user typing in terminal
  - Changes: Adjust assertions to work with React UI rendering patterns
  - Philosophy: Test entire system from keyboard to screen, no internal access

### Test Suite Philosophy (IMPORTANT)

**Three Test Layers:**

1. **Unit Tests (test/unit/)** - Test T-Lisp API and Core Logic
   - Test buffer operations, parser, evaluator, etc.
   - Test Editor class methods with mocks
   - Fast, isolated, no UI involved
   - Example: `buffer.insert()`, `parser.parse()`, `editor.executeCommand()`

2. **Frontend Tests (test/frontend/)** - Test React Rendering Integration
   - Test React components render correctly
   - Test state synchronization between Editor and React
   - Test Ink adapter functionality
   - Example: `<Editor />` renders buffer content, mode indicators

3. **UI Tests (test/ui/tests/)** - **Blackbox Integration Testing**
   - Simulate real user typing in terminal
   - Test ENTIRE system from keyboard to rendered output
   - No access to internals - just like a real user
   - Example: Type 'i', type 'hello', press Escape, see 'NORMAL' mode

**Key Principle:** UI tests don't care about implementation. They just simulate:
```
User types: i
User types: hello
User types: Escape
Expected: Screen shows "hello" and "NORMAL" mode indicator
```

How the system gets there (T-Lisp, React, buffers) is irrelevant to the test.

### Documentation

- **README.md**
  - Why: User-facing documentation
  - Changes: Update to reflect single UI approach, add Deno-ink examples

- **CLAUDE.md**
  - Why: AI assistant development guidelines
  - Changes: Remove old terminal UI references, update with React/ink patterns

## Step by Step Tasks

### Step 1: Fix File Loading and Error Handling

**Objective**: Prevent crashes when files don't exist or have errors.

- Update `src/main.ts` (renamed from main-ink.ts):
  - Add try-catch around file loading with graceful fallback
  - Create new empty buffer if file doesn't exist (normal behavior for editors)
  - Show user-friendly error messages in status line instead of crashing
  - Return early from render() if file loading fails critically
  - Add file existence check before attempting to read

**Acceptance:**
```bash
# Should create new buffer instead of crashing
deno task start nonexistent.txt
# Editor opens with empty buffer, status: "new file"
```

### Step 2: Implement Proper Event Loop with Deno-ink

**Objective**: Make Deno-ink render() work correctly with keyboard input.

- Update `src/main.ts`:
  - Remove the async/await wrapper around render() call
  - Let render() handle its own event loop (Deno-ink manages this)
  - Remove custom key press resolver system (not needed with useInput)
  - Ensure render() is the last call in main()
  - Add proper cleanup with Deno.addSignalListener for SIGINT/SIGTERM

- Update `src/frontend/ink-adapter.ts`:
  - Remove readKey() promise implementation (not used in React/ink)
  - Keep only terminal size management methods
  - Document that keyboard events are handled by useInput hook

**Acceptance:**
```bash
deno task start test.txt
# Should show editor UI, accept keyboard input, render correctly
```

### Step 3: Fix TTY Detection and Non-TTY Environments

**Objective**: Make editor work in tmux and development environments.

- Update `src/main.ts`:
  - Keep --dev flag but make TTY checks non-blocking
  - In development mode, skip Deno.stdin.isTerminal() check
  - Allow render() to proceed even in non-TTY (for testing)
  - Add clear error message if render() fails due to TTY issues

- Update `src/frontend/ink-adapter.ts`:
  - Make isStdinTTY() return Either.right(true) in --dev mode
  - Add fallback size handling for non-TTY environments
  - Document that --dev is for AI coding assistants and testing

**Acceptance:**
```bash
# Should work in tmux without TTY errors
deno task start --dev test.txt
```

### Step 4: Integrate T-Lisp with React (T-Lisp Drives Everything)

**Objective**: Make T-Lisp the core logic engine, React just renders state.

**IMPORTANT: React is DUMB, T-Lisp is SMART**

- Update `src/editor/editor.ts`:
  - Initialize T-Lisp interpreter with Editor instance
  - Add `onStateChange` callback that React can subscribe to
  - Ensure all state mutations go through T-Lisp functions
  - Export method to execute T-Lisp code strings

- Update `src/editor/tlisp-api.ts`:
  - Ensure ALL editor operations are available as T-Lisp functions
  - Add callback mechanism: when T-Lisp modifies state, notify React
  - Functions needed: cursor-move, buffer-insert, buffer-delete, editor-set-mode, etc.

- Update `src/frontend/hooks/useEditorState.ts`:
  - Subscribe to Editor state changes via callback
  - When Editor state changes, update React state (trigger re-render)
  - Provide `executeTlisp(code)` function that calls Editor.executeTlisp()

- SIMPLIFY `src/frontend/components/Editor.tsx`:
  - Remove ALL business logic from Editor.tsx
  - Keyboard input → execute T-Lisp function → render result
  - Example: User types 'i' → execute `(editor-set-mode 'insert')` → render new state

**Architecture Diagram:**
```
User types 'i'
  ↓
Editor.tsx useInput hook
  ↓
Call executeTlisp("(editor-set-mode 'insert')")
  ↓
Editor.executeTlisp() → T-Lisp interpreter
  ↓
T-Lisp executes editor-set-mode function
  ↓
Function updates Editor.state
  ↓
Editor notifies subscribers via onStateChange callback
  ↓
useEditorState hook updates React state
  ↓
React re-renders with new state
```

**Acceptance:**
```typescript
// In Editor.tsx, ALL operations go through T-Lisp:
useInput((input, key) => {
  if (input === 'i') {
    // Call T-Lisp function, don't manipulate state directly
    executeTlisp("(editor-set-mode 'insert)");
  }
  if (state.mode === 'insert' && input.length === 1) {
    // Call T-Lisp function
    executeTlisp(`(buffer-insert "${input}")`);
  }
  // React NEVER manipulates state directly, only renders
});
```

### Step 5: Implement Save Functionality with File Management

**Objective**: Enable saving files with proper error handling.

- Update `src/frontend/components/Editor.tsx`:
  - Implement saveFile() with proper error handling
  - Add saveAs() for "save as" functionality
  - Show save status in status line
  - Handle write errors gracefully

- Update `src/main.ts`:
  - Track filename in application state
  - Pass filename to Editor component
  - Support command-line file argument

**Acceptance:**
```bash
echo "test" > /tmp/tmax-save.txt
deno task start /tmp/tmax-save.txt
# Type: i -> more text -> Escape -> :w
cat /tmp/tmax-save.txt
# Should show: "testmore text"
```

### Step 6: Implement Mode Switching and Key Bindings (T-Lisp Driven)

**Objective**: All modes work correctly with proper transitions via T-Lisp.

**CRITICAL: Key bindings call T-Lisp functions, not React logic**

- Update `src/editor/tlisp-api.ts`:
  - Ensure these T-Lisp functions exist and work:
    - `(editor-set-mode 'normal|'insert|'visual|'command|'mx)` - Set mode
    - `(cursor-move line column)` - Move cursor
    - `(buffer-insert text)` - Insert text at cursor
    - `(buffer-delete count)` - Delete characters
    - `(file-write filename)` - Save file
    - `(file-read filename)` - Load file
    - `(editor-quit)` - Quit editor

- Update `src/editor/editor.ts` key bindings:
  - Map keys to T-Lisp expressions (like Emacs keymaps)
  - Example: 'i' key → executes `(editor-set-mode 'insert)`
  - Example: 'h' key → executes `(cursor-move 0 (- (cursor-column) 1))`
  - Return key → executes `(buffer-insert "\n")`

- SIMPLIFY `src/frontend/components/Editor.tsx`:
  - Remove handleNormalMode(), handleInsertMode(), handleVisualMode() functions
  - Replace with simple key → T-Lisp execution:
  ```typescript
  useInput((input, key) => {
    // Just execute the T-Lisp expression for this key
    const tlispCode = getKeyBinding(input, key, state.mode);
    if (tlispCode) {
      executeTlisp(tlispCode);
    }
  });
  ```

- Update `src/frontend/components/StatusLine.tsx`:
  - Pure rendering component - displays mode from state
  - No logic, just display what T-Lisp set mode to

**Key Binding System (T-Lisp First):**
```lisp
;; In T-Lisp, define key bindings (like Emacs):
(key-bind "i" "(editor-set-mode 'insert)" "normal")
(key-bind "h" "(cursor-move 0 (- (cursor-column) 1))" "normal")
(key-bind "j" "(cursor-move (+ (cursor-line) 1) (cursor-column))" "normal")
(key-bind "k" "(cursor-move (- (cursor-line) 1) (cursor-column))" "normal")
(key-bind "l" "(cursor-move 0 (+ (cursor-column) 1))" "normal")
(key-bind "Escape" "(editor-set-mode 'normal)" "insert")
```

**Acceptance:**
```bash
deno task start test.txt
# Press: i → Executes (editor-set-mode 'insert)
# Type: hello → Executes (buffer-insert "h") (buffer-insert "e") ...
# Press: Escape → Executes (editor-set-mode 'normal)
# Press: :w → Executes (file-write filename)
# Press: :q → Executes (editor-quit)
```

**Verification:**
```typescript
// In Editor.tsx, there should be NO mode handling logic:
// BAD (don't do this):
const handleNormalMode = (input) => {
  if (input === 'h') setState(prev => ({...prev, cursor: ...}));
}

// GOOD (do this):
const handleKeyPress = (input) => {
  executeTlisp(getKeyBinding(input, state.mode));
}
```

### Step 7: Fix UI Tests for Deno-ink Compatibility

**Objective**: All UI tests pass with React UI.

- Update `test/ui/core/query.sh`:
  - Improve mode detection patterns for React status line
  - Handle ANSI escape codes in status line
  - Add query for command line visibility

- Update UI test files:
  - Adjust timing expectations (React rendering may be slower)
  - Use --dev flag for all tests
  - Update assertions to match React UI patterns

**Acceptance:**
```bash
bash test/ui/tests/01-startup.test.sh
# Result: 3/3 passed

bash test/ui/tests/02-basic-editing.test.sh
# Result: 4/4 passed

bash test/ui/tests/03-mode-switching.test.sh
# Result: 8/8 passed
```

### Step 8: Implement Buffer Display and Cursor Rendering

**Objective**: Buffer content displays correctly with visible cursor.

- Update `src/frontend/components/BufferView.tsx`:
  - Render buffer lines with proper truncation
  - Highlight cursor position with inverse video or underline
  - Handle long lines (> terminal width)
  - Implement viewport scrolling
  - Show line numbers if enabled

- Update `src/frontend/components/Editor.tsx`:
  - Pass cursor rendering props to BufferView
  - Update viewportTop based on cursor position
  - Handle terminal resize events

**Acceptance:**
```bash
# Create long file
for i in {1..100}; do echo "Line $i with some text"; done > /tmp/long.txt
deno task start /tmp/long.txt
# Should scroll through file, cursor visible, no overflow
```

### Step 9: Add Comprehensive Error Handling

**Objective**: Graceful error handling throughout the application.

- Update `src/frontend/components/Editor.tsx`:
  - Wrap all operations in try-catch
  - Show errors in status line (not console)
  - Clear errors after timeout
  - Continue running after non-fatal errors

- Update `src/main.ts`:
  - Global error handler for render() errors
  - Graceful shutdown on SIGINT/SIGTERM
  - Cleanup temp files on exit
  - Save backup of unsaved changes

**Acceptance:**
```bash
deno task start /root/protected-file.txt
# Should show: "Error: Permission denied" in status line
# Editor continues running
```

### Step 10: Performance Optimization

**Objective**: Smooth, responsive UI even with large files.

- Update `src/frontend/components/Editor.tsx`:
  - Add React.memo() to BufferView component
  - Implement viewport-based rendering (only visible lines)
  - Debounce rapid state updates
  - Use useCallback for event handlers

- Update `src/frontend/hooks/useEditorState.ts`:
  - Optimize state update logic
  - Prevent unnecessary re-renders
  - Batch state updates where possible

**Acceptance:**
```bash
# Create very large file (10,000 lines)
for i in {1..10000}; do echo "Line $i with text content here"; done > /tmp/huge.txt
deno task start /tmp/huge.txt
# Should open quickly, scroll smoothly, no lag
```

### Step 11: Update Documentation

**Objective**: Documentation reflects single React UI approach.

- Update `README.md`:
  - Remove references to old terminal UI
  - Update usage examples for Deno-ink
  - Document --dev flag for development
  - Update architecture section

- Update `CLAUDE.md`:
  - Remove old terminal UI instructions
  - Add React/ink best practices
  - Update UI test documentation
  - Document component structure

- Create `docs/DENO-INK-ARCHITECTURE.md` (NEW FILE):
  - React component hierarchy
  - State management patterns
  - Event handling flow
  - T-Lisp integration architecture

**Acceptance:**
```bash
# Documentation checks
grep -r "start-old" README.md CLAUDE.md
# Should return: no results

grep -r "main-ink.ts" README.md
# Should return: no results
```

### Step 12: Final Validation and Cleanup

**Objective**: Ensure everything works with zero regressions.

- Run full test suite:
  - All unit tests pass
  - All UI tests pass (100%)
  - TypeScript compiles without errors
  - Linting passes

- Manual testing checklist:
  - Create new file
  - Open existing file
  - Edit text (insert, delete, backspace)
  - Save file
  - Save as new filename
  - Quit with :q, :wq
  - Mode switching works
  - Cursor movement works (h,j,k,l)
  - Command mode works (:w, :q, :wq)
  - Long files scroll correctly
  - Terminal resize handled correctly

- Remove any leftover old code:
  - Delete any backup files
  - Remove commented-out old terminal code
  - Clean up unused imports
  - Remove debug console.log statements

**Acceptance:**
```bash
# Complete validation
deno task test          # All 131+ unit tests pass
deno check src/**/*.ts  # Zero TypeScript errors
deno lint              # Zero lint errors
bash test/ui/tests/*.test.sh  # All 19/19 assertions pass

# Final manual test
echo "Hello World" > /tmp/final.txt
deno task start /tmp/final.txt
# Make changes, save, quit
cat /tmp/final.txt
# Changes should be present
```

## Validation Commands

Execute every command to validate the spec is complete with zero regressions:

### TypeScript Compilation
```bash
# Type check all TypeScript files
deno check src/main.ts
deno check src/frontend/**/*.tsx
deno check src/frontend/**/*.ts
deno check src/editor/**/*.ts
deno check src/core/**/*.ts
deno check src/tlisp/**/*.ts
# Expected: Zero errors, all files pass type checking
```

### Unit Tests
```bash
# Run complete unit test suite
deno task test
# Expected: 131+ tests passing, 0 failures

# Run tests with coverage
deno task test:coverage
# Expected: >80% code coverage
```

### UI Tests (Critical)
```bash
# Test 1: Startup
bash test/ui/tests/01-startup.test.sh
# Expected: 3/3 assertions passed
# Assertions:
#   - Editor should be running
#   - Should start in NORMAL mode
#   - No errors should be present

# Test 2: Basic Editing
bash test/ui/tests/02-basic-editing.test.sh
# Expected: 4/4 assertions passed
# Assertions:
#   - File content should be visible
#   - Should be in mode: INSERT
#   - Should be in mode: NORMAL
#   - File should contain appended text

# Test 3: Mode Switching
bash test/ui/tests/03-mode-switching.test.sh
# Expected: 8/8 assertions passed
# Assertions:
#   - Should start in NORMAL mode
#   - Should be in INSERT mode
#   - Should return to NORMAL mode
#   - Should be in COMMAND mode
#   - Should return to NORMAL mode
#   - Should still be in NORMAL mode after navigation
#   - Should still be in INSERT mode after typing
#   - Should return to NORMAL mode

# Overall UI test result
bash test/ui/run-tests.sh
# Expected: 15/15 assertions passed (100% pass rate)
```

### Linting and Formatting
```bash
# Check code formatting
deno task fmt:check
# Expected: No formatting needed

# Run linter
deno task lint
# Expected: Zero lint errors
```

### Manual Integration Tests
```bash
# Test 1: Create new file
echo "" > /tmp/new-file.txt
deno task start /tmp/new-file.txt
# In editor: Press 'i', type 'test content', Escape, :w, :q
cat /tmp/new-file.txt
# Expected: File contains 'test content'

# Test 2: Open existing file
echo "existing content" > /tmp/existing.txt
deno task start /tmp/existing.txt
# In editor: Press 'i', type ' more', Escape, :w, :q
cat /tmp/existing.txt
# Expected: File contains 'existing content more'

# Test 3: Large file
for i in {1..1000}; do echo "Line $i"; done > /tmp/large.txt
deno task start /tmp/large.txt
# In editor: Scroll with j/k keys, should be smooth
# Expected: No lag, smooth scrolling

# Test 4: Non-existent file (should create new)
deno task start /tmp/nonexistent.txt
# In editor: Type 'created', Escape, :w, :q
cat /tmp/nonexistent.txt
# Expected: File created with 'created'

# Test 5: Error handling
deno task start /root/protected.txt 2>&1 | head -5
# Expected: Error message in status line, editor doesn't crash
```

### Documentation Validation
```bash
# Ensure no old terminal UI references
! grep -r "start-old" README.md CLAUDE.md specs/
# Expected: No results

# Ensure no main-ink.ts references
! grep -r "main-ink" README.md deno.json bin/tmax
# Expected: No results

# Verify main.ts exists and is used
test -f src/main.ts
grep -q "src/main.ts" deno.json
# Expected: Both pass
```

### Development Mode Tests
```bash
# Test --dev flag in tmux
tmux new-session -d -s tmax-dev "deno task start --dev /tmp/dev-test.txt"
sleep 3
tmux capture-pane -t tmax-dev -p | grep -E "NORMAL|INSERT"
# Expected: Mode indicator visible
tmux kill-session -t tmax-dev
```

## Notes

### Key Architecture Decisions

1. **Single Entry Point**: `src/main.ts` is the only entry point. No main-ink.ts or old terminal UI.

2. **React/ink Only**: All UI rendering uses Deno-ink React components. No direct terminal manipulation.

3. **T-Lisp Integration**: T-Lisp functions manipulate React state through bridge functions, not direct DOM manipulation.

4. **Event Loop**: Deno-ink's `render()` function manages the event loop. We don't create a custom loop.

5. **Testing Strategy**: UI tests use tmux with --dev flag to bypass TTY requirements.

### Performance Considerations

- React.memo() prevents unnecessary re-renders
- Viewport-based rendering limits display to visible lines only
- Debouncing prevents excessive state updates
- Callbacks are memoized with useCallback

### Error Handling Philosophy

- Never crash the editor due to file I/O errors
- Show errors in status line, not console.error
- Continue operation after non-fatal errors
- Save backup of unsaved changes before critical failures

### Migration Path from Old Terminal UI

The old terminal UI (`src/main.ts` before deletion) had:
- Manual render() function
- Direct ANSI escape codes
- Custom event loop
- Raw terminal manipulation

The new Deno-ink UI replaces all of this with:
- Declarative React components
- Deno-ink's terminal abstraction
- Framework-managed event loop
- Component-based architecture

### Testing in Non-TTY Environments

The --dev flag is critical for:
- AI coding assistants (Claude Code, Copilot)
- tmux-based testing
- CI/CD environments
- Development without physical terminal

### Future Enhancements (Out of Scope for This Spec)

- Syntax highlighting
- Multiple buffers/tabs
- Split screen
- LSP integration
- Plugin system
- Undo/redo history
- Search and replace
- Macro recording

### Success Criteria

This spec is complete when:
1. ✅ All UI tests pass (15/15 assertions, 100%)
2. ✅ All unit tests pass (131+ tests)
3. ✅ Zero TypeScript errors
4. ✅ Zero lint errors
5. ✅ Editor works in real terminal
6. ✅ Editor works in tmux
7. ✅ File operations work (create, open, save, save as)
8. ✅ Mode switching works
9. ✅ Cursor movement works
10. ✅ T-Lisp integration functional
11. ✅ Documentation updated
12. ✅ No old terminal UI code remains

### Estimated Timeline

- Step 1-3 (Critical fixes): 2-3 hours
- Step 4-6 (Core functionality): 4-6 hours
- Step 7-9 (Polish and tests): 3-4 hours
- Step 10-12 (Optimization and docs): 2-3 hours

**Total**: 11-16 hours of focused development work

### Dependencies

- Deno 2.3.7+
- jsr:@deno-ink/core@latest
- React 18.2.0 (via Deno-ink)
- tmux (for UI testing)

### References

- Deno-ink documentation: https://jsx.deno.dev/
- React hooks: https://react.dev/reference/react
- T-Lisp spec: specs/SPECS_INDEX.md
- UI test harness: test/ui/README.md
- Functional patterns: functional-patterns-guidelines.md
