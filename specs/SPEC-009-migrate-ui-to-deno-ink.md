# Chore: Migrate UI to Deno-ink

## Chore Description
Migrate the tmax editor's custom terminal I/O system to use [Deno-ink](https://jsr.io/@deno-ink/core), a Deno-native React-based TUI framework. This migration will replace the current manual ANSI escape sequence rendering (789 lines in `src/core/terminal.ts`) with a declarative component-based UI using React and Ink.

The migration maintains:
- All existing T-Lisp functionality and API (25+ functions)
- Functional programming patterns (TaskEither, functional interfaces)
- All 131 existing tests
- Modal editing behavior (normal, insert, visual, command, M-x modes)
- Key binding system

The migration improves:
- Code maintainability through declarative React components
- Layout capabilities with Flexbox (Yoga-powered)
- Testing with ink-testing-library
- Accessibility with built-in ARIA support
- Developer experience with React DevTools integration

## Relevant Files
Use these files to resolve the chore:

### Existing Files to Modify

- **src/core/terminal.ts** (789 lines)
  - Currently implements manual ANSI escape sequences for terminal I/O
  - Contains `FunctionalTerminalIOImpl` class with raw mode, cursor positioning, viewport management
  - Will be replaced with Deno-ink adapter implementing same functional interface
  - Critical: Must maintain `FunctionalTerminalIO` interface for backward compatibility

- **src/core/types.ts** (418 lines)
  - Defines `FunctionalTerminalIO` interface that terminal implementation must satisfy
  - Contains `TerminalIO`, `Position`, `TerminalSize` types
  - Will need new Deno-ink compatible types added (React component types, Ink-specific types)

- **src/editor/editor.ts** (621 lines)
  - Core editor implementation with manual rendering loop (`render()`, `renderStatusLine()`, `positionCursor()`)
  - Custom viewport management (`updateViewport()`)
  - Key handling logic (`handleKey()`, `normalizeKey()`)
  - Will be refactored to use React components instead of manual rendering
  - Must preserve T-Lisp interpreter integration and key binding system

- **src/editor/tlisp-api.ts** (601 lines)
  - Defines EditorState interface and T-Lisp API functions
  - 25+ built-in functions for buffer, cursor, mode, status management
  - NO CHANGES to T-Lisp API - this is the stable interface
  - Ensure React state syncs with EditorState properly

- **src/main.ts** (162 lines)
  - Application entry point that initializes TerminalIOImpl, FileSystemImpl, Editor
  - Handles command-line arguments and development mode
  - Will need to initialize Deno-ink renderer instead of TerminalIOImpl

### Files to Read for Context

- **README.md**
  - Contains project overview, architecture description, feature list
  - Documents T-Lisp API and key bindings
  - Important for understanding user-facing features to preserve

- **functional-patterns-guidelines.md**
  - Documents functional programming patterns used in codebase
  - TaskEither, functional interfaces, immutability requirements
  - Must be followed during migration - maintain functional core

### Test Files to Update

- **test/unit/terminal.test.ts**
  - Tests for terminal I/O functionality
  - Will need adaptation for Deno-ink rendering

- **test/unit/editor.test.ts**
  - Tests for editor rendering and key handling
  - Will need adaptation for React component testing

### New Files to Create

#### New Implementation Files

- **src/frontend/ink-adapter.ts**
  - New Deno-ink adapter implementing `FunctionalTerminalIO` interface
  - Wraps Deno-ink's `render()` and hooks in functional interface
  - Bridges React rendering to functional TaskEither-based operations
  - Maintains compatibility with existing functional patterns

- **src/frontend/components/Editor.tsx**
  - Main React component for editor UI
  - Replaces manual rendering loop with declarative JSX
  - Uses React hooks (`useState`, `useEffect`) for state management
  - Composed of BufferView, StatusLine, CommandInput components

- **src/frontend/components/BufferView.tsx**
  - React component for displaying buffer text
  - Handles viewport scrolling and line rendering
  - Uses Ink's `<Box>` and `<Text>` components
  - Implements cursor positioning

- **src/frontend/components/StatusLine.tsx**
  - React component for status line display
  - Shows mode, cursor position, status message
  - Uses Ink's `<Box>` and `<Text>` components with styling

- **src/frontend/components/CommandInput.tsx**
  - React component for command mode input
  - Handles both vim-style command mode and M-x mode
  - Uses Ink's `<Text>` component for input display

- **src/frontend/hooks/useEditorState.ts**
  - Custom React hook for managing editor state
  - Bridges React state with EditorState interface
  - Ensures T-Lisp API can access and modify state
  - Handles state synchronization between React and T-Lisp

- **src/frontend/types.ts**
  - TypeScript types for React components
  - Props interfaces for all components
  - Integration types between React and functional core

#### Test Files

- **test/frontend/ink-adapter.test.ts**
  - Tests for Deno-ink adapter
  - Validates FunctionalTerminalIO interface implementation
  - Tests integration with Ink's rendering system

- **test/frontend/components.test.ts**
  - React component tests using ink-testing-library
  - Tests for Editor, BufferView, StatusLine, CommandInput
  - Integration tests for component composition

## User Stories and Acceptance Criteria

### Story 1: Deno-ink Adapter Implementation

**As a** developer maintaining the tmax codebase
**I want** a Deno-ink adapter that implements the existing FunctionalTerminalIO interface
**So that** the editor can use React-based UI without breaking existing functional patterns

#### Acceptance Criteria

**Given** the existing `FunctionalTerminalIO` interface in `src/core/types.ts`
**When** I create `src/frontend/ink-adapter.ts` with `InkTerminalIO` class
**Then**:
- The class implements all methods of `FunctionalTerminalIO`
- All methods return TaskEither for functional compatibility
- Methods include: `getSize()`, `clear()`, `write()`, `moveCursor()`, `readKey()`, `enterRawMode()`, `exitRawMode()`, `enterAlternateScreen()`, `exitAlternateScreen()`, `hideCursor()`, `showCursor()`, `isStdinTTY()`
- Deno-ink's `render()` function is properly initialized
- TypeScript compiles without errors

**Given** the InkTerminalIO adapter
**When** I run `deno test test/frontend/ink-adapter.test.ts`
**Then**:
- All adapter methods have unit tests
- TaskEither error handling is tested for each method
- Errors are returned in Either, not thrown
- All tests pass with no regressions

**Migration Notes**:
- Update `deno.json` for JSX compilation if needed
- Import from Deno-ink: `import { render, Box, Text } from "jsr:@deno-ink/core";`
- Use Ink's internal size detection for `getSize()`
- Wrap `useInput()` hook in TaskEither for `readKey()`
- Maintain existing functional patterns (TaskEither, immutability)

---

### Story 2: React Editor Component Structure

**As a** developer
**I want** a React component structure that matches the current tmax UI
**So that** the editor maintains its visual layout while using Deno-ink

#### Acceptance Criteria

**Given** a fresh Deno-ink integration
**When** I create `src/frontend/components/Editor.tsx`
**Then**:
- Component accepts `editorState: EditorState` and `onStateChange` props
- Component uses Deno-ink components: `<Box>`, `<Text>`
- Layout matches current tmax UI (buffer view + status line)
- TypeScript types are properly defined

**Given** the Editor component
**When** I render it with sample editor state
**Then**:
- Buffer displays text content
- Status line shows mode and cursor position
- Layout fills 100% of terminal height
- No TypeScript errors

**Migration Notes**:
- Create `src/frontend/components/` directory
- Create `src/frontend/types.ts` for component props
- Use Flexbox layout via Ink's `<Box flexDirection="column">`
- Maintain separation from T-Lisp interpreter (no changes needed)

---

### Story 3: Buffer Display with Viewport Management

**As a** user editing files
**I want** to see buffer text with proper viewport scrolling
**So that** I can navigate large files efficiently

#### Acceptance Criteria

**Given** a buffer with content exceeding terminal height
**When** I create `src/frontend/components/BufferView.tsx`
**Then**:
- Component renders only visible lines based on viewport
- Lines are truncated to terminal width
- Cursor position is visible and properly positioned
- Long lines are handled gracefully (truncation or wrapping)

**Given** a buffer with 1000 lines
**When** I move the cursor to line 500
**Then**:
- Viewport scrolls to show cursor position
- Cursor remains visible at all times
- Rendering performance is acceptable (<50ms per update)

**Given** lines longer than terminal width
**When** buffer contains text wider than 80 columns
**Then**:
- Lines are truncated to fit terminal width
- Truncation is visually indicated (e.g., "...")
- No text overflow or display corruption

**Migration Notes**:
- Use Ink's `<Text>` component for each line
- Implement viewport calculation in component or hook
- Consider React.memo for performance optimization
- Only render visible lines (virtualization if needed)

---

### Story 4: Status Line Display

**As a** user
**I want** to see current editor mode, cursor position, and status messages
**So that** I know the editor's current state

#### Acceptance Criteria

**Given** the editor in any mode
**When** I create `src/frontend/components/StatusLine.tsx`
**Then**:
- Status line displays at bottom of screen
- Shows current mode (NORMAL, INSERT, VISUAL, COMMAND, M-X)
- Shows cursor position as "line:column"
- Shows status message when present
- Shows command input in command mode (":command")
- Shows M-x input in M-x mode ("M-x command")

**Given** different editor modes
**When** I switch between NORMAL, INSERT, VISUAL, COMMAND, M-X
**Then**:
- Status line updates to show current mode
- Mode display is visually distinct (color, bold, or inverse)
- Updates happen immediately on mode change

**Given** a status message
**When** T-Lisp API sets status message
**Then**:
- Message displays in status line
- Message clears after timeout or action
- Message doesn't obscure other status information

**Migration Notes**:
- Use Ink styling: colors, bold, inverse for visual distinction
- Accept mode, cursor position, status message as props
- Accept command line input for command/M-x modes
- Maintain existing status message API from T-Lisp

---

### Story 5: Command Mode Input

**As a** user
**I want** to type commands in command mode and M-x mode
**So that** I can execute editor commands

#### Acceptance Criteria

**Given** command mode activated (pressed `:`)
**When** I create `src/frontend/components/CommandInput.tsx`
**Then**:
- Input field displays `:` prompt
- Characters appear as I type
- Backspace deletes characters
- Enter submits command for execution
- Escape exits command mode

**Given** M-x mode activated (pressed `SPC ;`)
**When** I type in M-x mode
**Then**:
- Input field displays `M-x ` prompt
- Characters appear as I type
- Backspace deletes characters
- Enter submits function name for execution
- Escape exits M-x mode

**Given** an invalid command
**When** I submit it in command mode
**Then**:
- Error message displays in status line
- Command mode remains active for correction
- No crash or undefined behavior

**Migration Notes**:
- Use `useInput()` hook from Deno-ink
- Integrate with existing command execution logic in `Editor`
- Maintain T-Lisp command execution API
- Handle both vim-style command mode and M-x mode

---

### Story 6: React State Management with T-Lisp Integration

**As a** developer
**I want** React state to synchronize with T-Lisp interpreter state
**So that** T-Lisp functions can trigger UI updates and vice versa

#### Acceptance Criteria

**Given** T-Lisp function modifies editor state
**When** I create `src/frontend/hooks/useEditorState.ts`
**Then**:
- Hook bridges React state with EditorState interface
- T-Lisp API functions can update state
- State updates trigger React re-renders
- React component updates update T-Lisp state

**Given** T-Lisp function changes mode
**When** `(editor-mode "insert")` is called
**Then**:
- EditorState updates to "insert" mode
- React re-renders with new mode
- Status line shows "INSERT" mode
- Key bindings switch to insert mode

**Given** React component updates buffer content
**When** user types in insert mode
**Then**:
- EditorState buffer content updates
- T-Lisp API can access updated content
- Changes are visible to T-Lisp functions
- No state synchronization issues

**Migration Notes**:
- Create custom hook for state management
- Ensure immutable state updates
- Provide update functions for both React and T-Lisp
- Handle mode transitions, cursor updates, buffer changes
- No changes to T-Lisp interpreter or API (25+ functions)

---

### Story 7: Editor Migration to React Rendering

**As a** developer
**I want** the Editor class to use React components instead of manual rendering
**So that** rendering is declarative and maintainable

#### Acceptance Criteria

**Given** the existing Editor class in `src/editor/editor.ts`
**When** I refactor to use React components
**Then**:
- Manual `render()` method is removed (handled by React)
- Manual `renderStatusLine()` method is removed (StatusLine component)
- Manual `positionCursor()` method is removed (Ink handles cursor)
- `handleKey()` triggers React state changes
- T-Lisp interpreter integration is preserved
- Key binding system is preserved

**Given** the refactored Editor class
**When** I run the editor
**Then**:
- Application starts without errors
- All 5 modes work: normal, insert, visual, command, M-x
- All key bindings work as before
- Buffer operations work: create, switch, delete
- File operations work: open, save
- Cursor movement works: hjkl, word movement, line movement

**Given** large files
**When** I open a file with 1000+ lines
**Then**:
- Viewport scrolling works smoothly
- Cursor stays visible during navigation
- Performance is acceptable (no noticeable lag)

**Migration Notes**:
- Modify `src/editor/editor.ts` to use React components
- Remove manual rendering loop
- Update `handleKey()` to trigger React state updates
- Maintain T-Lisp interpreter integration
- Maintain key binding system
- Test all editor features after migration

---

### Story 8: Test Migration and Coverage

**As a** developer
**I want** all existing tests to pass after Deno-ink migration
**So that** I have confidence the migration didn't break functionality

#### Acceptance Criteria

**Given** 131 existing tests
**When** I migrate to Deno-ink
**Then**:
- All 131 tests pass without modification if possible
- Tests that require adaptation are updated to work with React
- New tests are added for React components
- Test coverage remains ≥80%

**Given** terminal I/O tests
**When** I run `test/unit/terminal.test.ts`
**Then**:
- Tests are adapted for `InkTerminalIO` instead of `TerminalIOImpl`
- Assertions work with Deno-ink rendering
- All terminal I/O tests pass

**Given** editor tests
**When** I run `test/unit/editor.test.ts`
**Then**:
- Tests are adapted for React component rendering
- Tests use ink-testing-library for component assertions
- T-Lisp integration tests still work
- All editor tests pass

**Given** new React components
**When** I run `test/frontend/components.test.ts`
**Then**:
- Tests use ink-testing-library
- Each component has independent tests
- Component composition is tested
- State management with useEditorState is tested
- All frontend tests pass

**Migration Notes**:
- Update `test/unit/terminal.test.ts` for InkTerminalIO
- Update `test/unit/editor.test.ts` for React rendering
- Create `test/frontend/ink-adapter.test.ts`
- Create `test/frontend/components.test.ts`
- Use ink-testing-library: `import { render } from "npm:ink-testing-library"`
- Run `deno task test` to verify all tests pass

---

### Story 9: Type System Integration

**As a** developer
**I want** TypeScript types to support React components and Deno-ink
**So that** I have type safety across the migration

#### Acceptance Criteria

**Given** the existing type system in `src/core/types.ts`
**When** I add React component types
**Then**:
- React component prop types are defined
- Ink-specific types are added if needed
- `FunctionalTerminalIO` interface remains stable
- New types are documented with JSDoc comments

**Given** the updated type system
**When** I run `deno task check`
**Then**:
- Zero TypeScript errors
- All component props are properly typed
- All hook parameters and return types are typed
- No `any` types used without justification

**Migration Notes**:
- Modify `src/core/types.ts` to add React component types
- Add Ink-specific types if needed
- Create `src/frontend/types.ts` for frontend-specific types
- Ensure backward compatibility with existing types
- Document new types clearly

---

### Story 10: Performance Parity

**As a** user
**I want** the Deno-ink UI to perform as well as the current implementation
**So that** my editing experience is not degraded

#### Acceptance Criteria

**Given** large files (1000+ lines)
**When** I open and navigate in the editor
**Then**:
- Render times are ≤ current manual rendering
- No noticeable lag during typing
- Cursor movement feels responsive
- Memory usage is reasonable

**Given** the Deno-ink implementation
**When** I profile performance
**Then**:
- React.memo is used to prevent unnecessary re-renders
- Virtual scrolling is implemented for large buffers if needed
- Ink's `maxFps` setting is tuned if needed
- Ink's `incrementalRendering` is used if needed

**Given** performance benchmarks
**When** I compare with baseline
**Then**:
- Performance is documented
- Any differences are noted
- Performance improvements are identified
- Bottlenecks are addressed

**Migration Notes**:
- Profile with files of 100, 1000, 10000 lines
- Measure render times and memory usage
- Use React.memo for performance optimization
- Implement virtual scrolling if needed
- Tune Ink renderer settings
- Benchmark against current implementation

---

### Story 11: Error Handling and Edge Cases

**As a** user
**I want** the editor to handle errors gracefully
**So that** I don't lose work or encounter crashes

#### Acceptance Criteria

**Given** terminal resize
**When** I resize the terminal window
**Then**:
- Layout adapts to new size
- No crash or corruption
- Cursor remains visible

**Given** non-TTY environment
**When** I run editor in non-TTY environment
**Then**:
- TTY detection works properly
- Graceful error message or fallback
- No crash

**Given** file I/O errors during rendering
**When** file read/write fails
**Then**:
- Error is caught and handled
- User-friendly error message
- No crash or undefined behavior

**Given** edge cases
**When** editor encounters unusual content
**Then**:
- Empty buffers display correctly
- Very long lines (> terminal width) handled
- Binary files handled gracefully
- Unicode and special characters display correctly

**Migration Notes**:
- Test terminal resize handling
- Test TTY detection in non-TTY environments
- Add graceful fallbacks for errors
- Ensure user-friendly error messages
- Test edge cases comprehensively

---

### Story 12: Documentation Updates

**As a** developer
**I want** documentation to reflect the Deno-ink migration
**So that** future developers understand the architecture

#### Acceptance Criteria

**Given** the migration is complete
**When** I update README.md
**Then**:
- Deno-ink migration is documented
- Architecture description is updated
- React-based UI is noted
- Development instructions are updated

**Given** functional-patterns-guidelines.md
**When** I update it
**Then**:
- React integration with functional patterns is documented
- Guidance on using functional patterns with React is added
- Notes on which patterns to use where are included

**Given** the migration
**When** I create migration notes
**Then**:
- Architectural changes are documented
- Integration patterns are documented
- Testing approach is documented

**Given** code comments
**When** I review them
**Then**:
- React component purpose is clarified
- Integration with functional core is documented
- Complex code sections have explanatory comments

**Migration Notes**:
- Update README.md with migration details
- Update functional-patterns-guidelines.md
- Create migration notes document
- Update code comments for clarity
- Document architectural decisions

---

## Validation Commands
Execute every command to validate all user stories are complete with zero regressions.

- `deno task check` - Type check all TypeScript files to ensure no type errors
- `deno task lint` - Lint code to ensure it follows Deno style guidelines
- `deno task test` - Run all tests (131+ tests) to ensure zero regressions
- `deno task test --coverage` - Run tests with coverage to ensure comprehensive test coverage
- `deno task start --dev test.txt` - Manually test starting the editor in development mode
- `deno task start --dev` - Manually test the editor with various operations:
  - Open file: `deno task start --dev src/main.ts`
  - Test modal switching (press `i`, `Escape`, `:`, etc.)
  - Test cursor movement (press `h`, `j`, `k`, `l`)
  - Test text insertion and deletion
  - Test command mode (press `:`, type `w`, press `Enter`)
  - Test quitting (press `q`)
  - Test M-x mode (press `SPC ;`, type command)
- `deno task fmt:check` - Check that all code is properly formatted

## Notes

### Critical Success Factors

1. **Maintain Functional Core**: The T-Lisp interpreter and functional patterns must remain unchanged. Only the UI layer transitions to Deno-ink/React.

2. **Preserve All Features**: Every feature that works today must continue to work:
   - All 5 modes (normal, insert, visual, command, M-x)
   - All key bindings
   - All T-Lisp API functions (25+ functions)
   - All buffer operations
   - All file operations

3. **Zero Test Regressions**: All 131+ existing tests must pass after migration. This is the primary validation criterion.

4. **Performance Parity**: The Deno-ink implementation should perform at least as well as the current manual rendering, especially for large files.

### Integration Pattern

The architecture follows this pattern:
```
T-Lisp Interpreter (unchanged)
    ↓ calls
Editor API (unchanged)
    ↓ uses
EditorState (state object, bridged to React)
    ↓ renders
React Components (new Deno-ink UI)
    ↓ uses
Deno-ink Adapter (implements FunctionalTerminalIO)
    ↓ wraps
Deno-ink Renderer (React for CLI)
```

### Key Challenges to Address

1. **State Synchronization**: Ensure React state and EditorState stay in sync when updated from either React components or T-Lisp API functions.

2. **Input Handling**: Bridge between Deno-ink's `useInput()` hook and the existing key handling system in `Editor.handleKey()`.

3. **Cursor Management**: Convert manual cursor positioning to Ink's automatic cursor positioning within components.

4. **Viewport Scrolling**: Implement viewport scrolling logic in React components while maintaining performance.

5. **Testing Strategy**: Adapt existing tests to work with React components. Use ink-testing-library for component testing.

### Reference Resources

- [@deno-ink/core on JSR](https://jsr.io/@deno-ink/core) - Deno-native Ink implementation
- [Ink GitHub](https://github.com/vadimdemedes/ink) - Original Ink library documentation
- [Building a Simple interactive CLI Counter with Deno v2](https://www.simon-neutert.de/2024/deno-v2-ink/) - Tutorial for Deno + Ink
- [functional-patterns-guidelines.md](../functional-patterns-guidelines.md) - Functional programming patterns to follow

### Migration Timeline Estimate

- Story 1 (Deno-ink Adapter): 4-6 hours
- Story 2 (React Structure): 2-3 hours
- Story 3 (Buffer View): 3-5 hours
- Story 4 (Status Line): 2-3 hours
- Story 5 (Command Input): 2-3 hours
- Story 6 (State Management): 4-6 hours
- Story 7 (Editor Migration): 4-6 hours
- Story 8 (Test Migration): 4-6 hours
- Story 9 (Type System): 2-3 hours
- Story 10 (Performance): 3-5 hours
- Story 11 (Error Handling): 2-3 hours
- Story 12 (Documentation): 2-3 hours

**Total Estimated Time**: 36-52 hours

### Risk Mitigation

- **Direct Migration**: Each user story builds on the previous one, allowing for early issue detection
- **Continuous Testing**: Run tests after each story to catch regressions early
- **Performance Monitoring**: Benchmark throughout migration to ensure performance doesn't degrade
- **Incremental Validation**: Each story has clear acceptance criteria for validation
