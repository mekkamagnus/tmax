# Undo/Redo

## Status

Accepted

## Context

Essential editing capability needed:
- `u` - Undo last change
- `Ctrl-r` - Redo undone change
- Linear undo history
- Persists across buffer edits

## Decision

Implement linear undo/redo system:

### Undo History

```typescript
interface UndoEntry {
  type: 'insert' | 'delete' | 'replace';
  position: Position;
  oldContent: string;
  newContent: string;
  timestamp: number;
}

export class UndoHistory {
  private past: UndoEntry[] = [];
  private future: UndoEntry[] = [];
  private maxSize: number = 1000;

  add(entry: UndoEntry): void {
    this.past.push(entry);
    this.future = [];  // Clear redo history on new change

    // Limit history size
    if (this.past.length > this.maxSize) {
      this.past.shift();
    }
  }

  undo(): UndoEntry | null {
    const entry = this.past.pop();
    if (entry) {
      this.future.push(entry);
    }
    return entry;
  }

  redo(): UndoEntry | null {
    const entry = this.future.pop();
    if (entry) {
      this.past.push(entry);
    }
    return entry;
  }
}
```

### Undo Operations

```lisp
;; Undo last change
u  ; => Reverts last edit

;; Redo undone change
C-r  ; => Re-applies undone edit
```

### Implementation

Created `src/editor/undo.ts`:
```typescript
export function undo(buffer: Buffer): void {
  const entry = undoHistory.undo();
  if (!entry) return;

  switch (entry.type) {
    case 'insert':
      buffer.delete(entry.position, entry.position);
      break;
    case 'delete':
      buffer.insert(entry.position, entry.oldContent);
      break;
    case 'replace':
      buffer.replace(entry.position, entry.oldContent);
      break;
  }

  buffer.setCursor(entry.position);
}

export function redo(buffer: Buffer): void {
  const entry = undoHistory.redo();
  if (!entry) return;

  switch (entry.type) {
    case 'insert':
      buffer.insert(entry.position, entry.newContent);
      break;
    case 'delete':
      buffer.delete(entry.position);
      break;
    case 'replace':
      buffer.replace(entry.position, entry.newContent);
      break;
  }

  buffer.setCursor(entry.position);
}
```

### Key Bindings

```lisp
;; Undo/Redo
(key-bind "u" "undo" "normal")
(key-bind "C-r" "redo" "normal")
```

## Consequences

### Benefits

1. **Error Recovery**: Fix mistakes easily
2. **Experimentation**: Try changes without fear
3. **Standard UX**: Familiar undo/redo behavior
4. **Linear History**: Simple to understand

### Trade-offs

1. **Linear Only**: No branching (like undo tree)
2. **Memory Usage**: History consumes memory
3. **Granularity**: Each edit creates undo entry
4. **Coalescing**: Similar edits not coalesced

### Future Considerations

1. **Undo Tree**: Branching undo history (US-3.4.1)
2. **Coalesce Edits**: Merge sequential similar edits
3. **Persistent Undo**: Save undo history to disk
4. **Undo Across Buffers**: Global undo/redo
5. **Undo Regions**: Group related edits

### Testing

Created `test/unit/editor.test.ts`:
- `u` undoes last change
- `Ctrl-r` redoes undone change
- Multiple undo works
- Undo after new change clears redo
- Cursor position restored
- Works across all edit types
- History size limited
