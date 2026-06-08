# RFC-007: UI Test Infrastructure — Status, Root Causes, and Proposed Fixes

**Status:** 🔍 INVESTIGATION
**Created:** 2026-01-29
**Updated:** 2026-06-08
**Author:** tmax Design Team
**Phase:** QA Infrastructure

## Table of Contents
- [Abstract](#abstract)
- [Test Results](#test-results)
- [Root Cause Analysis](#root-cause-analysis)
- [Proposed Solution](#proposed-solution)
- [Infrastructure Improvements](#infrastructure-improvements)
- [Files Modified](#files-modified)
- [Next Steps](#next-steps)

---

## Abstract

This RFC documents the status of the tmax UI test suite, identifies a critical buffer-save bug discovered through testing, proposes a fix, and records the test infrastructure improvements made during investigation.

## Test Results

```
Total Tests: 3
Test Assertions: 15
✅ Passed: 14 (93.3%)
❌ Failed: 1 (6.7%)
```

### ✅ Test 1: Startup (`01-startup.test.sh`)

**Status:** PASSING (3/3 assertions)
- ✅ Editor should be running
- ✅ Should start in NORMAL mode
- ✅ No errors should be present

### ✅ Test 3: Mode Switching (`03-mode-switching.test.sh`)

**Status:** PASSING (8/8 assertions)
- ✅ Should start in NORMAL mode
- ✅ Should be in INSERT mode
- ✅ Should return to NORMAL mode
- ✅ Should be in COMMAND mode
- ✅ Should return to NORMAL mode
- ✅ Should still be in NORMAL mode after navigation
- ✅ Should still be in INSERT mode after typing
- ✅ Should return to NORMAL mode

### ❌ Test 2: Basic Editing (`02-basic-editing.test.sh`)

**Status:** FAILING (3/4 assertions)
- ✅ File content should be visible
- ✅ Should be in mode: INSERT
- ✅ Should be in mode: NORMAL
- ❌ File should contain appended text

**Issue:** Typed characters are not being saved to the file.

## Root Cause Analysis

### What Works

1. ✅ Key reception — keys are received by the editor (mode switching works)
2. ✅ Mode switching — INSERT mode is entered correctly
3. ✅ File loading — files are opened and displayed correctly
4. ✅ Command mode — commands like `:w` and `:q` work
5. ❌ Character insertion — typed characters are not saved

### Root Cause: Stale Buffer Reference in `buffers` Map

When `buffer-insert` is called via T-Lisp, it updates `state.currentBuffer` to a new immutable buffer. However, the setter fails to update the buffers map correctly.

**Location:** `src/editor/editor.ts`

```typescript
set currentBuffer(v: FunctionalTextBuffer | null) {
  if (v && editor.state.currentBuffer) {
    for (const [name, buffer] of editor.buffers) {
      if (buffer === editor.state.currentBuffer) {
        editor.buffers.set(name, v as FunctionalTextBufferImpl);
        break;
      }
    }
  }
  editor.state.currentBuffer = v ?? undefined;
}
```

**Problem:** The comparison `buffer === editor.state.currentBuffer` uses reference equality. After `buffer-insert` creates a new buffer, `state.currentBuffer` is already the NEW buffer, so the loop won't find a match in the `buffers` map (which still has the OLD buffer). The save operation then fails silently because it can't find the current buffer in the map.

### Secondary Issue: Silent Save Failure

When saving, the editor looks for `currentBuffer` in the `buffers` map. If the buffer isn't found (different object reference), the save fails without error feedback.

## Proposed Solution

Track the filename separately from the buffer, eliminating reference-matching entirely:

```typescript
// Add to EditorState interface
currentFilename?: string;

// In openFile()
async openFile(filename: string): Promise<void> {
  const content = await this.filesystem.readFile(filename);
  this.createBuffer(filename, content);
  this.state.currentFilename = filename;
  this.state.statusMessage = `Opened ${filename}`;
}

// In saveFile()
async saveFile(): Promise<void> {
  if (!this.state.currentBuffer) {
    this.state.statusMessage = "No buffer to save";
    return;
  }

  const filename = this.state.currentFilename;
  if (!filename) {
    this.state.statusMessage = "Buffer has no associated file";
    return;
  }
  // Save using filename directly — no buffer map search needed
}
```

**Benefits:**
- Eliminates the buffer reference matching problem
- Simplifies the save logic
- Makes the filename explicit
- Works correctly with immutable buffers

## Infrastructure Improvements Completed

| Improvement | Status |
|---|---|
| Window management — `$TMAX_TEST_WINDOW` variable | ✅ Fixed |
| Window reuse across tests | ✅ Fixed |
| Window cleanup after tests | ✅ Fixed |
| Command line editing in terminal UI | ✅ Implemented |
| Status line shows command in COMMAND/MX mode | ✅ Implemented |

## Files Modified

### Test Infrastructure
- `test/ui/lib/api.sh` — 50+ window references fixed
- `test/ui/tests/03-mode-switching.test.sh` — Fixed hardcoded window reference
- `test/ui/tests/01-startup.test.sh` — Simplified test expectations
- `test/ui/tests/02-basic-editing.test.sh` — Increased save delay

### Editor Implementation
- `src/editor/editor.ts` — Fixed `openFile()` double-buffer creation, added `operations` getter, updated status message handling, implemented command line editing, added `currentBuffer` setter
- `src/editor/tlisp-api.ts` — Updated save command message, fixed buffer map updates
- `src/editor/renderer.ts` — Enhanced status line for COMMAND/MX modes

## Next Steps

1. Add `currentFilename` tracking to the Editor class
2. Update save logic to use tracked filename instead of buffer map search
3. Re-run `02-basic-editing.test.sh` to verify the fix
4. Investigate whether the `currentBuffer` setter's reference-matching logic should be removed entirely or kept as a fallback

## References

- Original test status document: `docs/specs/archive/SPEC-020-ui_test_status.md`
- Test harness documentation: `rules/ui-testing.md`
- Editor buffer architecture: `src/editor/editor.ts`
