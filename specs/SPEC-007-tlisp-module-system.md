# Feature: T-Lisp Module System (Guile/Racket-Style)

## Feature Description

A module system for T-Lisp that provides private-by-default definitions, explicit export lists, qualified name resolution, and dependency declaration. Following the Guile/Racket model (RFC-005, Option A), each file declares a module with `(defmodule name (export ...) ...)` and imports dependencies with `(require-module name [:as alias | :import [symbols]])`.

This is the foundational infrastructure for a future package registry (tpkg.json, `tmax pkg install`). It solves the immediate collision problem where plugins share one flat namespace, and the structural problem where 98 top-level definitions across 30 core files have no API boundaries.

## User Story

As a T-Lisp plugin author
I want my plugin's internals to be hidden from other plugins and its public API to be explicitly declared
So that I can refactor without breaking dependents and users can discover what my plugin provides

As a tmax user
I want `M-x` and `describe-function` to show which module a command comes from
So that I can understand and debug my editor configuration

## Problem Statement

All T-Lisp code evaluates into one flat `globalEnv`. There is no boundary between modules:
- Plugins collide on common names (`plugin-init`, `plugin-enable`)
- Core libraries have no declared public API — all 98 definitions are equally visible
- `M-x` and `apropos` cannot distinguish public commands from internal helpers
- `loadCoreBindings()` requires a hardcoded 30-file ordered list because dependencies are implicit
- A package registry is impossible without module boundaries

## Solution Statement

Implement Guile/Racket-style modules: private-by-default definitions with explicit `(export ...)` lists. Three import styles (qualified, aliased, selective) via `require-module`. Qualified name resolution using `module/name` syntax (no tokenizer changes — `/` is already a valid symbol character). A module registry maps names to environments + export sets. Module environments parent a `builtinsEnv` (stdlib + editor primitives), not the user `globalEnv`, ensuring isolation.

## Relevant Files

### Interpreter Core (module system implementation)

- `src/tlisp/interpreter.ts` — Entry point. Constructor calls `createEvaluatorWithBuiltins()` returning one env. Must split into `builtinsEnv` + `globalEnv`. Add `ModuleRegistry` field.
- `src/tlisp/evaluator.ts` — Core evaluator. `evalSymbol()` at line 179 does plain `env.lookup(name)` — needs qualified name resolution. `eval()` dispatch on first symbol — needs `defmodule` and `require-module` cases.
- `src/tlisp/environment.ts` — `TLispEnvironmentImpl` with `parent`, `bindings`, `lookup()`, `define()`. Needs `moduleImports` field for per-scope import tracking.
- `src/tlisp/types.ts` — `TLispEnvironment` interface. Needs `moduleImports?: Map<string, ModuleImport>` extension.
- `src/tlisp/stdlib.ts` — `registerStdlibFunctions()` uses `interpreter.globalEnv.lookup()`. `funcall` and `apply` need qualified name support.
- `src/tlisp/tokenizer.ts` — No changes needed. `isSymbolChar()` (line 266) already includes `/`.

### Editor Integration

- `src/editor/editor.ts` — `loadCoreBindings()` (line 1497): hardcoded 30-file list → 4 entry points. Eight call sites iterate `globalEnv.bindings` directly (command lookup, apropos, function listing). Plugin loading at `loadPluginsFromDirectory()` needs per-plugin module isolation.
- `src/editor/tlisp-api.ts` — Wires editor primitives into the T-Lisp environment. Needs rewiring for module ops and builtins env split.
- `src/editor/api/load-ops.ts` — `provide`, `require`, `featurep` builtins. These get removed; `load-path` resolution gets replaced by module resolution.
- `src/editor/api/mode-ops.ts` — May need module-aware command registration.

### T-Lisp Core Libraries (migration targets — Phase 4)

- `src/tlisp/core/bindings/normal.tlisp` — Key bindings for normal mode
- `src/tlisp/core/bindings/insert.tlisp` — Key bindings for insert mode
- `src/tlisp/core/bindings/visual.tlisp` — Key bindings for visual mode
- `src/tlisp/core/bindings/command.tlisp` — Key bindings for command mode
- `src/tlisp/core/commands/*.tlisp` — 12 command libraries (motions, operators, save, etc.)
- `src/tlisp/core/completion/*.tlisp` — 5 completion libraries
- `src/tlisp/core/indent/*.tlisp` — 4 indent rule libraries
- `src/tlisp/core/modes/*.tlisp` — 8 mode definitions
- `src/tlisp/core-bindings.tlisp` — Top-level entry point

### Reference Documents

- `rfcs/RFC-005-tlisp-module-system.md` — Options analysis, recommendation, package registry sketches
- `docs/memos/module-system-gap-analysis.md` — 12 implementation gaps with code references

### New Files

- `src/tlisp/module-registry.ts` — `ModuleRegistry` class: maps module names to `ModuleRecord` (env, exports, source path, loading state)
- `src/tlisp/module-loader.ts` — Module resolution + loading logic: name→file resolution, `require-module` evaluation, cycle detection
- `src/editor/api/module-ops.ts` — T-Lisp builtins for module introspection (`module-loaded?`, `module-exports`, `module-list`, `describe-module`, `current-module`, `module-lookup`)

## Implementation Plan

### Phase 1: Foundation (Gaps 1, 2, 3, 5)

Split the builtins environment from the global environment. Create the module registry. Add the `defmodule` evaluator case. Add import table to environments.

**Verify:** Can define a module in a test, see its exports in the registry, and verify internals are invisible from outside.

### Phase 2: Resolution (Gaps 4, 6, 7)

Implement `require-module` builtin with three import styles. Implement qualified name resolution in `evalSymbol()`. Add export enforcement — qualified lookups check the export set.

**Verify:** Module A requires Module B and calls `b/func`. Private functions in B are inaccessible. `:import` and `:as` both work.

### Phase 3: Integration (Gaps 8, 10, 11, 12)

Update editor.ts call sites for module-aware lookup. Isolate plugins into module environments. Improve error messages with module context. Add module introspection builtins.

**Verify:** `M-x` finds commands from modules. `describe-function` shows module origin. Plugins don't collide. `apropos` searches across modules.

### Phase 4: Core File Migration (Gap 9)

Wrap all 30 core T-Lisp files in `defmodule` with explicit exports. Replace all `require`/`provide` with `require-module`. Remove `provide`, `require`, `featurep` builtins. Simplify `loadCoreBindings()` to four entry points (bindings files only).

**Verify:** All existing tests pass. `loadCoreBindings` loads only entry points. Dependency graph is declared, not hardcoded.

## Step by Step Tasks

### Step 1: Split builtins from global environment (Gap 3)

- Modify `createEvaluatorWithBuiltins()` in `evaluator.ts` to return two environments: `builtinsEnv` (stdlib + test framework registered into it) and `globalEnv` (empty child of `builtinsEnv`, representing the `user` module)
- Update `TLispInterpreterImpl` constructor in `interpreter.ts` to store both `builtinsEnv` and `globalEnv`
- Ensure all existing tests pass — `globalEnv` still sees everything through parent chain

### Step 2: Create ModuleRegistry (Gap 1)

- Create `src/tlisp/module-registry.ts` with `ModuleRegistry` class
- Define `ModuleRecord` interface: `{ name, env, exports: Set<string>, sourcePath, state: "loading" | "loaded" | "failed" }`
- Add `registry` field to `TLispInterpreterImpl`
- Write unit tests: register, resolve, isLoaded, duplicate registration

### Step 3: Add import table to environments (Gap 5)

- Add `moduleImports?: Map<string, ModuleImport>` to `TLispEnvironment` interface in `types.ts`
- Define `ModuleImport` type: `{ moduleName: string, alias: string, importedSymbols?: Set<string> }`
- Add the field to `TLispEnvironmentImpl` in `environment.ts`
- Write unit tests for import table storage and retrieval

### Step 4: Implement `defmodule` evaluation (Gap 2)

- Add `evalDefmodule()` method to evaluator in `evaluator.ts`
- Parse `(defmodule name (export ...) (require-module ...) ...body)` form
- Create child environment (parent = builtinsEnv), evaluate body in it
- Read export list, register module in registry
- Add `"defmodule"` case in the main `eval()` dispatch
- Write unit tests: define module, verify exports, verify internals hidden

### Step 5: Implement `require-module` builtin (Gap 6)

- Create `src/tlisp/module-loader.ts` with module resolution logic
- Implement resolution order: registry → core-path → packages-path → user-path → fail
- Implement three import styles in `require-module`:
  - Default qualified: `(require-module editor/motions)` → `motions/paragraph-next`
  - Aliased: `(require-module editor/motions :as mot)` → `mot/paragraph-next`
  - Selective: `(require-module editor/motions :import [paragraph-next])` → `paragraph-next`
- Add cycle detection: if module state is `"loading"`, throw circular dependency error
- Wire `require-module` into evaluator dispatch
- Write unit tests for each import style, cycle detection, module not found

### Step 6: Implement qualified name resolution (Gap 4)

- Update `evalSymbol()` in `evaluator.ts` (line 179)
- Before standard `env.lookup(name)`, check if `name` contains `/`
- If yes: split on first `/`, resolve alias to module via current env's import table, look up symbol in module's export set
- Write unit tests: qualified access, alias resolution, unknown module, unexported symbol

### Step 7: Add export enforcement (Gap 7)

- In qualified resolution (Step 6), check the module's export set before returning the value
- Throw `Symbol not exported: {name} from module {module}` if not in export set
- Write unit tests: exported symbol accessible, private symbol blocked, error message quality

### Step 8: Update editor integration (Gap 8)

- **8a Command lookup** (editor.ts ~line 616): Add flattened command registry. When a module is loaded, its exported functions are registered in a command map. `M-x` lookup checks this map.
- **8b Function listing/apropos** (editor.ts ~line 686): Iterate all loaded module exports, not just `globalEnv.bindings`
- **8c Variable listing** (editor.ts ~line 713): Same pattern as 8b
- **8d `functionp` builtin** (evaluator.ts): Support qualified names
- **8e `describe-function`** (editor.ts ~line 603): Show module origin in output
- **8f `apropos-command`** (editor.ts ~line 697): Search across all module exports
- **8g Stdlib `funcall`/`apply`** (stdlib.ts ~line 53): Support qualified name resolution via the interpreter's module registry

### Step 9: Plugin isolation (Gap 10)

- Modify `loadPluginsFromDirectory()` in `editor.ts`
- Each plugin's `plugin.tlisp` is evaluated as `(defmodule user/plugin/{name} ...)`
- If file has `defmodule`, use it; if not, wrap implicitly (export all top-level definitions)
- Write integration test: two plugins defining `plugin-init` don't collide

### Step 10: Module-aware error messages (Gap 11)

- Update error messages in `evalSymbol()` to include module context
- Add suggestions: "did you mean `motions/paragraph-next`?"
- Add module-not-found messages listing searched paths
- Write unit tests for error message content

### Step 11: Module introspection builtins (Gap 12)

- Create `src/editor/api/module-ops.ts`
- Implement: `module-loaded?`, `module-exports`, `module-list`, `module-lookup`, `describe-module`, `current-module`
- Wire into `tlisp-api.ts`
- Write unit tests for each builtin

### Step 12: Migrate core T-Lisp files (Gap 9)

- For each of the 30 `.tlisp` files:
  1. Add `(defmodule editor/{path} (export ...))` wrapper
  2. Replace `(require "feature")` with `(require-module editor/...)`
  3. Remove `(provide "feature")`
  4. Derive export list from existing `defun`/`defvar`/`defmacro` top-level forms
- Remove `provide`, `require`, `featurep` from `load-ops.ts`
- Simplify `loadCoreBindings()` to load only 4 binding entry points — transitive `require-module` handles the rest
- Update `tlisp-api.ts` to remove wiring for deleted builtins

### Step 13: Run validation

- Run all validation commands listed below
- Fix any test failures or type errors
- Verify module system works end-to-end: load tmax, check `M-x` finds commands from modules, run `describe-function` showing module origin

## Testing Strategy

### Unit Tests

- **Module registry**: register, resolve, isLoaded, duplicate names, loading state transitions
- **`defmodule` evaluation**: module creation, export list registration, body evaluation in isolated env, private symbols invisible from outside
- **`require-module`**: three import styles (qualified, aliased, selective), already-loaded module shortcut, module-not-found error, circular dependency detection
- **Qualified name resolution**: `module/name` split and lookup, alias resolution from import table, unexported symbol rejection
- **Export enforcement**: only exported symbols accessible via qualified names, internal symbols blocked with clear error
- **Import table**: storage and retrieval of import metadata, multiple imports per environment, nested scope inheritance
- **Module introspection builtins**: each of the 6 builtins returns correct results
- **Environment split**: `builtinsEnv` contains stdlib functions, `globalEnv` inherits from it but starts empty

### Integration Tests

- **Two-module dependency**: Module A requires Module B, calls `b/func` successfully
- **Transitive dependency**: A → B → C chain works via `require-module`
- **Plugin collision**: Two plugins defining the same name load without collision, each in own module
- **Editor integration**: `M-x` finds commands across modules, `describe-function` shows module origin, `apropos` searches all exports
- **Core file loading**: `loadCoreBindings()` with 4 entry points loads all 30 files via transitive deps

### Edge Cases

- Circular module dependencies (A requires B requires A) → clear error
- Module that exports nothing → valid, but nothing is accessible externally
- `require-module` of already-loaded module → returns immediately, no re-evaluation
- Qualified name where alias doesn't exist in current scope → error with "did you require this module?"
- `key-bind` string expressions in module context → resolve in defining module's env
- Module name with multiple `/` segments (`editor/commands/motions`) → split on first `/` only for alias, full name for registry
- `defmodule` inside another `defmodule` → error (no nested modules)
- `require-module` inside a function body → lazily loads on first call

## Acceptance Criteria

1. **Module isolation works**: A module's private definitions are invisible to other modules via qualified lookup
2. **Three import styles work**: Default qualified (`motions/func`), aliased (`:as mot`), selective (`:import [...]`)
3. **Module registry tracks state**: `module-loaded?` returns correct boolean, `module-list` shows all loaded modules
4. **`M-x` is module-aware**: Commands from any loaded module are discoverable via `M-x`
5. **`describe-function` shows module origin**: Output includes "from module editor/motions"
6. **Plugins don't collide**: Two plugins defining `plugin-init` load without error
7. **All 30 core files migrated**: Every core `.tlisp` file has `defmodule` wrapper with explicit exports
8. **`loadCoreBindings` loads 4 files**: The hardcoded 30-file list is replaced by 4 entry points with transitive loading
9. **`provide`/`require`/`featurep` removed**: Dead code eliminated
10. **All existing tests pass**: Zero regressions
11. **Typecheck passes**: `bun run typecheck` reports zero errors
12. **Circular dependency detection**: Loading A→B→A throws clear error, not infinite loop

## Validation Commands

- `bun run typecheck` — Zero type errors across all source and test files
- `bun test test/unit/` — All unit tests pass (including new module system tests)
- `bun test test/integration/` — All integration tests pass (module loading, editor integration)
- `bun run build` — Build succeeds with module system changes
- `bun run start --help` — Application starts without errors after migration

Module-specific validation:
- `bun test test/unit/module-registry.test.ts` — Registry unit tests pass
- `bun test test/unit/module-loader.test.ts` — Loader unit tests pass
- `bun test test/unit/defmodule.test.ts` — defmodule evaluation tests pass
- `bun test test/unit/qualified-names.test.ts` — Qualified name resolution tests pass
- `bun test test/unit/module-introspection.test.ts` — Introspection builtin tests pass
- `bun test test/integration/module-system.test.ts` — End-to-end module system integration tests pass
- `bun test test/integration/plugin-isolation.test.ts` — Plugin collision prevention tests pass

## Notes

**Why Guile/Racket over Clojure and Common Lisp** (see RFC-005 for full analysis):
- Clojure has no enforced privacy (convention only), requiring a Var indirection layer
- Common Lisp requires symbol interning and reader-level changes — foundational rewrite disproportionate to the benefit
- Guile/Racket gives enforced privacy, explicit exports, and maps directly onto T-Lisp's existing Environment class

**Tokenizer is unchanged**: `/` is already a valid symbol character (`isSymbolChar` at `tokenizer.ts:266`), so `module/name` parses as a single symbol with no tokenizer changes.

**No backward compatibility needed**: T-Lisp is alpha. `provide`/`require`/`featurep` are removed entirely. `defmodule` is the standard from day one.

**Macro cross-module expansion**: Macros must expand in their defining module's environment, not the caller's. This requires careful handling in Phase 2 but doesn't change the module model — it's an evaluation-time concern in the macro expander.

**Package registry is future work**: This spec covers the module system only. `tpkg.json`, `tmax pkg install/publish/search`, and the registry API server are follow-up specs that depend on this foundation.

**Reference implementations consulted**:
- Racket: `(provide ...)` / `(require ...)` with `#lang` — confirmed export-first model
- Guile: `(define-module ... #:export ... #:use-module ...)` — confirmed private-by-default semantics
- Both use evaluation-time resolution (no reader changes needed), matching the approach here
