# Visual Mode Selection

## Status

Accepted

## Context

Vim-style visual mode for text selection:
- `v` - Enter character-wise visual mode
- `V` - Enter line-wise visual mode
- `Ctrl-v` - Enter block-wise visual mode
- Expand/shrink selection with motions
- Operators work on selection

## Decision

Implement visual mode selection:

### Visual Modes

```typescript
export type VisualMode = 'character' | 'line' | 'block';

export interface VisualState {
  mode: VisualMode;
  start: Position;
  end: Position;
}

export class VisualMode {
  private state: VisualState | null = null;

  enter(mode: VisualMode): void {
    this.state = {
      mode,
      start: buffer.getCursor(),
      end: buffer.getCursor()
    };
  }

  expand(motion: Motion): void {
    if (!this.state) return;
    this.state.end = motion.execute(buffer);
  }

  getSelection(): Range {
    if (!this.state) return null;

    const start = this.state.start;
    const end = this.state.end;

    // Normalize (start <= end)
    return {
      start: { line: Math.min(start.line, end.line), column: Math.min(start.column, end.column) },
      end: { line: Math.max(start.line, end.line), column: Math.max(start.column, end.column) }
    };
  }
}
```

### Visual Mode Entry

```lisp
;; Character-wise visual mode
v  ; => Enter character visual mode

;; Line-wise visual mode
V  ; => Enter line visual mode

;; Block-wise visual mode
C-v  ; => Enter block visual mode
```

### Selection Expansion

```lisp
;; In visual mode, motions expand selection
v w   ; => Visually select word
v 3j  ; => Visually select 3 lines
v $   ; => Visually select to line end
v G   ; => Visually select to end of buffer
```

### Operator Application

```lisp
;; Apply operators to visual selection
v...d  ; => Delete selection
v...y  ; => Yank selection
v...c  ; => Change selection
v...u  ; => Make lowercase
v...U  ; => Make uppercase
```

### Implementation

Created `src/editor/modes/visual.ts`:
- Visual mode state management
- Selection tracking
- Operator integration
- Highlight rendering

### Key Bindings

```lisp
;; Enter visual modes
(key-bind "v" "visual-char-mode" "normal")
(key-bind "V" "visual-line-mode" "normal")
(key-bind "C-v" "visual-block-mode" "normal")

;; Exit visual mode
(key-bind "v" "visual-exit" "visual")
(key-bind "V" "visual-exit" "visual")
(key-bind "C-v" "visual-exit" "visual")
(key-bind "Escape" "normal-mode" "visual")
```

## Consequences

### Benefits

1. **Text Selection**: Select text regions
2. **Vim Compatibility**: Standard vim visual mode
3. **Operator Target**: Operators work on selections
4. **Flexibility**: Three selection modes

### Trade-offs

1. **Complexity**: Visual mode state management
2. **Block Mode**: Block selection is complex
3. **Highlighting**: Must render selection highlights
4. **Performance**: Large selections can be slow

### Future Considerations

1. **Selection Persistence**: Restore selections after undo
2. **Multiple Selections**: Multiple cursors
3. **Selection narrowing**: Reduce selection size
4. **Selection swapping**: Swap selection start/end

### Testing

Created `test/unit/editor.test.ts`:
- `v` enters character visual mode
- `V` enters line visual mode
- `Ctrl-v` enters block visual mode
- Motions expand selection
- Operators apply to selection
- `Escape` exits visual mode
- Selection highlights render
- Works with all operators
