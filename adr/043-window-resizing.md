# Window Resizing

## Status

**proposed**

## Context

Vim-style window resizing:
- `Ctrl-w +` - Increase height
- `Ctrl-w -` - Decrease height
- `Ctrl-w >` - Increase width
- `Ctrl-w <` - Decrease width
- `Ctrl-w =` - Make windows equal size

## Decision

Implement window resizing:

### Resize Operations

```typescript
export class WindowManager {
  resizeHeight(windowId: string, delta: number): void {
    const window = this.windows.get(windowId)!;

    // Find neighboring window
    const neighbor = this.findNeighbor(windowId, 'vertical');

    if (neighbor) {
      // Adjust sizes
      window.size.height += delta;
      neighbor.size.height -= delta;

      // Update positions
      neighbor.position.line = window.position.line + window.size.height;
    }
  }

  resizeWidth(windowId: string, delta: number): void {
    const window = this.windows.get(windowId)!;

    // Find neighboring window
    const neighbor = this.findNeighbor(windowId, 'horizontal');

    if (neighbor) {
      // Adjust sizes
      window.size.width += delta;
      neighbor.size.width -= delta;

      // Update positions
      neighbor.position.column = window.position.column + window.size.width;
    }
  }

  makeEqual(): void {
    // Calculate average size
    const avgHeight = this.totalHeight / this.windows.size;
    const avgWidth = this.totalWidth / this.windows.size;

    // Apply to all windows
    for (const window of this.windows.values()) {
      window.size.height = avgHeight;
      window.size.width = avgWidth;
    }

    // Recalculate positions
    this.recalculatePositions();
  }
}
```

### Resize Commands

```lisp
;; Resize with counts
5Ctrl-w +   ; => Increase height by 5 lines
3Ctrl-w -   ; => Decrease height by 3 lines
10Ctrl-w >  ; => Increase width by 10 columns
2Ctrl-w <   ; => Decrease width by 2 columns

;; Equalize windows
Ctrl-w =    ; => Make all windows equal size

;; Resize to specific size
:resize 30  ; => Set current window height to 30 lines
:vertical resize 80  ; => Set current window width to 80 columns
```

### Implementation

Created `src/editor/windows.ts`:
- Resize operations
- Neighbor finding
- Size constraints
- Position recalculation

### Key Bindings

```lisp
(key-bind "C-w +" "window-increase-height" "normal")
(key-bind "C-w -" "window-decrease-height" "normal")
(key-bind "C-w >" "window-increase-width" "normal")
(key-bind "C-w <" "window-decrease-width" "normal")
(key-bind "C-w =" "window-equalize" "normal")
```

## Consequences

### Benefits

1. **Flexibility**: Adjust window sizes as needed
2. **Vim Compatibility**: Standard vim resize commands
3. **Equalization**: Quick equalize with `Ctrl-w =`
4. **Precision**: Count prefix for exact sizing

### Trade-offs

1. **Complexity**: Resize logic is complex
2. **Layout Constraints**: Windows must fit in screen
3. **Minimum Sizes**: Windows have minimum sizes
4. **Performance**: Resize triggers re-render

### Future Considerations

1. **Resize Handles**: Mouse-based resizing
2. **Auto Resize**: Auto-resize on buffer changes
3. **Resize Locking**: Lock window sizes
4. **Aspect Ratio**: Maintain aspect ratio

### Testing

Created `test/unit/editor.test.ts`:
- `Ctrl-w +` increases height
- `Ctrl-w -` decreases height
- `Ctrl-w >` increases width
- `Ctrl-w <` decreases width
- `Ctrl-w =` equalizes windows
- Count prefix works
- Size constraints enforced
