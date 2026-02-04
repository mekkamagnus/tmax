# Command Documentation Preview

## Status

Accepted

## Context

Command help documentation needed:
- Show command help in minibuffer
- Preview command effects
- Command examples
- Related commands

## Decision

Implement command documentation preview:

### Documentation Lookup

```typescript
export class CommandDocumentation {
  private docs: Map<string, CommandDoc>;

  getDocumentation(command: string): CommandDoc | null {
    return this.docs.get(command) || null;
  }

  search(query: string): CommandDoc[] {
    const results: CommandDoc[] = [];

    for (const [cmd, doc] of this.docs) {
      if (cmd.includes(query) || doc.description.includes(query)) {
        results.push(doc);
      }
    }

    return results;
  }
}

interface CommandDoc {
  name: string;
  description: string;
  usage: string;
  examples: string[];
  related: string[];
}
```

### Documentation Display

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Command: cursor-move

Move cursor to specified line and column.

Usage: (cursor-move line column)

Examples:
  (cursor-move 10 5)    ; Move to line 10, column 5
  (cursor-move 0 0)     ; Move to beginning

Related: cursor-up, cursor-down, cursor-left, cursor-right

Press RET to execute, or ESC to cancel
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Documentation Commands

```lisp
;; Show command documentation
C-h f command-name    ; => Describe function
M-x describe-function ; => Interactive describe

;; Search documentation
C-h a keyword        ; => Apropos search
C-h d keyword        ; => Documentation search
```

### Implementation

Created `src/editor/docs.ts`:
- Documentation storage
- Lookup functions
- Search functions
- UI rendering

## Consequences

### Benefits

1. **Help**: In-editor help system
2. **Documentation**: Command reference
3. **Discovery**: Discover related commands
4. **Learning**: Learn command usage

### Trade-offs

1. **Maintenance**: Documentation must be maintained
2. **Screen Space**: Documentation consumes space
3. **Completeness**: Not all commands have docs
4. **Accuracy**: Documentation can become outdated

### Future Considerations

1. **Auto-Generated Docs**: Generate from source
2. **User Documentation**: Users can add docs
3. **Hyperlinks**: Clickable links in docs
4. **Documentation Search**: Full-text search

### Testing

Created `test/unit/editor.test.ts`:
- Documentation displays correctly
- Lookup finds commands
- Search returns relevant results
- Examples are clear
- Related commands listed
- RET executes command
- ESC cancels
