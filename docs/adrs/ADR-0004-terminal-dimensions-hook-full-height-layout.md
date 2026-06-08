# Use Dynamic Terminal Dimensions for Full-Height Layout

## Status

**accepted**

## Context

The tmax editor's UI was rendering with incorrect dimensions, causing the status bar to appear in the middle of the screen rather than at the bottom. Investigation revealed:

1. **Hardcoded Fallback Values**: `BufferView.tsx` used hardcoded terminal dimensions:
   ```tsx
   const [terminalWidth, setTerminalWidth] = useState(80);
   const [terminalHeight, setTerminalHeight] = useState(24);
   ```

2. **No Dimension Updates**: These values were never updated from actual terminal dimensions, even when running in a TTY environment where `process.stdout.rows` and `process.stdout.columns` were available.

3. **Symptoms in 42-row Terminal**:
   - Status bar appeared at line 23 of 42 (middle of screen)
   - Only 22 lines of content visible
   - Bottom 19 rows of terminal were blank

4. **Ink Compatibility**: When running through Ink's React renderer, `process.stdout` is captured by Ink, but the dimensions are still available and should be used for proper layout.

This was a critical UX issue that made the editor unusable in terminals larger than 24 rows, which includes most modern terminal emulator configurations.

## Decision

We implemented a custom React hook to dynamically read and track terminal dimensions:

### 1. Created `useTerminalDimensions` Hook

**File**: `src/frontend/hooks/useTerminalDimensions.ts`

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

**Key Features**:
- Initializes from `process.stdout.columns` and `process.stdout.rows`
- Falls back to `DEFAULT_TERMINAL_COLS` (80) and `DEFAULT_TERMINAL_ROWS` (24) for non-TTY environments
- Listens to `process.stdout` 'resize' events for automatic terminal resize handling
- Properly cleans up event listeners on unmount

### 2. Updated Component Architecture

**`Editor.tsx` Changes**:
- Uses `useTerminalDimensions()` hook to get real-time dimensions
- Passes `terminalWidth` and `terminalHeight` to `BufferView` component
- Sets root `Box` height and width to actual terminal dimensions

**`BufferView.tsx` Changes**:
- Removed internal state for terminal dimensions
- Accepts `terminalWidth` and `terminalHeight` as props
- Calculates `visibleLines` based on actual terminal height

### 3. Added Test Coverage

**New Test**: `test/ui/tests/04-full-height-layout.test.sh`
- Verifies UI fills entire terminal height
- Checks status bar position at bottom
- Ensures rendering beyond old 24-line limit

**New Assertion**: `assert_screen_fill()` in `test/ui/assert/assertions.sh`
- Compares captured line count to tmux pane height
- Configurable tolerance for borders/padding
- Provides detailed failure diagnostics

## Consequences

### Positive

- **Full Terminal Utilization**: Editor now correctly uses entire terminal height, not just 24 rows
- **Proper Status Bar Position**: Status bar appears at bottom of screen where users expect it
- **Automatic Resize Handling**: Terminal resize events trigger automatic re-rendering with correct dimensions
- **Non-TTY Fallback**: Still works in CI/testing environments with default 80x24 fallback
- **Comprehensive Testing**: UI test suite automatically catches regressions of this issue
- **Better UX**: Users with large terminals (40+ rows) can see much more content

**Measured Results** (in 42-row terminal):
- Before: 22 content lines + 1 status line = 23 rows (55% utilization)
- After: 40 content lines + 1 status line = 41 rows (98% utilization)
- Improvement: +78% more visible content

### Negative

- **Additional React Hook**: Adds one more React hook to the component tree (minor complexity increase)
- **Dependency on process.stdout**: Relies on Node/Bun's stdout dimension reporting (works in all supported environments)
- **Test Maintenance**: UI tests now need to account for varying terminal sizes (mitigated by tolerance parameter)

### Neutral

- **Component Props**: `BufferView` now requires additional props (terminalWidth, terminalHeight)
- **File Creation**: Added new hook file (`useTerminalDimensions.ts`)
- **Backward Compatibility**: No breaking changes to public API or T-Lisp interface

## Related Decisions

- **ADR-001**: Switch Main Entry Point to Deno-ink UI - established React-based UI architecture
- **ADR-003**: Final Architecture - T-Lisp First - defines the separation between T-Lisp core logic and React UI layer
- **Future**: May need similar dimension handling for other UI components (popups, split views)

## Implementation Evidence

### Before Fix
```
Terminal: 122x42
Visible: 23 lines
Status bar: Line 23 (middle of screen)
```

### After Fix
```
Terminal: 122x42
Visible: 42 lines
Status bar: Line 41-42 (bottom of screen)
```

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

All UI tests now include `assert_screen_fill` verification:
- ✅ 01-startup.test.sh
- ✅ 02-basic-editing.test.sh
- ✅ 03-mode-switching.test.sh
- ✅ 04-full-height-layout.test.sh (new comprehensive test)

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
