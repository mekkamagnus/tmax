# Jump Commands

## Status

**proposed**

## Context

Quick navigation to specific locations needed:
- `gg` - Go to first line
- `G` - Go to last line (or specified line)
- `:n` - Go to line n
- Jump list for navigation history

## Decision

Implement jump commands:

### Line Jumps

```typescript
export function gotoLine(buffer: Buffer, lineNumber?: number): Position {
  const targetLine = lineNumber !== undefined
    ? Math.max(1, Math.min(lineNumber, buffer.lineCount))
    : (countPrefix || buffer.lineCount);

  return {
    line: targetLine - 1,  // Convert to 0-indexed
    column: 0
  };
}
```

### Jump List

```typescript
interface Jump {
  position: Position;
  buffer: string;
  timestamp: number;
}

export class JumpList {
  private jumps: Jump[] = [];
  private current: number = -1;

  add(position: Position, buffer: string): void {
    // Remove jumps after current position
    this.jumps = this.jumps.slice(0, this.current + 1);

    // Don't add duplicate jumps
    if (this.current >= 0 && this.samePosition(this.jumps[this.current], { position, buffer })) {
      return;
    }

    this.jumps.push({ position, buffer, timestamp: Date.now() });
    this.current = this.jumps.length - 1;

    // Limit jump list size
    if (this.jumps.length > 100) {
      this.jumps.shift();
      this.current--;
    }
  }

  older(): Jump | null {
    if (this.current > 0) {
      this.current--;
      return this.jumps[this.current];
    }
    return null;
  }

  newer(): Jump | null {
    if (this.current < this.jumps.length - 1) {
      this.current++;
      return this.jumps[this.current];
    }
    return null;
  }
}
```

### Jump Commands

```lisp
;; Jump to line
gg    ; => Go to first line
G     ; => Go to last line
50G   ; => Go to line 50
:50   ; => Go to line 50 (command mode)

;; Jump list navigation
Ctrl-o  ; => Go to older position in jump list
Ctrl-i  ; => Go to newer position in jump list
```

### Implementation

Created `src/editor/jump.ts`:
- `gotoLine()` function
- Jump list management
- Jump tracking on cursor movements
- Jump list navigation

### Key Bindings

```lisp
(key-bind "g" "goto-line-pending" "normal")
(key-bind "G" "goto-last-line" "normal")
(key-bind "C-o" "jump-older" "normal")
(key-bind "C-i" "jump-newer" "normal")
```

## Consequences

### Benefits

1. **Quick Navigation**: Jump to specific lines
2. **Navigation History**: Jump list tracks movements
3. **Vim Compatibility**: Standard vim jump commands
4. **Efficiency**: Quick position changes

### Trade-offs

1. **Jump List Size**: Must limit memory usage
2. **Jump Detection**: Which movements create jumps
3. **Cross-Buffer**: Jump list per buffer or global?

### Future Considerations

1. **Mark Navigation**: Jump to marks (`'a`, `` `a ``)
2. **Tag Stack**: Tag-based navigation
3. **Change List**: Jump to last changes
4. **Smart Jumps**: Auto-jump to errors, TODOs, etc.

### Testing

Created `test/unit/editor.test.ts`:
- `gg` jumps to first line
- `G` jumps to last line
- `50G` jumps to line 50
- `:50` command jumps to line 50
- `Ctrl-o` goes to older jump
- `Ctrl-i` goes to newer jump
- Jump list tracks movements
