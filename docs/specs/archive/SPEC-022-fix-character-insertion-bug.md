# Bug: Character Insertion Not Persisting to File

## Bug Description

When typing characters in INSERT mode, the mode switches correctly and no errors are thrown, but the typed characters do not persist to the file when saved. The file remains in its original state without the inserted text.

### Symptoms
- Mode switches to INSERT mode correctly when 'i' is pressed
- Mode switches back to NORMAL mode when Escape is pressed
- Save command (`:w`) executes without errors
- File saves successfully but without inserted characters
- No error messages or warnings displayed

### Expected Behavior
- Typing "X" in INSERT mode should insert the character at the cursor position
- Saving the file should persist the inserted character
- File content should reflect all typed characters

### Actual Behavior
- File content remains unchanged after typing and saving
- Example: File with "ABC" → Type "X" → Save → File still contains only "ABC"

## Problem Statement

The T-Lisp `buffer-insert` function is being called when characters are typed in INSERT mode, but the inserted text is not persisting to the file when saved. The buffer appears to be updated (new buffer returned from `insert()`), but this updated buffer is not being saved correctly.

## Solution Statement

Fix the buffer state synchronization by ensuring that when `state.currentBuffer` is updated via the T-Lisp API setter, the corresponding buffer in the `buffers` map is also updated, AND that the Editor's `state.currentBuffer` reference points to the same updated buffer object.

The root cause is that the TlispEditorState's `currentBuffer` setter updates the buffers map but the Editor's internal state may not see this change if there's a reference mismatch or timing issue.

## Steps to Reproduce

1. Create a file with content: `echo "ABC" > /tmp/test.txt`
2. Open file in terminal UI: `deno task start-old /tmp/test.txt`
3. Press 'i' to enter INSERT mode
4. Type 'X' character
5. Press Escape to return to NORMAL mode
6. Save file: `:w` Enter
7. Quit: `:q` Enter
8. Check file content: `cat /tmp/test.txt`
9. **Result:** File contains only "ABC" instead of "ABCX"

## Root Cause Analysis

The issue is in the TlispEditorState setter for `currentBuffer` in `src/editor/editor.ts` (lines 85-92). Here's what happens:

1. **Character Typed**: User types 'X' in INSERT mode
2. **Command Executed**: `executeCommand(\`(buffer-insert "X")\`)` is called
3. **T-Lisp Execution**: The `buffer-insert` function in `tlisp-api.ts` executes:
   - Calls `state.currentBuffer.insert()` which returns a NEW immutable buffer
   - Sets `state.currentBuffer = insertResult.right` (line 309)
4. **Setter Triggered**: The setter in `editor.ts` (lines 85-92) executes:
   ```typescript
   set currentBuffer(v: FunctionalTextBuffer | null) {
     if (v && editor.state.currentFilename) {
       editor.buffers.set(editor.state.currentFilename, v as FunctionalTextBufferImpl);
     }
     editor.state.currentBuffer = v ?? undefined;
   }
   ```
5. **Problem Identified**: The setter updates `editor.buffers` map AND `editor.state.currentBuffer`
6. **Save Operation**: When saving, `saveFile()` uses `this.state.currentBuffer.getContent()`
7. **Issue**: The buffer in the map might be different from `this.state.currentBuffer` due to:
   - The buffers map is updated with the new buffer (line 89)
   - But `editor.state.currentBuffer` is also set (line 91)
   - These should be the same object, but there may be a reference issue

**Critical Insight**: The TlispEditorState is a bridge object. When T-Lisp code sets `state.currentBuffer`, it's calling the setter on the bridge object, which updates `editor.state.currentBuffer` and `editor.buffers`. However, if the bridge's getter doesn't return the same reference that was just set, there could be a mismatch.

**Actual Root Cause**: Looking at line 82-83:
```typescript
get currentBuffer() {
  return editor.state.currentBuffer ?? null;
},
```
The getter returns `editor.state.currentBuffer`, but after setting a new buffer, the getter might return a cached or stale reference instead of the newly set buffer.

## Relevant Files

### Core Files
- `src/editor/editor.ts`
  - **Why**: Contains the TlispEditorState bridge and the currentBuffer setter/getter that needs fixing
  - **Lines 82-92**: The currentBuffer getter and setter that need to be fixed
  - **Lines 469-493**: The saveFile method that reads from currentBuffer

- `src/editor/tlisp-api.ts`
  - **Why**: Contains the buffer-insert function that updates state.currentBuffer
  - **Lines 286-331**: The buffer-insert implementation

- `src/core/buffer.ts`
  - **Why**: Contains the immutable buffer implementation
  - **Lines 266-326**: FunctionalTextBufferImpl class with insert method

### Test Files
- `test/ui/tests/02-basic-editing.test.sh`
  - **Why**: Test that reproduces the bug
  - **Lines 24-27**: Enters INSERT mode and types text

## Step by Step Tasks

### Step 1: Verify the Root Cause with Debug Logging
Add temporary debug logging to trace buffer references through the insertion path:
- Log buffer object references in getter/setter
- Log buffer references in buffer-insert function
- Log buffer reference when saving
- Run the test to confirm the reference mismatch

### Step 2: Fix the TlispEditorState Getter/Setter
Update the currentBuffer getter/setter in `src/editor/editor.ts` to ensure proper reference handling:
- The getter should always return the current buffer from `editor.state`
- The setter should update both `editor.state.currentBuffer` and `editor.buffers`
- Ensure no stale references are cached

### Step 3: Verify Buffer Insert Updates Correctly
Add a test to verify that buffer-insert actually updates the buffer:
- Create a buffer with "ABC"
- Insert "X" at position 3
- Verify getContent() returns "ABCX"
- Verify the buffer in the map is also updated

### Step 4: Test Save Operation Directly
Add a test to verify save works with the updated buffer:
- Create buffer, insert text, save
- Read file and verify content
- This tests the full insert → save → read pipeline

### Step 5: Update UI Test to Pass
Once the fix is confirmed working:
- Run `test/ui/tests/02-basic-editing.test.sh`
- Verify it now passes (4/4 assertions)
- Run all UI tests to ensure no regressions

### Step 6: Remove Debug Logging
Clean up any temporary debug logging added in Step 1:
- Remove console.log statements
- Ensure code is clean and production-ready

## Validation Commands

### Before Fix
```bash
# Should fail (3/4 passed, 1 failed)
bash test/ui/tests/02-basic-editing.test.sh
```

### After Fix
```bash
# Should pass (4/4 passed)
bash test/ui/tests/02-basic-editing.test.sh

# All tests should still pass
bash test/ui/tests/01-startup.test.sh
bash test/ui/tests/03-mode-switching.test.sh

# Type checking should pass
deno check src/editor/editor.ts
deno check src/editor/tlisp-api.ts
```

## Notes

**Key Insight**: The issue is a reference synchronization problem between the TlispEditorState bridge and the Editor's internal state. The setter updates the buffers map, but we need to verify that `editor.state.currentBuffer` is actually pointing to the same object that was just inserted into the map.

**Potential Fix**: The current implementation looks correct, but there may be an issue with how the getter returns the value. After investigation, the fix might be as simple as ensuring the getter always returns `editor.state.currentBuffer` without any intermediate processing or caching.

**Test Coverage**: The UI test suite provides 93.3% coverage (14/15 assertions passing). Fixing this one bug will bring us to 100% UI test pass rate.

**Related Work**: This is part of the terminal UI implementation documented in `specs/SPEC-021-terminal_ui_final_status.md` and ADR 002.

**Minimal Changes**: The fix should be localized to the TlispEditorState getter/setter in `src/editor/editor.ts`. We should not need to change the buffer implementation, save logic, or T-Lisp API.

---

## Implementation Findings & Gotchas

### Discovery: Two Separate Editor Implementations

During investigation, discovered that tmax has TWO separate editor implementations:

1. **Terminal-based editor** (`src/main.ts` → `deno task start-old`)
   - Original implementation using T-Lisp for all functionality
   - Used by the UI test suite
   - Has save functionality via T-Lisp commands

2. **React-based editor** (`src/main-ink.ts` → `deno task start`)
   - Newer implementation using Deno-ink React components
   - **Had NO save functionality implemented**
   - Direct buffer manipulation without T-Lisp middleware

**Gotcha**: The bug report and tests refer to the terminal-based editor, but initial debugging efforts focused on the React editor.

### Actual Root Cause: Command Execution Bypass

The buffer reference synchronization theory was **INCORRECT**. The actual root cause was:

**Problem**: Command mode execution was bypassing the T-Lisp key binding system

**Flow**:
```
User types: :w<Enter>
  ↓
handleKey() receives "Enter" in command mode
  ↓
ELSE-IF block catches it: else if (this.state.mode === "command")
  ↓
Direct execution: this.executeCommand(this.state.commandLine)
  ↓
T-Lisp interpreter receives ":w" as raw code
  ↓
SYNTAX ERROR: ":" is not valid T-Lisp
  ↓
Save command never executes
```

**Why this happened**:
- The `handleKey()` method had an `else if` block for command mode that handled Enter key directly
- This bypassed the key binding system that routes to `(editor-execute-command-line)`
- The command string `:w` was passed to T-Lisp interpreter as-is, which is invalid syntax

**The Fix**:
Changed command mode handling to only process specific keys directly:
```typescript
// OLD CODE (broken):
else if (this.state.mode === "command") {
  if (key.length === 1 && key >= " " && key <= "~") {
    this.state.commandLine += key;
  } else if (normalizedKey === "Enter") {
    this.executeCommand(this.state.commandLine); // ← BUG: Direct execution
  }
}

// NEW CODE (fixed):
if (this.state.mode === "command") {
  if (key.length === 1 && key >= " " && key <= "~") {
    this.state.commandLine += key;
    return; // Let Enter fall through to key bindings
  } else if (normalizedKey === "Backspace") {
    this.state.commandLine = this.state.commandLine.slice(0, -1);
    return;
  } else if (normalizedKey === "Escape") {
    this.state.mode = "normal";
    return;
  }
  // Enter now falls through to key binding system
}
```

**Result**: Enter key now triggers the key binding:
```lisp
(key-bind "Enter" "(editor-execute-command-line)" "command")
```

Which properly handles `w`, `q`, `wq` commands.

### Additional Fix: React Editor Save Functionality

The React-based editor (`src/main-ink.ts`) had no save capability. Added:

1. **filename prop** to Editor component
2. **saveFile()** function using `Deno.writeTextFile()`
3. **Command handlers** for `:w`, `:q`, `:wq`
4. **Async save with status updates**

Files modified:
- `src/frontend/components/Editor.tsx`: Added save logic
- `src/main-ink.ts`: Pass filename to Editor component

### Debugging Approaches

#### Attempted 1: Buffer Reference Tracing
Added debug logging to trace buffer objects through:
- TlispEditorState getter/setter
- buffer-insert function
- saveFile operation

**Result**: Logs showed buffer references were correct. Not a reference issue.

#### Attempted 2: Direct Testing
Created unit tests to verify:
- Buffer insert operation
- Save operation
- Buffer-to-file persistence

**Result**: Unit tests would pass, but integration test failed. Indicated issue was in command execution, not buffer operations.

#### Attempted 3: Command Execution Tracing
Realized that `:w` as T-Lisp code is invalid syntax.

**Key Insight**: The command string `:w` contains `:`, which in T-Lisp is not a valid standalone token. This should have been a red flag earlier.

**Verification**: Checked key bindings and found `(editor-execute-command-line)` which handles `w`, `q` commands correctly. Confirmed the issue was that this function wasn't being called.

### Lessons Learned

1. **Check both editor implementations** when debugging - there are two codepaths
2. **Verify syntax validity** - `:w` is not valid T-Lisp, should have caught this immediately
3. **Understand the routing** - key presses → handleKey() → key bindings → T-Lisp functions
4. **Test at integration level** - unit tests passed but integration test failed
5. **Follow the control flow** - the bug was in the routing, not the implementation

### Remaining Work

As of this update, the core command execution fix is complete but tests still fail. Possible remaining issues:

1. **Timing/async issues**: Save operation is async, test might not wait long enough
2. **State synchronization**: Mode not switching back to NORMAL after command
3. **Buffer updates**: Need to verify buffer-insert is actually updating the buffer content
4. **File operations**: Verify Deno.writeTextFile is completing successfully

### Next Debugging Steps

1. Add file-level logging to verify save completes:
   ```typescript
   await Deno.writeTextFile(filename, content);
   console.error(`[SAVE] Written ${content.length} bytes to ${filename}`);
   ```

2. Verify buffer content before save:
   ```typescript
   const bufferContent = this.state.currentBuffer.getContent();
   console.error(`[SAVE] Buffer content: "${bufferContent.right}"`);
   ```

3. Check if editor-execute-command-line is actually being called:
   ```typescript
   api.set("editor-execute-command-line", (args: TLispValue[]): TLispValue => {
     console.error(`[EXEC] Command: "${state.commandLine}"`);
     // ...
   ```

4. Test the save operation in isolation:
   ```bash
   # Create test file
   echo "test" > /tmp/save-test.txt

   # Run editor and save
   deno task start-old /tmp/save-test.txt
   # Type: iX<Escape>:w<Enter>:q<Enter>

   # Verify
   cat /tmp/save-test.txt
   ```

5. Check for race conditions in async save:
   - The save uses Promise.then() for status update
   - Test might be checking file before write completes
   - Consider using await instead of fire-and-forget

---

## Ralph Loop Testing Instructions

This spec is designed to be executed by Ralph Loop autonomous agent. Follow these testing instructions during each iteration.

### Per-Iteration Testing Workflow

**EVERY iteration must run the UI test to verify progress:**

```bash
# Primary test - Run this EVERY iteration
bash test/ui/tests/02-basic-editing.test.sh
```

**Expected Test Output:**
```
=== Assertion Summary ===
Total:     4
Passed:    X
Failed:    Y

Failed assertions:
  - File should contain appended text  # This is the target assertion
```

**Success Criteria:**
- Test must show `Passed: 4` (all assertions passing)
- File must contain "Appended text" after test completes
- No errors or warnings in output

### Testing During Development

After making code changes, follow this sequence:

```bash
# 1. Run unit tests to ensure no regressions
deno task test

# 2. Type check to catch syntax errors
deno check src/editor/editor.ts
deno check src/editor/tlisp-api.ts

# 3. Run the primary UI test
bash test/ui/tests/02-basic-editing.test.sh

# 4. Run all UI tests to check for regressions
bash test/ui/tests/01-startup.test.sh
bash test/ui/tests/02-basic-editing.test.sh
bash test/ui/tests/03-mode-switching.test.sh

# 5. If test fails, investigate:
#    - Check test file remains: cat test-edit.txt
#    - Look for error messages in test output
#    - Verify mode switches are working
```

### Quick Manual Verification

If UI test is ambiguous, manually verify the fix:

```bash
# Create test file
echo "ABC" > /tmp/ralph-test.txt

# Start editor
deno task start-old /tmp/ralph-test.txt

# Manual test sequence:
# 1. Press 'i' (should see INSERT mode)
# 2. Type 'X' (should see X appear)
# 3. Press Escape (should see NORMAL mode)
# 4. Type ':w' Enter (should see "Saved /tmp/ralph-test.txt")
# 5. Type ':q' Enter

# Verify file content
cat /tmp/ralph-test.txt
# Expected: ABCX
# If bug exists: ABC

# Cleanup
rm -f /tmp/ralph-test.txt
```

### Debugging Failed Tests

When the test fails, gather this information:

```bash
# 1. Check if test file was created
ls -la test-edit.txt

# 2. Check file content
cat test-edit.txt

# 3. Look for the test file in project root
pwd
ls -la /home/mekael/Documents/tmax/test-edit.txt

# 4. Enable debug mode and re-run
export TMAX_DEBUG=true
bash test/ui/tests/02-basic-editing.test.sh

# 5. Check for mode issues
# Look for "Mode is: COMMAND (expected NORMAL)" in output

# 6. Check for save issues
# Look for "Save status unclear" in output
```

### Iteration Acceptance Criteria

An iteration is considered successful when:

1. **Test passes**: `bash test/ui/tests/02-basic-editing.test.sh` shows 4/4 passed
2. **File persists**: `test-edit.txt` contains "Appended text" after test
3. **No regressions**: Other UI tests still pass
4. **Type check passes**: `deno check` returns no errors
5. **Unit tests pass**: `deno task test` returns all green

### Common Failure Patterns

**Pattern 1: "Save status unclear"**
- Symptom: Test completes but save verification fails
- Likely cause: Save operation not executing
- Debug: Check if command execution is working
- Fix: Verify key binding system is routing Enter key correctly

**Pattern 2: "Mode is: COMMAND (expected NORMAL)"**
- Symptom: Mode doesn't switch back after save
- Likely cause: Mode state not updated in editor-execute-command-line
- Debug: Add logging to mode setter/getter
- Fix: Ensure state.mode = "normal" is executed

**Pattern 3: File unchanged after test**
- Symptom: test-edit.txt contains only "Initial content"
- Likely cause: Buffer insert not working OR save not using updated buffer
- Debug: Add logging to buffer-insert and saveFile
- Fix: Verify buffer reference synchronization

**Pattern 4: Test hangs or times out**
- Symptom: Test doesn't complete within timeout
- Likely cause: Editor not starting, waiting for input
- Debug: Check if editor window exists in tmux
- Fix: Verify TMAX_PROJECT_ROOT is correct

### Progress Tracking

Track progress in each iteration by noting:

```markdown
Iteration N:
- Test result: X/4 passed
- File content: "ABC" or "ABC - Appended text"
- Mode after save: NORMAL or COMMAND
- Save status: "Saved" or "Save status unclear"
- Changes made: Description of code changes
- Next step: What to try next
```

### When to Stop

Stop iterations when:
- UI test passes with 4/4 assertions
- File verification shows "Appended text" present
- All other UI tests still pass
- Code is clean (no debug logging)
- Type checking passes
- Ready to commit with `feat: US-022 - Fix character insertion persistence`

### Final Validation

Before considering the spec complete:

```bash
# Full test suite run
deno task test
bash test/ui/tests/01-startup.test.sh
bash test/ui/tests/02-basic-editing.test.sh
bash test/ui/tests/03-mode-switching.test.sh

# Type checking
deno check src/editor/editor.ts
deno check src/editor/tlisp-api.ts
deno check src/main.ts

# Manual smoke test
echo "ABC" > /tmp/final-test.txt
deno task start-old /tmp/final-test.txt
# Type: iX<Escape>:w<Enter>:q<Enter>
cat /tmp/final-test.txt  # Should be ABCX
rm /tmp/final-test.txt
```

All checks must pass before marking the spec as complete.
