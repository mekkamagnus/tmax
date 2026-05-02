# Yank (Copy) Operator

## Status

**proposed**

## Context

Vim-style yank (copy) operator needed:
- `y{motion}` - Yank (copy) text covered by motion
- `yy` - Yank entire line
- `yw` - Yank word
- `y$` - Yank to end of line
- Yanked text goes to kill ring

## Decision

Implement yank operator for copying text:

### Yank Operator

```typescript
export class YankOperator implements Operator {
  execute(buffer: Buffer, motion: Motion): YankResult {
    const start = buffer.getCursor();
    const end = motion.execute(buffer);
    const range = { start, end };

    const yanked = buffer.getText(range);

    // Store in kill ring
    killRingPush(yanked);

    // Don't modify buffer
    return {
      yanked,
      cursor: start  // Cursor doesn't move
    };
  }
}
```

### Motion Composition

Yank + motion = copy text without deleting:
```lisp
;; Yank word
yw  ; => Copy word, don't delete

;; Yank line
yy  ; => Copy entire line

;; Yank to end of line
y$  ; => Copy to line end

;; Yank in visual mode
v...y  ; => Copy selection
```

### Kill Ring Integration

Yanked text stored in kill ring:
```lisp
;; Yank goes to kill ring
(let ((result (yank-operator buffer (word-forward-motion))))
  (kill-ring-push result.yanked))
```

### Implementation

Created `src/editor/operators/yank.ts`:
```typescript
export function yankOperator(
  buffer: Buffer,
  motion: Motion
): { yanked: string; cursor: Position } {
  const start = buffer.getCursor();
  const end = motion.execute(buffer);
  const range = { start, end };

  const yanked = buffer.getText(range);

  // Store in kill ring
  killRingPush(yanked);

  // Cursor stays at original position
  return { yanked, cursor: start };
}
```

### Key Bindings

```lisp
;; Yank operator
(key-bind "y" "yank-operator-pending" "normal")

;; Special case: yy yanks line
(key-bind "y" "yank-line" "normal" :waiting true)
```

## Consequences

### Benefits

1. **Copy-Paste**: Essential text copying functionality
2. **Kill Ring**: Yanked text available for paste
3. **Non-Destructive**: Doesn't modify buffer
4. **Composable**: Works with any motion

### Trade-offs

1. **Operator Mode**: Must enter operator-pending mode
2. **Visual Mode**: Different behavior in visual mode
3. **Kill Ring Size**: Must limit kill ring size
4. **Clipboard**: Integration with system clipboard

### Future Considerations

1. **Register Yank**: `"ay` to yank to register a
2. **System Clipboard`: `"+y` to yank to system clipboard
3. **Yank Append**: `Ay` to append to register
4. **Yank History**: Track all yanks for paste menu

### Testing

Created `test/unit/editor.test.ts`:
- `yw` yanks word correctly
- `yy` yanks entire line
- `y$` yanks to end of line
- Yanked text in kill ring
- Buffer unchanged after yank
- Cursor position unchanged
