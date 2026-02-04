# Window Splitting

## Status

Accepted

## Context

Vim-style window splitting:
- `:split` - Split horizontally
- `:vsplit` - Split vertically
- Window navigation between splits
- Resize splits

## Decision

Implement window management:

### Window Data Structure

```typescript
export interface Window {
  id: string;
  buffer: Buffer;
  position: Position;  // Top-left corner
  size: Size;         // Width x height
}

export class WindowManager {
  private windows: Map<string, Window> = new Map();
  private activeWindow: string | null = null;
  private layout: WindowLayout;

  splitHorizontal(windowId: string): string {
    const window = this.windows.get(windowId)!;
    const newId = generateId();

    // Split window horizontally
    const newSize = { width: window.size.width, height: window.size.height / 2 };

    // Update original window
    window.size = newSize;

    // Create new window
    const newWindow: Window = {
      id: newId,
      buffer: window.buffer,  // Share buffer
      position: { line: window.position.line + newSize.height, column: window.position.column },
      size: newSize
    };

    this.windows.set(newId, newWindow);
    return newId;
  }

  splitVertical(windowId: string): string {
    const window = this.windows.get(windowId)!;
    const newId = generateId();

    // Split window vertically
    const newSize = { width: window.size.width / 2, height: window.size.height };

    // Update original window
    window.size = newSize;

    // Create new window
    const newWindow: Window = {
      id: newId,
      buffer: window.buffer,
      position: { line: window.position.line, column: window.position.column + newSize.width },
      size: newSize
    };

    this.windows.set(newId, newWindow);
    return newId;
  }
}
```

### Window Commands

```lisp
;; Split commands
:split     ; => Split horizontally (create new window below)
:vsplit    ; => Split vertically (create new window to right)
:split file.txt  ; => Split and open file

;; Window navigation
Ctrl-w j    ; => Move to window below
Ctrl-w k    ; => Move to window above
Ctrl-w h    ; => Move to window left
Ctrl-w l    ; => Move to window right
Ctrl-w w    ; => Cycle to next window
Ctrl-w p    ; => Go to previous window

;; Window operations
Ctrl-w q    ; => Quit current window
Ctrl-w o    ; => Make current window only window
```

### Implementation

Created `src/editor/windows.ts`:
- Window data structures
- Window layout management
- Split operations
- Window navigation

## Consequences

### Benefits

1. **Multi-File Editing**: View multiple files simultaneously
2. **Vim Compatibility**: Standard vim window commands
3. **Productivity**: Compare files side-by-side
4. **Flexibility**: Multiple window layouts

### Trade-offs

1. **Complexity**: Window management is complex
2. **Screen Space**: Windows share limited screen space
3. **Buffer Sharing**: Multiple windows can share buffers
4. **Performance**: More windows = more rendering

### Future Considerations

1. **Window Tabs**: Tab bars for windows
2. **Window Stacking**: Stack windows vertically/horizontally
3. **Window Profiles**: Save window layouts
4. **Floating Windows**: Pop-up windows

### Testing

Created `test/unit/editor.test.ts`:
- `:split` creates horizontal split
- `:vsplit` creates vertical split
- Window navigation works
- Windows resize correctly
- Buffers shared across windows
- `Ctrl-w q` closes window
- `Ctrl-w o` closes other windows
