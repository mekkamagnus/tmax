# Pure T-Lisp Key Bind Function

## Status

Accepted

## Context

Key bindings were registered through TypeScript function calls, requiring:
- Direct access to the internal `keymap` Map
- TypeScript-level manipulation of binding data structures
- Re-compilation for any binding changes

This prevented pure T-Lisp configuration files and runtime binding manipulation.

## Decision

Implement a pure T-Lisp `key-bind` function for complete key binding definition:

### Function Signature

```lisp
(key-bind key-sequence command mode)
```

- **key-sequence**: String ("j", "C-k", "SPC ;", "g d")
- **command**: T-Lisp expression string
- **mode**: Symbol ("normal", "insert", "visual", "command", "mx")

### Features

1. **Key Sequences**: Support multi-key sequences
   - Single keys: `"j"`, `"k"`, `":"`
   - Prefix keys: `"g"`, `"z"`
   - Composite: `"g d"`, `"z f"`, `"SPC ;"`

2. **Mode-Specific**: Bindings only active in specified mode
   - Prevents conflicts between modes
   - Allows same key in different modes

3. **Binding Removal**: Use `nil` as command to remove binding
   ```lisp
   (key-bind "q" nil "normal")  ; Unbind 'q' in normal mode
   ```

4. **Validation**: Key syntax and mode validation
   - Errors on invalid key format
   - Errors on unknown mode

### Implementation

Created `src/tlisp/core/keybind.tlisp`:
```lisp
(defun key-bind (key-sequence command mode)
  "Bind a key sequence to a command in a specific mode"
  (let ((keymap (keymap-get mode))
        (keys (parse-key-sequence key-sequence)))
    (if (null? command)
        ;; Remove binding
        (keymap-remove-keys keymap keys)
        ;; Add binding
        (keymap-set-key keymap (car keys) command)))
  nil)
```

### Key Sequence Parsing

Implemented `parse-key-sequence` to handle:
- **Single keys**: `"j"` → `("j")`
- **Modifiers**: `"C-k"` → `("Ctrl-k")`
- **Spaces**: `"SPC ;"` → `(" " ";")`
- **Chords**: `"g d"` → `("g" "d")`

## Consequences

### Benefits

1. **Pure T-Lisp Configuration**: No TypeScript required for bindings
2. **Runtime Manipulation**: Bindings can change while editor runs
3. **Consistency**: Single API for all binding operations
4. **Simplicity**: Easy to understand and use
5. **Plugin Support**: Plugins can define their own key bindings

### Trade-offs

1. **String Commands**: Commands are strings, not compiled functions
   - Slightly slower execution (parse + eval)
   - No compile-time syntax checking
2. **Key Syntax**: Limited key syntax support
   - Complex modifier combinations may not work
   - No support for mouse events
3. **Mode Enumeration**: Must specify mode explicitly
   - Can't bind to multiple modes at once

### Future Considerations

1. **Key Binding Groups**: Bind multiple keys in single call
2. **Conditional Bindings**: Bindings based on buffer type or mode
3. **Binding Documentation**: Attach help text to bindings
4. **Key Binding Conflicts**: Warn before overriding existing bindings
5. **Composite Modes**: Bind to multiple modes simultaneously

### Testing

Created `test/unit/test-key-bind-enhancements.test.ts`:
- Single key bindings work correctly
- Key sequences (g d, z f) work correctly
- Mode-specific bindings don't leak
- Binding removal (nil command) works
- Invalid key sequences show errors
