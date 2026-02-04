# Kill Ring Storage

## Status

Accepted

## Context

Vim-style kill ring for yank/delete operations:
- Store deleted/yanked text
- Cycle through kill ring with `p`
- Multiple kill entries
- Persists across edits

## Decision

Implement kill ring for text storage:

### Kill Ring Data Structure

```typescript
export class KillRing {
  private ring: string[] = [];
  private maxSize: number = 60;
  private current: number = 0;

  push(text: string): void {
    // Don't push duplicate entries
    if (this.ring.length > 0 && this.ring[this.current] === text) {
      return;
    }

    // Remove entries after current (for yank-pop)
    this.ring = this.ring.slice(0, this.current + 1);

    // Add new entry
    this.ring.push(text);

    // Limit size
    if (this.ring.length > this.maxSize) {
      this.ring.shift();
    } else {
      this.current++;
    }
  }

  getCurrent(): string | null {
    if (this.current >= 0 && this.current < this.ring.length) {
      return this.ring[this.current];
    }
    return null;
  }

  yankPop(): string | null {
    this.current = (this.current - 1 + this.ring.length) % this.ring.length;
    return this.getCurrent();
  }
}
```

### Kill Ring Operations

```lisp
;; Yank (paste) from kill ring
p  ; => Paste after cursor
P  ; => Paste before cursor

;; Cycle through kill ring
0p  ; => Yank first entry
1p  ; => Yank second entry (yank-pop)
```

### Integration

Delete and yank operations automatically push to kill ring:
```typescript
export function deleteOperator(buffer: Buffer, motion: Motion): EditResult {
  const deleted = buffer.getText(range);
  buffer.delete(range);

  // Push to kill ring
  killRing.push(deleted);

  return { deleted, cursor: range.start };
}

export function yankOperator(buffer: Buffer, motion: Motion): YankResult {
  const yanked = buffer.getText(range);

  // Push to kill ring
  killRing.push(yanked);

  return { yanked, cursor: range.start };
}
```

### Paste Operations

```typescript
export function pasteAfter(buffer: Buffer, text: string): void {
  const cursor = buffer.getCursor();
  buffer.insert(cursor, text);
  buffer.setCursor({ line: cursor.line, column: cursor.column + text.length });
}

export function pasteBefore(buffer: Buffer, text: string): void {
  const cursor = buffer.getCursor();
  buffer.insert(cursor, text);
  buffer.setCursor(cursor);  // Cursor at start of pasted text
}
```

### Implementation

Created `src/editor/kill-ring.ts`:
- Kill ring data structure
- Push, getCurrent, yankPop methods
- Integration with delete/yank operators
- Paste before/after operations

### Key Bindings

```lisp
;; Paste from kill ring
(key-bind "p" "paste-after" "normal")
(key-bind "P" "paste-before" "normal")

;; Yank-pop (in insert mode)
(key-bind "C-y" "yank-pop" "insert")
```

## Consequences

### Benefits

1. **Multi-Item Clipboard**: Access to multiple previous copies
2. **Efficiency**: Quick access to recent kills
3. **Vim Compatibility**: Standard kill ring behavior
4. **Automatic**: Kills automatically stored

### Trade-offs

1. **Memory Usage**: Kill ring consumes memory
2. **Size Limits**: Must limit kill ring size
3. **Duplicate Detection**: Must handle duplicates
4. **Yank-Pop Confusion**: Can be confusing for users

### Future Considerations

1. **Register Support`: `"ay` to yank to register a
2. **System Clipboard Integration`: Access OS clipboard
3. **Persistent Kill Ring`: Save kill ring to disk
4. **Kill Ring Menu`: Visual kill ring browser

### Testing

Created `test/unit/editor.test.ts`:
- Delete pushes to kill ring
- Yank pushes to kill ring
- `p` pastes after cursor
- `P` pastes before cursor
- `Ctrl-y` cycles through kill ring
- Kill ring limited to max size
- Duplicates not pushed
- Cursor positioning correct after paste
