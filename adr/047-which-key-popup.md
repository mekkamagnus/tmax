# Which-Key Popup

## Status

Accepted

## Context

Key binding discovery interface:
- Show available bindings after prefix key
- Visual key binding reference
- Help for unbound keys

## Decision

Implement which-key popup:

### Which-Key Display

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPC (prefix)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  SPC b    Buffer commands
  SPC f    File commands
  SPC w    Window commands
  SPC ;    M-x command

Type key to continue, or ESC to cancel
```

### Which-Key Logic

```typescript
export class WhichKey {
  private bindings: Map<string, KeyBinding>;
  private currentPrefix: string = '';

  show(prefix: string): KeyBinding[] {
    this.currentPrefix = prefix;

    // Find all bindings with this prefix
    const matches: KeyBinding[] = [];

    for (const [keySequence, binding] of this.bindings) {
      if (keySequence.startsWith(prefix) && keySequence !== prefix) {
        const nextKey = keySequence[prefix.length];
        matches.push({
          key: nextKey,
          remaining: keySequence.slice(prefix.length + 1),
          description: binding.description,
          command: binding.command
        });
      }
    }

    return this.matches.sort((a, b) => a.key.localeCompare(b.key));
  }
}
```

### Which-Key Commands

```lisp
;; Show which-key
SPC SPC    ; => Show which-key for SPC prefix
g ?       ; => Show which-key for g prefix

;; Custom which-key timeout
(which-key-delay 1.0)  ; => Show which-key after 1 second
```

### Implementation

Created `src/editor/which-key.ts`:
- Prefix detection
- Binding lookup
- UI rendering
- Timeout handling

## Consequences

### Benefits

1. **Discovery**: Discover key bindings easily
2. **Learning**: Learn bindings interactively
3. **Reference**: Visual binding reference
4. **Help**: Shows available commands

### Trade-offs

1. **Screen Space**: Which-key consumes screen space
2. **Interruption**: Pauses workflow
3. **Timeout**: Auto-timeout can be annoying
4. **Complexity**: Which-key state management

### Future Considerations

1. **Which-Key Menu`: Navigate with hjkl
2. **Custom Descriptions`: User-defined descriptions
3. **Which-Key Filtering`: Filter by keyword
4. **Which-Key Persistence**: Remember last which-key

### Testing

Created `test/unit/editor.test.ts`:
- Which-key shows bindings correctly
- Prefix detection works
- Display renders correctly
- Timeout works
- Key selection executes command
- ESC cancels which-key
