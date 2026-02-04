# Word Under Cursor Search

## Status

**proposed**

## Context

Quick search for the word under cursor:
- `*` - Search forward for word under cursor
- `#` - Search backward for word under cursor
- No need to type the word manually

## Decision

Implement word under cursor search:

### Word Extraction

```typescript
export function getWordUnderCursor(buffer: Buffer): string {
  const cursor = buffer.getCursor();
  const line = buffer.getLine(cursor.line);

  // Find word boundaries
  const start = findWordStart(line, cursor.column);
  const end = findWordEnd(line, cursor.column);

  return line.substring(start, end);
}

function findWordStart(line: string, column: number): number {
  while (column > 0 && isWordChar(line[column - 1])) {
    column--;
  }
  return column;
}

function findWordEnd(line: string, column: number): number {
  while (column < line.length && isWordChar(line[column])) {
    column++;
  }
  return column;
}
```

### Search Commands

```lisp
;; Search forward for word under cursor
*  ; => Search forward for word at cursor

;; Search backward for word under cursor
#  ; => Search backward for word at cursor
```

### Implementation

Created `src/editor/search.ts`:
```typescript
export function searchWordUnderCursor(buffer: Buffer, direction: 'forward' | 'backward'): Position | null {
  const word = getWordUnderCursor(buffer);

  if (direction === 'forward') {
    return searchForward(buffer, word);
  } else {
    return searchBackward(buffer, word);
  }
}
```

### Key Bindings

```lisp
(key-bind "*" "search-word-forward" "normal")
(key-bind "#" "search-word-backward" "normal")
```

## Consequences

### Benefits

1. **Quick Search**: No need to type word
2. **Efficiency**: Fast navigation to same word
3. **Vim Compatibility**: Standard vim feature
4. **Smart**: Word boundaries detected automatically

### Trade-offs

1. **Word Definition**: What constitutes a "word"
2. **Case Sensitivity**: Should search be case-sensitive?
3. **Symbol Search**: Different handling for symbols?

### Future Considerations

1. **Exact Word Match**: Match whole words only
2. **Tag Search**: `Ctrl-]` for tag jump
3. **Include Search**: Search for #include, etc.
4. **Identifier Search**: Smart search for code identifiers

### Testing

Created `test/unit/editor.test.ts`:
- `*` searches forward for word under cursor
- `#` searches backward for word under cursor
- Word boundaries detected correctly
- Non-word characters handled
- Empty word case handled
