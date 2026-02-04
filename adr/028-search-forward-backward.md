# Search Forward/Backward

## Status

Accepted

## Context

Essential search capabilities needed:
- `/pattern` - Search forward for pattern
- `?pattern` - Search backward for pattern
- `n` - Repeat search in same direction
- `N` - Repeat search in opposite direction
- Highlight search matches

## Decision

Implement vim-style search:

### Search Command

```typescript
export function searchForward(buffer: Buffer, pattern: string): Position | null {
  const cursor = buffer.getCursor();
  const text = buffer.getText();

  // Search from cursor position
  const searchFrom = cursor.line * buffer.getLineLength(cursor.line) + cursor.column;
  const match = text.substring(searchFrom).search(pattern);

  if (match === -1) {
    // Wrap around to beginning
    const wrappedMatch = text.search(pattern);
    return wrappedMatch === -1 ? null : positionFromIndex(wrappedMatch);
  }

  return positionFromIndex(searchFrom + match);
}

export function searchBackward(buffer: Buffer, pattern: string): Position | null {
  const cursor = buffer.getCursor();
  const text = buffer.getText();

  // Search backwards from cursor position
  const searchFrom = cursor.line * buffer.getLineLength(cursor.line) + cursor.column;
  const reversed = text.substring(0, searchFrom).split('').reverse().join('');
  const match = reversed.search(pattern.split('').reverse().join(''));

  if (match === -1) {
    // Wrap around to end
    const fullReversed = text.split('').reverse().join('');
    const wrappedMatch = fullReversed.search(pattern.split('').reverse().join(''));
    return wrappedMatch === -1 ? null : positionFromIndex(text.length - wrappedMatch);
  }

  return positionFromIndex(searchFrom - match - pattern.length);
}
```

### Search Interface

```lisp
;; Search forward
/pattern  ; => Search forward, move to first match

;; Search backward
?pattern  ; => Search backward, move to first match

;; Repeat search
n  ; => Repeat last search in same direction
N  ; => Repeat last search in opposite direction
```

### Search Highlights

```typescript
export function highlightMatches(buffer: Buffer, pattern: string): void {
  const text = buffer.getText();
  const regex = new RegExp(pattern, 'gi');

  let match;
  while ((match = regex.exec(text)) !== null) {
    buffer.addHighlight(match.index, match.index + match[0].length, 'search');
  }
}
```

### Implementation

Created `src/editor/search.ts`:
- Search forward/backward functions
- Search history
- Match highlighting
- Wrap-around search
- Case sensitivity toggle

### Key Bindings

```lisp
;; Search commands
(key-bind "/" "search-forward-prompt" "normal")
(key-bind "?" "search-backward-prompt" "normal")
(key-bind "n" "search-repeat-forward" "normal")
(key-bind "N" "search-repeat-backward" "normal")
```

## Consequences

### Benefits

1. **Quick Navigation**: Find text quickly
2. **Vim Compatibility**: Familiar search interface
3. **Repeatable**: Easy to repeat searches
4. **Visual Feedback**: Highlighted matches

### Trade-offs

1. **Performance**: Large buffer search can be slow
2. **Regex Complexity**: Full regex support is complex
3. **Case Sensitivity**: Must handle case sensitivity
4. **Highlighting**: Highlights can clutter display

### Future Considerations

1. **Incremental Search**: Show matches as you type
2. **Search in Selection**: Limit search to visual selection
3. **Multiple Cursors**: Search and select all matches
4. **Search Replace**: `:s/pattern/replacement/` command
5. **Search Offset**: `;` and `,` for tilda/f search

### Testing

Created `test/unit/editor.test.ts`:
- `/pattern` searches forward
- `?pattern` searches backward
- `n` repeats search in same direction
- `N` repeats search in opposite direction
- Wrap-around works
- Highlights show matches
- Case sensitivity toggle works
- Empty pattern uses last search
