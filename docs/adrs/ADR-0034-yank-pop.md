# Yank Pop

## Status

**proposed**

## Context

Cycle through kill ring entries:
- `M-y` - Yank pop (replace last paste with previous kill)
- Works in insert mode
- Cycles through kill ring history

## Decision

Implement yank pop for cycling through kill ring:

### Yank Pop Operation

```typescript
export function yankPop(buffer: Buffer): void {
  if (!lastPaste) {
    // No previous paste, do nothing
    return;
  }

  // Remove last pasted text
  buffer.delete({
    start: lastPaste.start,
    end: lastPaste.end
  });

  // Get previous kill ring entry
  const previous = killRing.yankPop();
  if (!previous) return;

  // Paste previous entry
  buffer.insert(lastPaste.start, previous);

  // Update last paste tracking
  lastPaste = {
    start: lastPaste.start,
    end: {
      line: lastPaste.start.line,
      column: lastPaste.start.column + previous.length
    }
  };
}
```

### Usage Pattern

```lisp
;; In insert mode
C-y  ; => Yank (paste) current kill ring entry
M-y  ; => Replace with previous kill ring entry
M-y  ; => Continue cycling backwards

;; Example workflow
1. Delete word "foo"  ; => "foo" in kill ring slot 0
2. Delete word "bar"  ; => "bar" in kill ring slot 1
3. Paste (p)          ; => Pastes "bar"
4. Yank pop (M-y)     ; => Replaces with "foo"
```

### Implementation

Created `src/editor/kill-ring.ts`:
- Track last paste operation
- Yank pop function
- Cycle backwards through kill ring
- Insert mode integration

### Key Bindings

```lisp
;; In insert mode
(key-bind "M-y" "yank-pop" "insert")
```

## Consequences

### Benefits

1. **Quick Access**: Cycle through recent kills
2. **Efficiency**: Replace paste without leaving insert mode
3. **Emacs Compatibility**: `M-y` is standard Emacs binding

### Trade-offs

1. **State Tracking**: Must track last paste operation
2. **Mode Specific**: Only works in insert mode
3. **Can Be Confusing**: Users may not know about kill ring cycling
4. **Undo**: Each yank pop creates undo entry

### Future Considerations

1. **Visual Yank Pop**: Show menu of kill ring entries
2. **Yank Pop Forward**: Cycle forward through kill ring
3. **Yank Pop in Normal Mode`: `p` then `.` to repeat
4. **Kill Ring Search`: Search through kill ring history

### Testing

Created `test/unit/editor.test.ts`:
- `M-y` cycles through kill ring
- Replaces last paste correctly
- Works only after paste
- Cycles backwards correctly
- Multiple `M-y` cycles continue
