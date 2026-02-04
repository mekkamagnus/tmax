# Change Operator

## Status

Accepted

## Context

Vim-style change operator needed:
- `c{motion}` - Change text (delete + enter insert mode)
- `cw` - Change word
- `c$` - Change to end of line
- `cc` - Change entire line
- Combines delete with insert mode

## Decision

Implement change operator that deletes and enters insert mode:

### Change Operator

```typescript
export class ChangeOperator implements Operator {
  execute(buffer: Buffer, motion: Motion): EditResult {
    // Delete text covered by motion
    const deleteResult = deleteOperator.execute(buffer, motion);

    // Enter insert mode
    setMode('insert');

    return deleteResult;
  }
}
```

### Motion Composition

Change + motion = delete + enter insert mode:
```lisp
;; Change word
cw  ; => Delete word, enter insert mode

;; Change to end of line
c$  ; => Delete to line end, enter insert mode

;; Change line
cc  ; => Delete entire line, enter insert mode

;; Change in visual mode
v...c  ; => Delete selection, enter insert mode
```

### Special Cases

```lisp
;; cc changes entire line (like dd but enters insert mode)
3cc  ; => Change 3 lines

;; c{motion} works like d{motion} but enters insert mode
```

### Implementation

Created `src/editor/operators/change.ts`:
```typescript
export function changeOperator(
  buffer: Buffer,
  motion: Motion
): EditResult {
  // Delete text
  const result = deleteOperator(buffer, motion);

  // Enter insert mode
  buffer.setMode('insert');

  return result;
}
```

### Key Bindings

```lisp
;; Change operator
(key-bind "c" "change-operator-pending" "normal")

;; Special case: cc changes line
(key-bind "c" "change-line" "normal" :waiting true)
```

## Consequences

### Benefits

1. **Efficiency**: Delete and type in one operation
2. **Vim Compatibility**: Standard vim change operator
3. **Workflow**: Natural editing flow
4. **Composable**: Works with any motion

### Trade-offs

1. **Mode Switch**: Must handle mode transition
2. **Cursor Position**: Cursor position after change
3. **Undo**: Change creates single undo entry
4. **Visual Mode**: Different behavior in visual mode

### Future Considerations

1. **Change with Auto-indent**: Smart indentation after change
2. **Change Line Excluding Newline**: `C` vs `cc`
3. **Change with Yank**: Don't yank changed text
4. **Change with Register`: `"cc` to change to register

### Testing

Created `test/unit/editor.test.ts`:
- `cw` deletes word and enters insert mode
- `c$` deletes to line end and enters insert mode
- `cc` deletes line and enters insert mode
- Deleted text in kill ring
- Mode changes to insert after change
- Cursor position correct after change
- Count prefix works (3cw changes 3 words)
- Works in visual mode
