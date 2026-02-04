# Core Bindings in T-Lisp Files

## Status

Accepted

## Context

All default key bindings were hardcoded in TypeScript (`src/editor/editor.ts`), making them:
- Difficult to modify without recompiling
- Inaccessible to plugin developers
- Not visible for user customization
- Scattered across TypeScript initialization code

Moving bindings to T-Lisp files enables easier customization and better organization.

## Decision

Move all default key bindings from TypeScript to T-Lisp files in `src/tlisp/core/bindings/`:

### File Structure

Created mode-specific binding files:
```
src/tlisp/core/bindings/
├── normal.tlisp    # Normal mode bindings (hjkl, operators)
├── insert.tlisp    # Insert mode bindings (Escape, Ctrl-[, etc.)
├── visual.tlisp    # Visual mode bindings (v, V, navigation)
├── command.tlisp   # Command mode bindings (Enter, Esc, navigation)
└── mx.tlisp        # M-x mode bindings (execution, cancellation)
```

### Implementation Pattern

Each binding file uses the `key-bind` function:
```lisp
;; normal.tlisp
(key-bind "j" "cursor-move (cursor-line) (+ 1 (cursor-column))" "normal")
(key-bind "k" "cursor-move (max 0 (- (cursor-line) 1)) (cursor-column)" "normal")
(key-bind "i" "enter-insert-mode" "normal")
(key-bind ":" "enter-command-mode" "normal")
```

### Loading Mechanism

Modified `src/main.tsx` to load core bindings during initialization:
1. Check for `src/tlisp/core/bindings/*.tlisp` files
2. Load each file in sequence (normal → insert → visual → command → mx)
3. Execute T-Lisp code to register bindings
4. Fall back to TypeScript defaults if T-Lisp files fail to load

## Consequences

### Benefits

1. **Customization**: Users can override bindings by modifying core files
2. **Transparency**: All bindings visible in plain text T-Lisp
3. **Plugin Development**: Examples for plugin authors
4. **Separation of Concerns**: Binding logic separate from editor core
5. **Hot Reloading**: Can reload bindings without restarting editor

### Trade-offs

1. **Startup Time**: Additional file I/O and T-Lisp evaluation
2. **Error Prone**: Syntax errors in .tlisp files break binding loading
3. **Circular Dependencies**: Binding files must be loaded in correct order
4. **Fallback Complexity**: Need TypeScript defaults for robustness

### Future Considerations

1. **User Overrides**: Support `~/.tmaxrc.d/bindings/*.tlisp` for user customizations
2. **Binding Profiles**: Switch between different binding schemes (vim, emacs, etc.)
3. **Validation**: Add binding syntax validation before loading
4. **Documentation**: Auto-generate binding reference from .tlisp files
5. **Lazy Loading**: Load bindings on-demand for rarely-used modes

### Testing

Manual testing confirmed:
- All default bindings load correctly from T-Lisp files
- Missing binding files fall back to TypeScript defaults
- Syntax errors in binding files show clear error messages
- Key bindings work in all modes (normal, insert, visual, command, M-x)
