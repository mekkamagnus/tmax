# T-Lisp Keymap Data Structures

## Status

Accepted

## Context

The tmax editor had all key binding definitions hardcoded in TypeScript, making them inaccessible to T-Lisp code and plugin developers. This limitation prevented:

1. **Programmatic manipulation** of key bindings from T-Lisp
2. **Plugin customization** of key bindings
3. **Runtime key binding inspection** and modification
4. **User customization** through .tmaxrc configuration

The keymap system was entirely encapsulated within TypeScript's `Map` data structures, with no API exposed to the T-Lisp interpreter.

## Decision

Expose keymap data structures to T-Lisp through the T-Lisp API, enabling programmatic manipulation:

### Implementation

Created three new T-Lisp API functions in `src/editor/api/keymap-ops.ts`:

1. **`keymap-get`** - Retrieve keymap for a specific mode
   - Input: mode (string)
   - Output: alist ((key . command) ...)

2. **`keymap-set`** - Set keymap for a specific mode
   - Input: mode (string), keymap (alist)
   - Modifies the global keymap registry

3. **`keymap-keys`** - List all bound keys in a mode
   - Input: mode (string)
   - Output: list of key strings (e.g., ("j" "k" "l"))

### Data Structure Format

Keymaps are represented as association lists (alists):
```lisp
((("j" . "cursor-move-down")
  ("k" . "cursor-move-up")
  ("h" . "cursor-move-left"))
 ("i" . "enter-insert-mode")
  (":" . "enter-command-mode")))
```

### Integration Points

- **T-Lisp Interpreter**: Added keymap operations to the global environment
- **Editor Core**: Maintained TypeScript `Map<string, Map<string, string>>` for performance
- **Conversion Layer**: Alist ↔ Map conversion at API boundaries

## Consequences

### Benefits

1. **Plugin Development**: Plugins can now define and modify key bindings
2. **Runtime Customization**: Users can customize bindings in .tmaxrc
3. **Debugging**: Can inspect key bindings programmatically
4. **Flexibility**: Full keymap control from T-Lisp layer

### Trade-offs

1. **Performance Overhead**: alist ↔ Map conversion on each API call
2. **Type Safety**: Dynamic alist structure loses TypeScript type safety
3. **Complexity**: Two representations of keymaps (TypeScript Map + T-Lisp alist)

### Future Considerations

1. **Keymap Inheritance**: Support parent/child keymap relationships
2. **Keymap Validation**: Add validation for key binding conflicts
3. **Lazy Conversion**: Cache converted keymaps to reduce overhead
4. **Documentation**: Auto-generate keymap documentation from alists

### Testing

Created `test/unit/keymap-data-structures.test.ts`:
- Verify `keymap-get` returns correct alist
- Verify `keymap-set` modifies global keymap
- Verify `keymap-keys` returns list of bound keys
- Test alist ↔ Map conversion accuracy
