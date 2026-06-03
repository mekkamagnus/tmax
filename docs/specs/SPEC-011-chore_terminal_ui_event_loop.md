# Chore: Fix Old Terminal UI - Add Main Event Loop and Render System

## Chore Description
The old terminal UI (`src/main.ts`) is missing a main event loop, causing the editor to exit immediately after initialization. This chore implements a complete terminal-based editor with:

1. **Main Event Loop**: Keep the editor running and processing input continuously
2. **Terminal Rendering System**: Display buffer content, status line, and cursor position using ANSI escape sequences
3. **Input Handling**: Process keyboard input through the existing `handleKey()` method
4. **Viewport Management**: Scroll through large files and keep cursor visible
5. **Alternate Screen Buffer**: Use terminal alternate screen for full-screen editing
6. **Plain Text Mode Indicators**: Ensure mode (NORMAL, INSERT, etc.) is displayed as captureable plain text for UI testing

This will enable the UI test suite to function and unblock further development while the Deno-ink migration (SPEC-009) continues in parallel.

## Relevant Files

### Existing Files to Modify

- **src/main.ts**
  - **Why**: Entry point that currently starts editor but has no event loop
  - **Changes**: Add `run()` method with main event loop, call after `start()`, handle graceful shutdown

- **src/editor/editor.ts**
  - **Why**: Core editor with `handleKey()` method and state management, but no render method
  - **Changes**: Add `render()` method to display buffer and status line using terminal interface

- **src/core/terminal.ts**
  - **Why**: Has all necessary terminal I/O methods (clear, moveCursor, write, readKey, enterAlternateScreen, etc.)
  - **Changes**: No changes needed - methods already exist via `TerminalIOImpl` class

- **src/core/types.ts**
  - **Why**: Contains type definitions for TerminalIO interface
  - **Changes**: No changes needed - interface already has required methods

- **deno.json**
  - **Why**: Contains task definitions
  - **Changes**: No changes needed - `start-old` task already exists

### New Files to Create

- **src/editor/renderer.ts** (NEW)
  - **Why**: Separate rendering logic from editor state management for cleaner architecture
  - **Purpose**: Handle all terminal rendering including buffer display, status line, cursor positioning, and viewport calculations

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 3.1 Create Terminal Renderer Module

Create a new `src/editor/renderer.ts` file with the `TerminalRenderer` class:

- **Define `TerminalRenderer` class** with constructor accepting `TerminalIO` interface
- **Implement `render(editorState, buffer)` method**:
  - Clear screen using `terminal.clear()`
  - Calculate visible lines based on `viewportTop` and terminal size
  - Get terminal dimensions using `terminal.getSize()`
  - Display buffer content from `viewportTop` to `viewportTop + terminalHeight - 2` (reserve 2 lines for status)
  - Move cursor to position using `terminal.moveCursor({line, column})`
  - Write each line using `terminal.write()`
  - Handle line wrapping if `wordWrap` is enabled in config
- **Implement `renderStatusLine(state)` method**:
  - Move cursor to bottom of screen using `terminal.moveCursor()`
  - Display mode in color:
    - NORMAL: green
    - INSERT: yellow
    - VISUAL: magenta
    - COMMAND: cyan
    - M-X: blue
  - Display cursor position: `Line: X, Col: Y`
  - Display status message
  - Use ANSI color codes: `\x1b[31m` for red, `\x1b[32m` for green, etc.
  - **CRITICAL**: Use plain text mode names (NORMAL, INSERT, etc.) for UI test captureability
- **Implement `updateViewport(state, buffer)` helper**:
  - Calculate visible range based on terminal height
  - Scroll viewport if cursor is above or below visible area
  - Update `state.viewportTop` to keep cursor visible

**Code structure outline**:
```typescript
export class TerminalRenderer {
  constructor(private terminal: TerminalIO) {}

  async render(state: EditorState, buffer: FunctionalTextBuffer): Promise<void> {
    await this.clearScreen();
    await this.renderBuffer(state, buffer);
    await this.renderStatusLine(state);
    await this.positionCursor(state);
  }

  private async renderBuffer(state: EditorState, buffer: FunctionalTextBuffer): Promise<void> {
    // Get terminal size, calculate visible range, render lines
  }

  private async renderStatusLine(state: EditorState): Promise<void> {
    // Render colored status line with mode, cursor position, message
  }

  private async positionCursor(state: EditorState): Promise<void> {
    // Move cursor to actual cursor position in buffer
  }
}
```

### 3.2 Add Render Method to Editor Class

Modify `src/editor/editor.ts` to integrate the renderer:

- **Import TerminalRenderer**: Add `import { TerminalRenderer } from "./renderer.ts"`
- **Add renderer property**:
  ```typescript
  private renderer: TerminalRenderer;
  ```
- **Initialize renderer in constructor**:
  ```typescript
  this.renderer = new TerminalRenderer(terminal);
  ```
- **Add public `render()` method**:
  ```typescript
  async render(): Promise<void> {
    const buffer = this.state.currentBuffer;
    if (!buffer) {
      this.terminal.write("No buffer loaded");
      return;
    }
    await this.renderer.render(this.state, buffer);
  }
  ```
- **Update `handleKey()` to render after each key**:
  - Add `await this.render()` call at end of method before return
  - This ensures UI updates after every key press

### 3.3 Implement Main Event Loop in Application

Modify `src/main.ts` to add the main event loop:

- **Add `run()` method to `TmaxApplication` class**:
  ```typescript
  async run(): Promise<void> {
    while (this.editor.isRunning()) {
      try {
        // Read key from terminal
        const key = await this.terminal.readKey();

        // Handle special quit keys
        if (key === 'q' && this.editor.getMode() === 'normal') {
          // Check if this is a quit command (not just 'q' in text)
          // The handleKey method will handle actual quit logic
        }

        // Process key through editor
        await this.editor.handleKey(key);

        // Render updated state
        await this.editor.render();

      } catch (error) {
        if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
          break; // Exit event loop on quit signal
        }
        // Log other errors but continue running
        console.error("Error in event loop:", error);
      }
    }
  }
  ```
- **Add `isRunning()` method to Editor class** in `src/editor/editor.ts`:
  ```typescript
  isRunning(): boolean {
    return this.running;
  }
  ```
- **Add `getMode()` method to Editor class**:
  ```typescript
  getMode(): string {
    return this.state.mode;
  }
  ```
- **Update `main()` function** to call the event loop:
  - Replace lines 147-156 with:
    ```typescript
    try {
      await app.start();
      await app.run();  // NEW: Run the event loop
    } catch (error) {
      console.error("Application error:", error instanceof Error ? error.message : String(error));
      await app.shutdown();
      Deno.exit(1);
    }

    await app.shutdown();
    ```

### 3.4 Initialize Alternate Screen Buffer

Modify `src/main.ts` to use alternate screen buffer for full-screen editing:

- **Update `start()` method** in `TmaxApplication` class:
  - After `await this.terminal.enterRawMode()` (line 60), add:
    ```typescript
    // Enter alternate screen buffer for full-screen editing
    await this.terminal.enterAlternateScreen();

    // Hide cursor during rendering
    await this.terminal.hideCursor();

    // Clear screen
    await this.terminal.clear();
    ```
- **Update `shutdown()` method** (line 97):
  - Before `this.editor.stop()`, add:
    ```typescript
    // Show cursor before exiting
    await this.terminal.showCursor();

    // Exit alternate screen buffer
    await this.terminal.exitAlternateScreen();
    ```

### 3.5 Add Initial Render on Startup

Modify `src/main.ts` to render the editor immediately after startup:

- **Update `start()` method**:
  - After `await this.editor.start()` (line 70), add:
    ```typescript
    // Initial render to show the editor
    await this.editor.render();
    ```

### 3.6 Handle Mode-Specific Rendering

Ensure mode changes are properly displayed:

- **Verify `handleKey()` mode changes trigger render**:
  - Check that mode changes in `handleKey()` method are followed by render
  - Specifically ensure Escape key, `i` key, `:` key, and `SPC ;` keys update mode and render

### 3.7 Update Test Configuration

Update test configuration to use the fixed terminal UI:

- **Modify `test/ui/lib/config.sh`**:
  - Change line 46 from:
    ```bash
    export TMAX_START_CMD="${TMAX_START_CMD:-deno task start-old}"
    ```
  - To add flags for better test visibility:
    ```bash
    # Use old terminal UI for testing (has mode indicators in status line)
    # Add --log-level flag to reduce noise in test output
    export TMAX_START_CMD="${TMAX_START_CMD:-deno task start-old}"
    ```

### 3.8 Fix Hardcoded Window References

Already completed in previous work, but verify:

- **Check `test/ui/core/editor.sh`**:
  - Ensure no hardcoded `"editor"` window names
  - All references should use `$TMAX_TEST_WINDOW`

### 3.9 Create Integration Test

Create `test/integration/terminal-ui.test.ts`:

- **Test basic editor startup and event loop**:
  - Start editor with a test file
  - Send keys through stdin (using Deno.run with stdin pipe)
  - Verify editor stays running
  - Send 'q' key to quit
  - Verify clean exit
- **Test mode detection**:
  - Start editor
  - Check for "NORMAL" in terminal output
  - Send 'i' key
  - Check for "INSERT" in terminal output
  - Send Escape key
  - Check for "NORMAL" in terminal output again
- **Test basic editing**:
  - Start editor with empty buffer
  - Enter insert mode
  - Type text
  - Return to normal mode
  - Save and quit
  - Verify file was created with correct content

### 3.10 Update Deno Task for Development

Update `deno.json` if needed:

- **Verify `start-old` task**:
  - Should be: `"deno run --allow-read --allow-write --allow-run src/main.ts"`
  - No changes needed if already correct

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

```bash
# 1. Type check the code
deno check src/main.ts
deno check src/editor/editor.ts
deno check src/editor/renderer.ts

# 2. Run all unit tests (should pass without errors)
deno task test

# 3. Start editor manually and verify it stays running
# Terminal should show:
# - Alternate screen buffer (clear screen)
# - Status line at bottom with mode (NORMAL in green)
# - Cursor visible
# Press 'i' to enter INSERT mode (should show INSERT in yellow)
# Press Escape to return to NORMAL mode
# Press 'q' to quit
timeout 5 deno task start-old || echo "Editor exited as expected"

# 4. Test with file creation
echo "test content" > /tmp/test-editor.txt
deno task start-old /tmp/test-editor.txt
# In editor: Press 'i', type " more", Escape, ':w', 'q'
# Verify file content: cat /tmp/test-editor.txt
# Should show: "test content more"

# 5. Run UI test suite (should now pass)
bash test/ui/run-tests.sh

# 6. Run interactive UI test (should show visible window)
bash test/ui/interactive-test.sh

# 7. Verify mode detection works
# Run in tmux: tmux new-window -t tmax -n test-den
# In new window: deno task start-old
# Capture output: tmux capture-pane -p -t tmax:test-den | grep -E "NORMAL|INSERT"
# Should show mode indicators
```

## Notes

### Architecture Decisions

1. **Separate Renderer Class**: Created `TerminalRenderer` as separate class to follow Single Responsibility Principle and make rendering logic testable independent of Editor state

2. **Event Loop in Application**: Placed main event loop in `TmaxApplication.run()` rather than `Editor.run()` to keep application lifecycle concerns (shutdown, error handling) at application level

3. **Plain Text Mode Indicators**: Used plain text "NORMAL", "INSERT", etc. instead of complex terminal formatting to ensure UI test suite can capture and detect modes via tmux

4. **Alternate Screen Buffer**: Used terminal alternate screen (`\x1b[?1049h`) for clean full-screen editing that restores original terminal content on exit

5. **Viewport Management**: Basic viewport scrolling keeps cursor visible but doesn't implement advanced features like centering cursor or scroll margins yet

### Testing Strategy

1. **Manual Testing**: Use `deno task start-old` to manually verify editor starts, shows UI, accepts input, and quits cleanly

2. **UI Test Suite**: The `test/ui/` bash tests use tmux automation to verify editor behavior from outside, ensuring mode indicators and welcome messages are visible

3. **Integration Tests**: TypeScript integration tests verify editor stays running and processes input correctly

### Known Limitations

1. **No Syntax Highlighting**: Buffer content is displayed as plain text without syntax highlighting

2. **Basic Viewport**: Viewport scrolling is functional but doesn't implement advanced features like:
   - Centering cursor on screen
   - Scroll margins
   - Smooth scrolling

3. **No Undo/Redo in Terminal UI**: While buffer may support undo, terminal UI doesn't display undo history or provide undo key bindings

4. **Line Wrapping**: Word wrap is planned but implementation is basic (just truncates lines that are too long)

### Future Enhancements

1. **Syntax Highlighting**: Add token-based syntax highlighting using T-Lisp patterns

2. **Split Windows**: Implement multiple panes showing different buffers

3. **Command Line Editing**: Implement full command mode with history and completion in terminal UI (currently delegates to React components)

4. **Mouse Support**: Add mouse click handling for cursor positioning

### Compatibility with Deno-ink Migration

This implementation maintains compatibility with the ongoing Deno-ink migration (SPEC-009) by:

1. **Separating Concerns**: `TerminalRenderer` is a separate class from Editor, so React components can coexist

2. **Shared State**: Editor state management remains the same; only rendering differs

3. **Testing**: Both UIs can be tested independently using different entry points (`main.ts` vs `main-ink.ts`)

4. **Gradual Migration**: Features can be migrated to Deno-ink incrementally while terminal UI remains functional

### Error Handling

1. **TTY Detection**: Terminal already checks if stdin is a TTY and provides clear error message if not

2. **Event Loop Errors**: Errors in event loop are logged but don't crash editor; only EDITOR_QUIT_SIGNAL exits cleanly

3. **Graceful Shutdown**: SIGINT (Ctrl+C) is handled to restore terminal state before exiting

### Performance Considerations

1. **Full Screen Redraw**: Current implementation redraws entire screen on each keypress. Future optimization could use dirty rectangle tracking

2. **Large Files**: Viewport rendering only displays visible lines, so large files don't cause performance issues

3. **Input Latency**: Using Deno's raw mode ensures minimal input latency for responsive editing
