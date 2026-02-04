# Line Navigation

## Status

**proposed**

## Context

Efficient line navigation is fundamental. Basic line movements needed:
- `j` - Move down one line
- `k` - Move up one line
- `0` - Move to first character
- `^` - Move to first non-blank character
- `$` - Move to last character
- `gg` - Go to first line
- `G` - Go to last line (or specified line)

## Decision

Implement comprehensive line navigation:

### Basic Movements

```typescript
export function lineDown(buffer: Buffer): Position {
  return {
    line: Math.min(cursor.line + 1, buffer.lineCount - 1),
    column: cursor.column  // Maintain column position
  };
}

export function lineUp(buffer: Buffer): Position {
  return {
    line: Math.max(cursor.line - 1, 0),
    column: cursor.column
  };
}
```

### Line Endpoints

```typescript
export function lineStart(buffer: Buffer): Position {
  return { line: cursor.line, column: 0 };
}

export function lineFirstNonBlank(buffer: Buffer): Position {
  const line = buffer.getLine(cursor.line);
  const firstNonBlank = line.search(/\S/);
  return { line: cursor.line, column: firstNonBlank >= 0 ? firstNonBlank : 0 };
}

export function lineEnd(buffer: Buffer): Position {
  const line = buffer.getLine(cursor.line);
  return { line: cursor.line, column: line.length - 1 };
}
```

### Jump to Line

```typescript
export function gotoLine(buffer: Buffer, lineNumber: number): Position {
  const targetLine = Math.max(0, Math.min(lineNumber, buffer.lineCount - 1));
  return { line: targetLine, column: 0 };
}

export function gotoFirstLine(buffer: Buffer): Position {
  return { line: 0, column: 0 };
}

export function gotoLastLine(buffer: Buffer): Position {
  return { line: buffer.lineCount - 1, column: 0 };
}
```

### Key Bindings

```lisp
;; Basic navigation
(key-bind "j" "cursor-line-down" "normal")
(key-bind "k" "cursor-line-up" "normal")

;; Line endpoints
(key-bind "0" "cursor-line-start" "normal")
(key-bind "^" "cursor-line-first-non-blank" "normal")
(key-bind "$" "cursor-line-end" "normal")

;; Jump to line
(key-bind "g" "cursor-goto-line" "normal")  ; Requires prefix key
(key-bind "G" "cursor-goto-last-line" "normal")
```

### Column Preservation

When moving vertically, preserve column position:
- Move down: try to maintain same column
- Move to shorter line: clamp to line length
- Move to longer line: use same column

## Consequences

### Benefits

1. **Standard Vim**: Familiar navigation for vim users
2. **Efficiency**: Quick movement through files
3. **Precision**: Accurate positioning
4. **Column Awareness**: Smart column handling

### Trade-offs

1. **Prefix Keys**: `g` requires prefix key handling
2. **Line Numbers**: `G` with count needs parsing
3. **Edge Cases**: Empty lines, buffer boundaries

### Future Considerations

1. **Relative Line Jumping**: `j` and `k` with counts
2. **Screen Line Navigation**: `g j` / `g k` for wrapped lines
3. **Mark Navigation**: Jump to marks (`' a`, `` ` ` ``)
4. **Tag Stack**: Navigate tag stack

### Testing

Created `test/unit/editor.test.ts`:
- `j`/`k` move vertically correctly
- `0` moves to line start
- `^` moves to first non-blank
- `$` moves to line end
- `gg` jumps to first line
- `G` jumps to last line
- Count works with `G`
- Column position preserved correctly
