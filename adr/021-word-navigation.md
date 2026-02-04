# Word Navigation

## Status

Accepted

## Context

Vim-style word navigation is essential for efficient text editing. The editor lacked:
- `w` - Move to start of next word
- `e` - Move to end of current word
- `b` - Move to start of previous word
- Capital variants (`W`, `E`, `B`) for WORD movements

## Decision

Implement vim-style word navigation in normal mode:

### Word Boundaries

Defined word boundaries in `src/core/word.ts`:
- **Word**: Sequence of alphanumeric + underscore
- **WORD**: Sequence of non-whitespace characters

### Movement Logic

```typescript
export function wordForward(buffer: Buffer, from: Position): Position {
  // Move to start of next word
  // Skip current word
  // Skip whitespace
  // Land on first character of next word
}

export function wordEnd(buffer: Buffer, from: Position): Position {
  // Move to end of current word
  // Skip to last alphanumeric character
}

export function wordBackward(buffer: Buffer, from: Position): Position {
  // Move to start of previous word
  // Skip whitespace
  // Land on first character of previous word
}
```

### Key Bindings

```lisp
;; Word movements
(key-bind "w" "cursor-word-forward" "normal")
(key-bind "e" "cursor-word-end" "normal")
(key-bind "b" "cursor-word-backward" "normal")

;; WORD movements (capital)
(key-bind "W" "cursor-WORD-forward" "normal")
(key-bind "E" "cursor-WORD-end" "normal")
(key-bind "B" "cursor-WORD-backward" "normal")
```

### Count Prefix

Support count prefix for repeated movements:
```lisp
;; Move 3 words forward
3w  ; => Calls (cursor-word-forward 3)

;; Move 2 WORDs backward
2B  ; => Calls (cursor-WORD-backward 2)
```

## Consequences

### Benefits

1. **Vim Compatibility**: Familiar navigation for vim users
2. **Efficiency**: Move quickly through text
3. **Precision**: Land on word boundaries accurately
4. **Word vs WORD**: Two granularity levels for different use cases

### Trade-offs

1. **Complexity**: Word boundary detection is subtle
2. **Unicode**: Word boundaries may not work perfectly with Unicode
3. **Performance**: Must scan buffer to find boundaries
4. **Edge Cases**: Empty lines, punctuation, mixed content

### Future Considerations

1. **CamelCase Navigation**: Navigate by sub-word (camelCase, PascalCase)
2. **Custom Word Boundaries**: User-defined word patterns
3. **Screen Navigation**: `g w` to navigate by screen words
4. **Sexpr Navigation**: Navigate by s-expressions for Lisp
5. **Jump List**: Maintain jump list for word movements

### Testing

Created `test/unit/editor.test.ts`:
- `w` moves to start of next word
- `e` moves to end of current word
- `b` moves to start of previous word
- `W`/`E`/`B` handle WORD movements
- Count prefix repeats movement correctly
- Works at buffer boundaries
- Handles empty buffers
