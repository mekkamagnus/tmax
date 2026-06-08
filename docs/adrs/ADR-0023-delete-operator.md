# Delete Operator

## Status

**proposed**

## Context

Vim-style delete operator needed for removing text:
- `d{motion}` - Delete text covered by motion
- `dd` - Delete entire line
- `d$` - Delete to end of line
- `dw` - Delete word
- Deleted text goes to kill ring

## Decision

Implement delete operator with motion composition:

### Operator Architecture

```typescript
interface Operator {
  execute(buffer: Buffer, motion: Motion): EditResult;
}

export class DeleteOperator implements Operator {
  execute(buffer: Buffer, motion: Motion): EditResult {
    const range = motion.getRange(buffer);
    buffer.delete(range);
    return {
      deleted: buffer.getText(range),
      cursor: range.start
    };
  }
}
```

### Motion Composition

Delete + motion = delete text from cursor to motion target:
```lisp
;; Delete to end of line
d$  ; => Delete from cursor to line end

;; Delete word
dw  ; => Delete from cursor to word end

;; Delete line
dd  ; => Delete entire line

;; Delete to mark
d'm  ; => Delete from cursor to mark m
```

### Kill Ring Integration

Deleted text stored in kill ring:
```lisp
;; Delete goes to kill ring
(let ((result (delete-operator buffer (word-forward-motion))))
  (kill-ring-push result.deleted))
```

### Implementation

Created `src/editor/operators/delete.ts`:
```typescript
export function deleteOperator(
  buffer: Buffer,
  motion: Motion
): { deleted: string; cursor: Position } {
  const start = buffer.getCursor();
  const end = motion.execute(buffer);
  const range = { start, end };

  const deleted = buffer.getText(range);
  buffer.delete(range);

  // Store in kill ring
  killRingPush(deleted);

  return { deleted, cursor: start };
}
```

### Key Bindings

```lisp
;; Delete operator
(key-bind "d" "delete-operator-pending" "normal")

;; Special case: dd deletes line
(key-bind "d" "delete-line" "normal" :waiting true)
```

## Consequences

### Benefits

1. **Vim Compatibility**: Familiar delete operator
2. **Composability**: Works with any motion
3. **Kill Ring**: Deleted text available for yank
4. **Efficiency**: Quick text removal

### Trade-offs

1. **Operator Parsing**: Must parse operator-motion sequences
2. **Visual Mode**: Delete also works in visual mode
3. **Undo**: Each delete creates undo state
4. **Kill Ring**: Must manage kill ring size

### Future Considerations

1. **Black Hole Register**: `"_d` to delete without storing
2. **Register Specification**: `"ad` to delete to register a
3. **Delete Indentation**: `<<` operator
4. **Delete with Auto-indent**: Smart indentation after delete

### Testing

Created `test/unit/editor.test.ts`:
- `dw` deletes word correctly
- `d$` deletes to end of line
- `dd` deletes entire line
- Deleted text in kill ring
- Cursor position correct after delete
- Works with all motions
