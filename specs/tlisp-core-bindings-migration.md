# Spec: T-Lisp Core Bindings Migration

## High Level Objectives

**T-Lisp Core Bindings File Creation:**
As a developer maintaining tmax, I want to extract hardcoded key bindings from TypeScript into a T-Lisp configuration file, so that I can achieve pure T-Lisp-centric key binding management and eliminate TypeScript coupling.

**Default Key Mappings Initialization Refactor:**
As a tmax maintainer, I want to replace the TypeScript `initializeDefaultKeyMappings()` function with T-Lisp file loading, so that I can achieve complete separation of editor logic (TypeScript) from configuration/bindings (T-Lisp).

## Low-level Objectives

- **T-Lisp Core Bindings File:**
  - Extract all `executeCommand()` calls from `initializeDefaultKeyMappings()` into pure T-Lisp syntax
  - Create `src/tlisp/core-bindings.tlisp` file with all default key bindings
  - Preserve exact same key binding behavior as current implementation
- **TypeScript Initialization Refactor:**
  - Replace `initializeDefaultKeyMappings()` call with T-Lisp file loading mechanism
  - Remove the entire `initializeDefaultKeyMappings()` method from `editor.ts`
  - Maintain error handling for missing or malformed core bindings file
- **Testing:**
  - Verify all existing key bindings work identically after migration
  - Test graceful fallback behavior when core-bindings.tlisp is missing or corrupted
  - Add integration tests for T-Lisp file loading during editor initialization

## 1. Overview

This specification covers the completion of the "Move Default Bindings to a Core T-Lisp File" task from the tmax refactoring roadmap. Currently, all key bindings are defined using T-Lisp commands but are hardcoded within the TypeScript `initializeDefaultKeyMappings()` function. This creates unnecessary coupling between the TypeScript core and key binding configuration.

The migration will extract these bindings into a dedicated T-Lisp file that gets loaded at editor startup, achieving true separation between the TypeScript runtime engine and T-Lisp configuration layer.

## 2. Core Concepts

### 2.1 User Experience

- **Transparent Migration:** Users will experience no change in editor behavior or key binding functionality
- **Configuration Clarity:** Advanced users will be able to easily locate and understand default key bindings in the dedicated T-Lisp file
- **Customization Path:** This lays groundwork for users to override default bindings through their own T-Lisp configuration files

### 2.2 Backend Logic

- **T-Lisp File Loading:** Editor will load and execute the core-bindings.tlisp file during initialization
- **Error Resilience:** Graceful fallback behavior if core bindings file is missing, corrupted, or contains syntax errors
- **Initialization Ordering:** Core bindings must load before user configuration files to allow proper override behavior

## 3. Implementation Details

### 3.1 T-Lisp File Creation (src/tlisp/core-bindings.tlisp)

- Extract all 15 `executeCommand()` calls from `initializeDefaultKeyMappings()` 
- Convert executeCommand strings to pure T-Lisp syntax without string escaping
- Organize bindings by functional groups: navigation, mode switching, application control, M-x system, editing commands
- Add T-Lisp comments documenting each binding group for maintainability
- Preserve exact same key-command mappings as current TypeScript implementation

### 3.2 TypeScript Integration (src/editor/editor.ts)

- Replace `this.initializeDefaultKeyMappings()` call in constructor with `this.loadCoreBindings()`
- Implement async `loadCoreBindings()` method that reads and executes core-bindings.tlisp file
- Add error handling for file not found, read errors, and T-Lisp syntax errors
- Remove entire `initializeDefaultKeyMappings()` method (lines 135-166)
- Update constructor to handle async core bindings loading
- Maintain existing initialization order: API setup, core bindings, user init file

### 3.3 File System Integration (src/core/filesystem.ts)

- Leverage existing `readFile()` method for loading core-bindings.tlisp
- Use relative path resolution from project root to locate core bindings file
- No modifications required to existing FileSystem interface

## 4. Testing Strategy

- **Unit Tests (test/unit/editor.test.ts):**
  - Test successful core bindings file loading during editor initialization
  - Test error handling when core-bindings.tlisp is missing
  - Test error handling when core-bindings.tlisp contains syntax errors
  - Verify `initializeDefaultKeyMappings()` method is completely removed

- **Integration Tests (test/integration/keybindings.test.ts):**
  - Test all 15 key bindings work identically before and after migration
  - Test h/j/k/l navigation bindings in normal mode  
  - Test i/Escape mode switching bindings
  - Test SPC ; M-x system activation
  - Test command mode entry and execution

- **T-Lisp File Tests (test/unit/core-bindings.test.ts):**
  - Test core-bindings.tlisp file can be parsed without syntax errors
  - Test all expected key-bind function calls are present in file
  - Test file contains proper T-Lisp comments and organization

## 5. Benefits

- **Pure T-Lisp Architecture:** Achieves true separation between TypeScript engine and T-Lisp configuration
- **Maintainability:** Default key bindings are now in a dedicated, readable T-Lisp file instead of buried in TypeScript code
- **Consistency:** All key binding configuration uses the same T-Lisp mechanism (default and user custom)
- **Foundation:** Creates foundation for advanced key binding features like keymap hierarchies and mode-specific overrides

## 6. File Structure

```
.
├── src/
│   ├── editor/
│   │   └── editor.ts           # Modified - Remove initializeDefaultKeyMappings(), add loadCoreBindings()
│   └── tlisp/
│       └── core-bindings.tlisp # New - Default key bindings in T-Lisp format
├── specs/
│   └── tlisp-core-bindings-migration.md # This document
└── test/
    ├── unit/
    │   ├── editor.test.ts       # Modified - Add core bindings loading tests
    │   └── core-bindings.test.ts # New - T-Lisp file validation tests
    └── integration/
        └── keybindings.test.ts  # Modified - Verify identical behavior post-migration
```

## 7. Affected Files

- **New Files:**
  - `src/tlisp/core-bindings.tlisp` - Default key bindings extracted from TypeScript
  - `test/unit/core-bindings.test.ts` - T-Lisp file validation tests

- **Modified Files:**
  - `src/editor/editor.ts` - Replace initializeDefaultKeyMappings() with loadCoreBindings()
  - `test/unit/editor.test.ts` - Add tests for core bindings file loading
  - `test/integration/keybindings.test.ts` - Verify post-migration behavior

## Implementation Workflow

### Phase 1: T-Lisp File Creation (2 hours)
1. **Extract Binding Commands** (30 min)
   - Copy all `executeCommand()` strings from `initializeDefaultKeyMappings()`
   - Remove TypeScript string escaping and convert to pure T-Lisp syntax
   - Organize into logical groups with T-Lisp comments

2. **Create core-bindings.tlisp** (30 min) 
   - Create new file in `src/tlisp/` directory
   - Add file header comment explaining purpose and maintainer guidance
   - Structure bindings in readable groups: navigation, modes, control, editing

3. **Syntax Validation** (1 hour)
   - Test file can be parsed by T-Lisp interpreter without errors
   - Verify all 15 expected key-bind function calls are present
   - Test file loading mechanism works with existing T-Lisp infrastructure

### Phase 2: TypeScript Integration (3 hours)
1. **Implement loadCoreBindings()** (1.5 hours)
   - Create async method to read core-bindings.tlisp file
   - Add comprehensive error handling for file system and parsing errors
   - Implement graceful fallback behavior for missing file scenarios

2. **Update Constructor** (1 hour)
   - Replace initializeDefaultKeyMappings() call with loadCoreBindings()
   - Handle async initialization properly within constructor context
   - Maintain proper initialization ordering with user init file loading

3. **Remove Legacy Code** (30 min)
   - Delete entire initializeDefaultKeyMappings() method
   - Remove any related helper functions that are no longer needed
   - Update any references or documentation

### Phase 3: Testing & Validation (2 hours)
1. **Create Test Suite** (1 hour)
   - Add unit tests for core bindings file loading success/failure scenarios
   - Create T-Lisp file validation tests
   - Update existing integration tests to verify identical behavior

2. **Manual Testing** (1 hour)
   - Test all key bindings work identically in both normal and insert modes
   - Test M-x system activation (SPC ;) and command mode entry (:)
   - Test error scenarios: missing file, corrupted file, syntax errors

## Acceptance Criteria

- [ ] `src/tlisp/core-bindings.tlisp` file created with all 15 default key bindings
- [ ] T-Lisp file contains proper comments and organization
- [ ] `initializeDefaultKeyMappings()` method completely removed from `editor.ts`
- [ ] `loadCoreBindings()` method successfully loads and executes T-Lisp file
- [ ] Error handling works for missing, unreadable, or malformed core bindings files
- [ ] All existing key bindings work identically after migration
- [ ] Comprehensive test coverage for new functionality
- [ ] No regression in editor initialization or key handling behavior

## Risk Assessment

**Low Risk Implementation:**
- Core functionality unchanged - only moving existing code between files
- T-Lisp infrastructure already mature and well-tested
- All changes are backward compatible from user perspective

**Potential Issues:**
- File path resolution differences between development and deployment
- T-Lisp syntax errors in conversion from TypeScript strings
- Async initialization timing issues in constructor

**Mitigation Strategies:**
- Thorough testing of file loading from different working directories
- Careful syntax validation of T-Lisp file before deployment
- Proper error handling and fallback to prevent editor startup failures