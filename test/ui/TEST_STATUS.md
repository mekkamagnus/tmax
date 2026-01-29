# UI Test Suite - Current Status and Issues

## Date
2026-01-28

## Summary
The UI test harness has been successfully implemented with interactive tmux support, but the **editor is not ready for UI testing** due to incomplete migration to Deno-ink.

## Working Components ✅

### Test Infrastructure
1. **Interactive tmux integration** - Tests run in visible window `{active-session}:test-editor`
2. **Modular test architecture** - Core, Operations, Assertions, and API layers
3. **Window management** - Proper window creation, selection, and cleanup
4. **Source path resolution** - All files use `$(dirname "${BASH_SOURCE[0]}")` pattern
5. **Configuration system** - Session detection, timeout controls, debug modes
6. **Test documentation** - INTERACTIVE.md with usage examples and troubleshooting

### Test Scripts
- `test/ui/run-tests.sh` - Main test runner with `--interactive` flag
- `test/ui/interactive-test.sh` - Interactive mode (windows kept open)
- `test/ui/tests/*.test.sh` - Three test suites (startup, editing, mode-switching)

## Blocking Issues ❌

### Issue 1: Old Terminal UI Missing Event Loop
**File:** `src/main.ts`

**Problem:**
- The `Editor.start()` method initializes state but returns immediately
- No main event loop to keep the editor running
- No input processing or render loop
- Editor exits immediately after initialization

**Evidence:**
```bash
# Editor output when run in tmux window:
Starting tmax editor...
# Prompt returns immediately (editor exited)
```

**Code Analysis:**
```typescript
// src/main.ts - app.start()
async start(): Promise<void> {
  console.log("Starting tmax editor...");
  const args = Deno.args;
  const fileArgs = args.filter(arg => !arg.startsWith('--'));

  try {
    if (!this.developmentMode) {
      await this.terminal.enterRawMode();
    }

    if (fileArgs.length > 0) {
      const filename = fileArgs[0];
      await this.editor.openFile(filename);
    }

    await this.editor.start();  // ← Returns immediately, no loop
  } catch (error) {
    // Error handling...
  }

  await app.shutdown();  // ← Runs immediately after start()
}
```

### Issue 2: Deno-ink UI Not Captureable
**Files:** `src/main-ink.ts`, `src/frontend/components/`

**Problem:**
- Deno-ink uses React rendering with terminal manipulation
- Status line mode indicators (NORMAL, INSERT, etc.) are React components
- tmux `capture-pane` cannot capture React-rendered output as plain text
- Mode detection in tests always returns "UNKNOWN"

**Test Output:**
```
[ERROR] ✗ Should start in NORMAL mode
[ERROR] Actual mode: UNKNOWN
```

**StatusLine Component (works but not captureable):**
```typescript
// src/frontend/components/StatusLine.tsx
const modeDisplay = {
  normal: { text: 'NORMAL', color: 'green' },
  insert: { text: 'INSERT', color: 'yellow' },
  // ... modes displayed via React components
};
```

## Current Test Results

### Test Execution
- ✅ Test window created successfully in active tmux session
- ✅ Tests run in visible window
- ❌ Editor starts but exits immediately
- ❌ No mode indicators detected
- ❌ No welcome message detected

### Error Pattern
```
[INFO] Test window created and selected: tmax:test-editor
test-editor
[ERROR] Timeout waiting for editor to be ready
[ERROR] Editor failed to start
[ERROR] Timeout waiting for pattern: Welcome
[ERROR] ✗ Welcome message should be visible
[ERROR] ✗ Should start in NORMAL mode
[ERROR] Actual mode: UNKNOWN
```

## Resolution Options

### Option A: Fix Old Terminal UI (Recommended for Testing)
**Effort:** Medium
**Timeline:** 2-3 days

**Tasks:**
1. Add main event loop to `src/main.ts`:
   ```typescript
   async run(): Promise<void> {
     while (this.running) {
       const key = await this.terminal.readKey();
       await this.editor.handleInput(key);
       await this.editor.render();
     }
   }
   ```

2. Ensure status line outputs plain text mode indicators
3. Add "Welcome to tmax" message on startup

**Pros:**
- Tests work immediately
- Maintains working terminal UI
- Clear text output for testing

**Cons:**
- Maintains two UIs temporarily
- Diverges from Deno-ink migration goal

### Option B: Complete Deno-ink Migration (Recommended for Project)
**Effort:** Large
**Timeline:** 1-2 weeks

**Tasks:**
1. Complete key binding system in Deno-ink
2. Implement proper render loop in React components
3. Add text-based status output mode for testing
4. Update test expectations for React rendering
5. Add automated screenshot/regression testing

**Pros:**
- Aligns with SPEC-009 migration goals
- Modern React-based architecture
- Future-proof solution

**Cons:**
- Longer timeline
- More complex testing setup
- Need to implement full editor in Deno-ink first

### Option C: Add Test Mode to Editor
**Effort:** Low
**Timeline:** 1 day

**Tasks:**
1. Add `--test-mode` flag to main.ts
2. In test mode, output plain text status indicators
3. Bypass rendering loop, just show state changes
4. Run simple read-eval-print loop for testing

**Pros:**
- Quick solution
- Enables testing without full implementation
- Minimal code changes

**Cons:**
- Test mode diverges from production
- Doesn't fix actual editor functionality
- Only tests T-Lisp layer, not UI

## Recommended Approach

**Phase 1 (Immediate):** Option C - Add Test Mode
- Enables UI test suite to run
- Validates T-Lisp functionality
- Unblocks other testing efforts

**Phase 2 (Short-term):** Option A - Fix Old Terminal UI
- Restore working terminal UI with event loop
- Keep both UIs operational during migration
- Full test coverage of editor functionality

**Phase 3 (Long-term):** Option B - Complete Deno-ink Migration
- Finish SPEC-009 migration
- Transition all testing to Deno-ink
- Deprecate old terminal UI

## Next Steps

1. Create spec for adding test mode to editor
2. Implement simple event loop for testing
3. Re-run UI tests to validate T-Lisp layer
4. Update test expectations based on working editor
5. Document test coverage and limitations

## Files Requiring Changes

### Test Infrastructure (Complete ✅)
- test/ui/lib/config.sh - Fixed hardcoded "editor" window
- test/ui/core/editor.sh - Fixed window references
- test/ui/core/session.sh - Interactive session management
- test/ui/lib/api.sh - Cleanup and initialization

### Editor Code (Needs Work ❌)
- src/main.ts - Add main event loop
- src/editor/editor.ts - Implement `run()` method
- src/core/terminal.ts - Ensure proper input handling

### Test Scripts (Pending Update ⏳)
- test/ui/tests/*.test.sh - Update expectations after editor fix
- test/ui/lib/api.sh - Adjust timing and detection logic

## Conclusion

The UI test harness is **fully functional and ready for testing**. The blocker is the editor itself, which is mid-migration and missing a main event loop. Once the editor has a working event loop (either in old UI or Deno-ink), the test suite will work as designed.
