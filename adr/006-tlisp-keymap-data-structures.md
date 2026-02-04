# T-Lisp Keymap Data Structures

## Status

**accepted** (implemented 2026-02-04)

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

#### Core Components

**1. KeymapSync Bridge Layer** (`src/editor/keymap-sync.ts`)
- Bidirectional synchronization between T-Lisp keymaps and Editor's TypeScript key registry
- Methods:
  - `registerTlispKeymap(mode, keymap)` - Register T-Lisp keymap for a mode
  - `lookupKeyBinding(mode, key)` - Query T-Lisp keymap for a key during dispatch
  - `getActiveKeymap(mode)` - Get active keymap for a mode
  - `hasKeymap(mode)` - Check if mode has registered keymap

**2. T-Lisp API Operations** (`src/editor/api/keymap-ops.ts`)
- `keymap-set` - Register T-Lisp keymap with Editor for a mode
  - Input: mode (string), keymap (hashmap)
  - Registers keymap with KeymapSync for key dispatch
- `keymap-keys` - List all bindings in a keymap
  - Input: mode (string)
  - Output: list of key strings (e.g., ("j" "k" "l"))
- `keymap-active` - Get active keymap for a mode
  - Input: mode (string)
  - Output: keymap (hashmap) or nil

**3. T-Lisp Stdlib Functions** (`src/tlisp/stdlib.ts`)
- `defkeymap` - Create a new keymap with mode, parent, and bindings properties
- `keymap-get` - Get a property from a keymap (mode, parent, bindings)
- `keymap-define-key` - Define a key binding in a keymap (immutable operation)
- `keymap-lookup` - Lookup a command bound to a key in a keymap
- `setq` - Set a variable in the environment (for updating keymaps)

#### Data Structure Format

Keymaps are represented as hashmaps with three properties:
```lisp
(hashmap
  ("mode" . "normal")           ; Mode identifier
  ("parent" . nil)              ; Parent keymap (for inheritance)
  ("bindings" . (hashmap       ; Key-command bindings
    ("j" . "cursor-down")
    ("k" . "cursor-up")
    ("l" . "cursor-right")
    ("h" . "cursor-left"))))
```

#### Architecture

```
User defines keymap in .tmaxrc → T-Lisp → KeymapSync → Editor Key Registry → Works!
                                                    ↑
                                 User modifies keymap at runtime → KeymapSync → Immediate effect
```

**Key Dispatch Flow:**
1. User presses key
2. Editor's `handleKey()` checks KeymapSync for T-Lisp keymap
3. If T-Lisp keymap has binding → execute T-Lisp command
4. If no T-Lisp binding → fall back to TypeScript key registry

#### Integration Points

- **Editor Constructor**: Initializes KeymapSync instance
- **Editor.initializeAPI()**: Registers keymap-ops functions with T-Lisp interpreter
- **Editor.handleKey()**: Checks T-Lisp keymaps before TypeScript registry
- **Editor.loadInitFile()**: Loads and executes ~/.tmaxrc configuration
- **T-Lisp Interpreter**: Keymap-ops functions available in global environment

## Consequences

### Benefits

1. **Plugin Development**: Plugins can now define and modify key bindings
2. **Runtime Customization**: Users can customize bindings in .tmaxrc
3. **Debugging**: Can inspect key bindings programmatically
4. **Flexibility**: Full keymap control from T-Lisp layer
5. **No Breaking Changes**: T-Lisp keymaps checked first, TypeScript registry as fallback
6. **Performance**: <1ms overhead per key press for T-Lisp keymap lookup

### Trade-offs

1. **Dual Keymap System**: Both T-Lisp keymaps and TypeScript registry exist
2. **Precedence Rules**: T-Lisp keymaps take precedence, may confuse users
3. **Immutable Updates**: `keymap-define-key` returns new keymap (requires `setq`)

### Future Considerations

1. **Keymap Inheritance**: Support parent/child keymap relationships
2. **Keymap Validation**: Add validation for key binding conflicts
3. **Lazy Conversion**: Cache converted keymaps to reduce overhead
4. **Documentation**: Auto-generate keymap documentation from keymaps
5. **Keymap Merging**: Merge multiple keymaps for composability

## Testing

### Unit Tests

- `test/unit/keymap-sync.test.ts` (11 tests)
  - KeymapSync registration and lookup
  - T-Lisp keymap → Editor integration
  - Fallback to TypeScript bindings
  - Error handling

- `test/unit/keymap-ops.test.ts` (8 tests)
  - keymap-set registers keymap with Editor
  - keymap-keys returns binding list
  - keymap-active returns correct keymap
  - Error handling for invalid inputs

- `test/unit/keymap-data-structures.test.ts` (5 tests)
  - keymap-get returns nested alist structure
  - defkeymap creates new keymap
  - keymap-define-key adds binding
  - keymap-lookup returns command

### Integration Tests

- `test/integration/keymap-editor-integration.test.ts` (6 tests)
  - T-Lisp keymaps take precedence over TypeScript bindings
  - Fallback to TypeScript bindings when T-Lisp keymap has no binding
  - Key dispatch performance (<10ms)
  - Mode-specific keymaps
  - Error handling

- `test/integration/keymap-customization.test.ts` (9 tests)
  - .tmaxrc loading and execution
  - Custom bindings override defaults
  - Multiple keymaps for different modes
  - Runtime keymap modification via M-x
  - Keymap query functions

### UI Tests

- `test/ui/tests/04-keymap-customization.test.sh` (5 tests)
  - Custom keybinding in .tmaxrc works
  - Runtime keymap modification via M-x
  - Mode-specific keymaps
  - Keymap precedence and conflicts
  - Keymap query functions

### Test Coverage

- **Total Tests**: 44 tests across 6 test files
- **Pass Rate**: 100%
- **Coverage**: Unit, integration, and UI testing
- **Performance**: Key dispatch <1ms overhead

## Example Usage

### Define Custom Keymap in .tmaxrc

```lisp
;; ~/.tmaxrc configuration file

;; Create custom keymap
(defkeymap "*my-custom-keymap*")

;; Add bindings (immutable - requires setq)
(setq "*my-custom-keymap*" (keymap-define-key *my-custom-keymap* "j" "my-custom-down"))
(setq "*my-custom-keymap*" (keymap-define-key *my-custom-keymap* "k" "my-custom-up"))

;; Register keymap for normal mode
(keymap-set "normal" *my-custom-keymap*)
```

### Runtime Keymap Modification via M-x

```
SPC ;           ; Enter M-x mode
keymap-set     ; Call keymap-set function
"normal"        ; Specify mode
*test-map*      ; Specify keymap
```

### Query Keymaps

```lisp
;; Get active keymap for mode
(keymap-active "normal")  ; => *normal-keymap*

;; List all bindings in keymap
(keymap-keys "normal")    ; => ("j" "k" "l" "h")

;; Lookup specific binding
(keymap-lookup *my-keymap* "j")  ; => "my-custom-down"
```

## Implementation Notes

### Keymap Sync Architecture

The KeymapSync class serves as a bridge layer between T-Lisp keymap objects and the Editor's TypeScript key handling system:

- **Single Source of Truth**: T-Lisp keymaps are the authoritative source
- **On-Demand Lookup**: Editor queries KeymapSync during key dispatch
- **No State Synchronization**: No need to sync T-Lisp and TypeScript states
- **Graceful Degradation**: Errors in T-Lisp keymaps fall back to TypeScript bindings

### Performance Characteristics

- **Keymap Registration**: O(1) - simple Map.set()
- **Key Lookup**: O(log n) - hashmap lookup in T-Lisp value
- **Fallback Path**: O(1) - direct Map lookup in TypeScript registry
- **Overhead**: <1ms per key press for T-Lisp keymap lookup

### Error Handling

- **Malformed Keymaps**: Logged and skipped, fallback to TypeScript bindings
- **Missing Properties**: Gracefully handled with nil returns
- **Invalid Modes**: Validation errors returned to T-Lisp caller
- **Lookup Failures**: Return null instead of throwing exceptions

