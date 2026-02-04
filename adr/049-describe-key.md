# Describe Key

## Status

Accepted

## Context

Key binding help needed:
- Show what command is bound to key
- Show key binding location
- Help for key sequences

## Decision

Implement describe-key functionality:

### Describe Key Function

```typescript
export function describeKey(keySequence: string): KeyBinding | null {
  // Find binding for key sequence
  for (const mode of ['normal', 'insert', 'visual', 'command']) {
    const binding = keymap.get(mode)?.get(keySequence);
    if (binding) {
      return {
        keySequence,
        mode,
        command: binding.command,
        description: binding.description
      };
    }
  }

  return null;
}
```

### Describe Key Display

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Key: C-h k (describe-key)

Press a key sequence to describe...

User pressed: "w"

"w" runs the command cursor-word-forward
  Move cursor to the start of the next word

Defined in: src/tlisp/core/bindings/normal.tlisp
Mode: normal
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Key Describing Commands

```lisp
;; Describe key
C-h k    ; => Describe key (prompt for key)
C-h c    ; => Describe key briefly (one-line)

;; Describe mode
C-h m    ; => Describe current mode
C-h b    ; => Describe all bindings
```

### Implementation

Created `src/editor/describe.ts`:
- Key sequence lookup
- Binding resolution
- Mode-specific lookups
- UI rendering

## Consequences

### Benefits

1. **Discovery**: Find what keys do
2. **Learning**: Learn key bindings
3. **Debugging**: Debug binding issues
4. **Reference**: Quick key reference

### Trade-offs

1. **Modal**: Interrupts workflow
2. **Prefix Keys**: Must handle prefix keys
3. **Unbound Keys**: Unbound keys show nothing
4. **Mode Specific**: Same key can do different things

### Future Considerations

1. **Describe Prefix**: Describe all keys in prefix
2. **Describe Keymap**: Show entire keymap
3. **Describe Remapping`: Show key remappings
4. **Custom Descriptions`: User-defined descriptions

### Testing

Created `test/unit/editor.test.ts`:
- `C-h k` prompts for key
- Key lookup works correctly
- Mode-specific bindings shown
- Unbound keys show message
- Display shows command and description
- Location shown
- ESC cancels
