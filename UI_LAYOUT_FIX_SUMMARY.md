# UI Layout Fix - Full Height Terminal Support

## Issue
The editor's status bar appeared in the middle of the screen instead of at the bottom. The UI only rendered 24 lines (hardcoded default) instead of using the actual terminal height.

## Root Cause
`BufferView.tsx` had hardcoded terminal dimensions that never updated:
```tsx
const [terminalWidth, setTerminalWidth] = useState(80);
const [terminalHeight, setTerminalHeight] = useState(24);
```

When running through Ink, `process.stdout.rows` and `process.stdout.columns` were not being read, so the editor always fell back to the default 80x24 dimensions.

## Solution

### 1. Created `useTerminalDimensions` Hook
**File:** `src/frontend/hooks/useTerminalDimensions.ts`

- Reads actual dimensions from `process.stdout.columns` and `process.stdout.rows`
- Falls back to defaults (80x24) for non-TTY environments
- Listens to `resize` events for automatic updates
- Works correctly with Ink's rendering model

```typescript
export const useTerminalDimensions = (): TerminalDimensions => {
  const [dimensions, setDimensions] = useState<TerminalDimensions>(() => ({
    width: process.stdout.columns || DEFAULT_TERMINAL_COLS,
    height: process.stdout.rows || DEFAULT_TERMINAL_ROWS,
  }));

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: process.stdout.columns || DEFAULT_TERMINAL_COLS,
        height: process.stdout.rows || DEFAULT_TERMINAL_ROWS,
      });
    };

    process.stdout.on('resize', updateDimensions);
    updateDimensions();

    return () => {
      process.stdout.off('resize', updateDimensions);
    };
  }, []);

  return dimensions;
};
```

### 2. Updated `BufferView` Component
**File:** `src/frontend/components/BufferView.tsx`

- Removed hardcoded state for terminal dimensions
- Now accepts `terminalWidth` and `terminalHeight` as props
- Calculates visible lines based on actual terminal height

### 3. Updated `Editor` Component
**File:** `src/frontend/components/Editor.tsx`

- Uses the `useTerminalDimensions` hook
- Passes dimensions to `BufferView` as props
- Sets root Box `height` and `width` to actual terminal dimensions

## Test Coverage

### New Test: Full Height Layout
**File:** `test/ui/tests/04-full-height-layout.test.sh`

Verifies that the editor UI fills the entire terminal height with 6 assertions:
1. Editor should be running
2. Should start in NORMAL mode
3. No errors should be present
4. **UI should fill entire terminal height** (NEW)
5. Status bar should be at bottom of screen (NEW)
6. Should render beyond old 24-line limit (NEW)

### New Assertion Function
**File:** `test/ui/assert/assertions.sh`

Added `assert_screen_fill()` function that:
- Gets terminal height from tmux pane
- Captures and counts visible lines
- Asserts they match (with configurable tolerance)
- Reports actual vs expected dimensions

### Updated Existing Tests
Added `assert_screen_fill` to:
- `test/ui/tests/01-startup.test.sh`
- `test/ui/tests/02-basic-editing.test.sh`
- `test/ui/tests/03-mode-switching.test.sh`

## Results

### Before Fix
- Status bar at line 23 of 42 (middle of screen)
- Only 22 lines of content visible
- Total rendered: 23 lines
- Terminal: 42 rows

### After Fix
- Status bar at line 41-42 (bottom of screen) ✅
- 40 lines of content visible ✅
- Total rendered: 42 lines ✅
- Terminal: 42 rows ✅

### Test Results
```
=========================================
  Test Summary
=========================================
Total:  5
Passed: 5
Failed: 0

All tests passed!
```

## Files Modified
1. `src/frontend/hooks/useTerminalDimensions.ts` (created)
2. `src/frontend/components/BufferView.tsx` (modified)
3. `src/frontend/components/Editor.tsx` (modified)
4. `test/ui/assert/assertions.sh` (added assert_screen_fill)
5. `test/ui/lib/api.sh` (added tmax_assert_screen_fill)
6. `test/ui/tests/01-startup.test.sh` (added assertion)
7. `test/ui/tests/02-basic-editing.test.sh` (added assertion)
8. `test/ui/tests/03-mode-switching.test.sh` (added assertion)
9. `test/ui/tests/04-full-height-layout.test.sh` (created)

## Verification
The fix ensures:
- ✅ Editor uses actual terminal dimensions instead of hardcoded defaults
- ✅ UI fills entire terminal height
- ✅ Status bar positioned at bottom of screen
- ✅ Proper handling of terminal resize events
- ✅ Fallback to defaults for non-TTY environments
- ✅ Comprehensive test coverage to prevent regressions
