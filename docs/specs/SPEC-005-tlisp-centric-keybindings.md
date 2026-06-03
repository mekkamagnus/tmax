# Spec: T-Lisp Centric Key Binding System

## High Level Objectives

**T-Lisp Keymaps:**
As a tmax developer, I want key bindings to be fully managed by T-Lisp, so that I can provide a more extensible and configurable editor experience.

**Core T-Lisp Bindings:**
As a tmax user, I want default key bindings defined in T-Lisp files, so that I can easily understand and customize the editor's behavior.

## Low-level Objectives

- **T-Lisp Keymaps:**
  - Implement a `hash-map` or `association-list` data type in T-Lisp
  - Define variables in T-Lisp to hold the keymaps for each mode (e.g., `*normal-mode-keymap*`)
- **Core T-Lisp Bindings File:** *(Detailed in `tlisp-core-bindings-migration.md`)*
  - Create a `core-bindings.tlisp` file to contain the default key bindings
  - This file will populate the T-Lisp keymap variables
  - Remove `initializeDefaultKeyMappings()` from `editor.ts` and load the T-Lisp file at startup
- **TypeScript Key Handling Refactor:**
  - Remove the TypeScript `keyMappings` Map from `editor.ts`
  - Update `handleKey()` to query the T-Lisp environment for commands in T-Lisp keymaps
  - The TypeScript engine becomes a "dumb" executor for commands returned by the T-Lisp environment
- **T-Lisp Key-Bind Function:**
  - Remove the built-in `(key-bind)` function from `editor.ts`
  - Implement `(key-bind)` as a regular function in T-Lisp that modifies the T-Lisp keymap variables
- **Testing:**
  - Add unit tests for the new T-Lisp data structures
  - Add integration tests for key binding lookup and execution
  - Add tests for the T-Lisp `(key-bind)` function

## 1. Overview

This specification outlines the complete refactoring of tmax's key binding system from a TypeScript-centric approach to a T-Lisp-centric approach. This change will move all key binding logic into T-Lisp, making the system more extensible and allowing users to fully customize their editor experience through T-Lisp scripting.

**Implementation Note**: This specification covers the complete T-Lisp key binding system refactor. The immediate next step (Phase 1) is detailed in `tlisp-core-bindings-migration.md`, which should be implemented first before proceeding with the broader refactoring outlined in this document.

## 2. Core Concepts

### 2.1 User Experience

- **T-Lisp Configuration:** Users will define and modify key bindings through T-Lisp scripts, providing full programmatic control
- **Mode-Specific Keymaps:** Each editor mode (normal, insert, visual, command, mx) will have its own keymap stored as T-Lisp variables
- **Runtime Binding:** Users can modify key bindings during runtime using the T-Lisp `(key-bind)` function

### 2.2 Backend Logic

- **T-Lisp Data Structures:** Hash-map or association-list data types will store key-to-command mappings
- **Environment Lookup:** TypeScript key handler will query T-Lisp environment for command resolution
- **Dynamic Modification:** Key bindings can be modified at runtime through T-Lisp function calls

## 3. Implementation Details

### 3.1 T-Lisp Engine (src/tlisp/)

- Add `hash-map` or `association-list` data type to T-Lisp standard library
- Implement functions for creating, accessing, and modifying these data structures
- Add keymap variables to the global T-Lisp environment (e.g., `*normal-mode-keymap*`)
- Create `core-bindings.tlisp` file with default key bindings for all modes

### 3.2 Editor System (src/editor/)

- Remove `keyMappings` Map from `editor.ts`
- Remove `initializeDefaultKeyMappings()` function from `editor.ts`
- Refactor `handleKey()` to query T-Lisp environment for command lookup
- Load `core-bindings.tlisp` file during editor initialization
- Remove built-in `(key-bind)` function from T-Lisp API

### 3.3 T-Lisp Standard Library (src/tlisp/stdlib.ts)

- Implement `(key-bind mode key command)` function in T-Lisp that modifies keymap variables
- Add helper functions for keymap manipulation (`get-binding`, `remove-binding`, `list-bindings`)
- Ensure proper error handling for invalid modes, keys, or commands

## 4. Testing Strategy

- **Unit Tests (test/unit/tlisp.test.ts):**
  - Test hash-map/association-list data structure operations
  - Test keymap variable creation and modification
  - Test T-Lisp `(key-bind)` function with various inputs
- **Integration Tests (test/unit/editor.test.ts):**
  - Test key binding lookup from T-Lisp environment
  - Test command execution flow from key press to T-Lisp command
  - Test loading of `core-bindings.tlisp` file at startup
- **End-to-End Tests (test/integration/):**
  - Test complete key binding workflow from user input to command execution
  - Test runtime key binding modification through T-Lisp REPL
  - Test keymap persistence across editor sessions

## 5. Benefits

- **Full Extensibility:** Users can completely customize key bindings through T-Lisp scripting
- **Consistency:** All editor behavior becomes configurable through the same T-Lisp interface
- **Simplicity:** TypeScript code becomes simpler by delegating key binding logic to T-Lisp
- **Dynamic Configuration:** Key bindings can be modified at runtime without restarting the editor

## 6. File Structure

```
.
├── src/
│   ├── tlisp/
│   │   ├── stdlib.ts           # Modified - Add hash-map/association-list types
│   │   └── core-bindings.tlisp # New - Default key bindings
│   └── editor/
│       ├── editor.ts           # Modified - Remove TypeScript key mapping logic
│       └── tlisp-api.ts        # Modified - Remove built-in key-bind function
├── specs/
│   └── tlisp-centric-keybindings.md # This document
└── test/
    ├── unit/
    │   ├── tlisp.test.ts       # Modified - Add keymap data structure tests
    │   └── editor.test.ts      # Modified - Add T-Lisp key binding tests
    └── integration/
        └── keybinding.test.ts  # New - End-to-end key binding tests
```

## 7. Affected Files

- **Modified Files:**
  - `src/tlisp/stdlib.ts`
  - `src/editor/editor.ts` *(Phase 1 detailed in `tlisp-core-bindings-migration.md`)*
  - `src/editor/tlisp-api.ts`
  - `test/unit/tlisp.test.ts`
  - `test/unit/editor.test.ts`
- **New Files:**
  - `src/tlisp/core-bindings.tlisp` *(Phase 1 detailed in `tlisp-core-bindings-migration.md`)*
  - `test/integration/keybinding.test.ts`

## 8. Implementation Phases

This comprehensive refactor should be implemented in phases:

**Phase 1**: Core Bindings Migration *(see `tlisp-core-bindings-migration.md`)*
- Create `src/tlisp/core-bindings.tlisp` file
- Remove `initializeDefaultKeyMappings()` from editor.ts  
- Add T-Lisp file loading mechanism

**Phase 2**: T-Lisp Data Structures
- Implement hash-map/association-list types in T-Lisp stdlib
- Create mode-specific keymap variables in T-Lisp environment

**Phase 3**: TypeScript Key Handling Refactor  
- Remove TypeScript `keyMappings` Map from editor.ts
- Update `handleKey()` to query T-Lisp environment

**Phase 4**: Pure T-Lisp Key-Bind Function
- Remove built-in `(key-bind)` function from TypeScript
- Implement `(key-bind)` in T-Lisp standard library