# Count Prefix

## Status

**proposed**

## Context

Vim-style count prefix needed for repeating commands:
- `3j` - Move down 3 lines
- `5dw` - Delete 5 words
- `10k` - Move up 10 lines
- `2dd` - Delete 2 lines

## Decision

Implement count prefix parsing for all commands:

### Count Parsing

```typescript
export function parseCount(input: string): { count: number; remaining: string } {
  const match = input.match(/^(\d+)(.*)$/);
  if (!match) {
    return { count: 1, remaining: input };
  }

  return {
    count: parseInt(match[1], 10),
    remaining: match[2]
  };
}
```

### Command Execution

```lisp
;; Parse count from input
3j  ; => count=3, command="j"
5dw  ; => count=5, operator="d", motion="w"
2dd  ; => count=2, operator="d", motion="d"
```

### Count Semantics

Count applies to:
- **Motions**: Repeat motion N times
- **Operators**: Apply operator to N motions
- **Special Cases**: `dd` applies to N lines

### Implementation

Created `src/editor/input-handler.ts`:
```typescript
export function handleInput(input: string, buffer: Buffer): void {
  const { count, remaining } = parseCount(input);

  // Apply count to command
  if (isMotion(remaining)) {
    const motion = getMotion(remaining);
    for (let i = 0; i < count; i++) {
      motion.execute(buffer);
    }
  } else if (isOperator(remaining)) {
    const [op, motionName] = parseOperator(remaining);
    const motion = getMotion(motionName);
    op.execute(buffer, motion, count);
  }
}
```

### Special Cases

```lisp
;; dd deletes count lines
3dd  ; => Delete 3 lines (lines 1-3)

;; dw deletes count words
5dw  ; => Delete 5 words

;; c{motion} with count
3cw  ; => Change 3 words
```

## Consequences

### Benefits

1. **Efficiency**: Quick repetition of commands
2. **Vim Compatibility**: Standard vim behavior
3. **Flexibility**: Apply to any command
4. **Composability**: Works with operators

### Trade-offs

1. **Parsing Complexity**: Must parse count before command
2. **Default Count**: Commands must handle count=1
3. **Edge Cases**: Some commands have special count behavior
4. **Large Counts**: Must handle very large counts

### Future Considerations

1. **Count Multiplication**: `2d3w` deletes 6 words
2. **Count Range**: `5,10d` deletes lines 5-10
3. **Count Modifiers**: `v3j` visual select 3 lines
4. **Count Validation**: Validate count ranges

### Testing

Created `test/unit/editor.test.ts`:
- `3j` moves down 3 lines
- `5k` moves up 5 lines
- `2dw` deletes 2 words
- `3dd` deletes 3 lines
- Count of 1 is default (no count needed)
- Large counts work (100j)
- Count 0 is treated as 1
- Count applies to motions correctly
