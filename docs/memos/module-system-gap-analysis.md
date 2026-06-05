# Gap Analysis: Guile/Racket-Style Module System for T-Lisp

**Date:** 2026-06-05
**RFC:** RFC-005
**Scope:** Implementation surface for `defmodule`, `require-module`, qualified names, module registry, and editor integration

---

## Current State

T-Lisp evaluates all code into one flat global environment:

```
Tokenizer → Parser → Evaluator → globalEnv (single Map<string, TLispValue>)
```

- 98 unique top-level definitions across 30 T-Lisp files
- `provide`/`require` tracks feature names but provides no symbol isolation
- `load` evaluates file contents directly into `globalEnv`
- Plugins load into the same environment — no boundary between plugin namespaces
- `M-x`, `apropos-command`, `describe-function` iterate `globalEnv.bindings`

---

## Gap Inventory

### Gap 1: Module Registry

**What exists:** `Set<string>` of loaded feature names in `load-ops.ts` (line 47). `featurep` checks membership. No concept of module identity beyond a feature string.

**What's needed:** A `ModuleRegistry` that maps module names to:

- Module environment (`TLispEnvironment`)
- Export set (`Set<string>`)
- Source file path
- Loading state (not-loaded / loading / loaded / failed)
- Module metadata (for `describe-module`, `M-x` integration)

**What to build:**

```typescript
interface ModuleRegistry {
  modules: Map<string, ModuleRecord>;
  register(name: string, env: TLispEnvironment, exports: Set<string>): void;
  resolve(name: string): ModuleRecord | undefined;
  isLoaded(name: string): boolean;
}

interface ModuleRecord {
  name: string;
  env: TLispEnvironment;
  exports: Set<string>;
  sourcePath: string;
  state: "loading" | "loaded" | "failed";
}
```

**Files to create:** `src/tlisp/module-registry.ts`

**Files to modify:** `src/tlisp/interpreter.ts` (add registry field), `src/editor/api/load-ops.ts` (wire registry into `require`)

---

### Gap 2: `defmodule` Evaluation

**What exists:** `evaluator.ts` handles `defun`, `defvar`, `defmacro`, `set!`, `let`, `progn`, `provide`, `require`, `load` as special forms. All define into the passed `env` parameter.

**What's needed:** A new `evalDefmodule` special form that:

1. Creates a fresh child environment (parent = builtins env, not globalEnv)
2. Evaluates the body forms in that child environment
3. Reads the `(export ...)` list
4. Registers the module in the ModuleRegistry
5. Returns the module name as a symbol

**Key constraint:** `defmodule`'s child environment must parent the *builtins* environment (std lib functions, editor primitives), not `globalEnv`. Otherwise modules would see all of `globalEnv`'s bindings — defeating isolation.

**Current eval dispatch** (`evaluator.ts`): The main `eval()` method switches on the first symbol. Adding `defmodule` means adding a case before or alongside the existing `defun`, `defvar` etc. cases.

**Files to modify:** `src/tlisp/evaluator.ts` (add `evalDefmodule` case)

---

### Gap 3: Module Environment Parenting

**What exists:** `TLispEnvironmentImpl` has a single `parent` pointer. `lookup()` walks the chain to root. `createChild()` creates a new env with `this` as parent.

**What's needed:** Module environments must parent the *builtins environment*, not the global environment. Currently there is one flat chain:

```
globalEnv → (builtins defined here) → child envs from let/defun
```

The target architecture is:

```
builtinsEnv (stdlib + editor primitives)
  ├── module "editor/motions" env
  ├── module "editor/operators" env
  ├── module "user" env (= current globalEnv, for backward compat)
  ...
```

**What to change:** `createEvaluatorWithBuiltins()` (called in `interpreter.ts` constructor) currently returns one env. It should return a `builtinsEnv` (with all builtins) and a separate `globalEnv` (= user module, initially empty, parent = builtinsEnv). Existing code that reads/writes `globalEnv` continues to work — it's just the `user` module now.

**Files to modify:** `src/tlisp/interpreter.ts` (split builtins from global), `src/tlisp/stdlib.ts` (register into builtins env), `src/editor/tlisp-api.ts` (register editor primitives into builtins env)

---

### Gap 4: Qualified Name Resolution (`module/name`)

**What exists:** `evalSymbol()` in `evaluator.ts` (line ~179) does `env.lookup(name)` on the plain symbol string. No concept of qualified names.

**What's needed:** When the evaluator encounters a symbol containing `/` (e.g., `motions/paragraph-next`):

1. Split on the first `/` → `["motions", "paragraph-next"]`
2. Resolve `"motions"` as a module alias (from current scope's import table)
3. Look up `"paragraph-next"` in that module's export set
4. If found, return the value from that module's environment

**Tokenizer check:** `/` is already a valid symbol character (`isSymbolChar` in `tokenizer.ts` line 266). No tokenizer changes needed. Symbols like `motions/paragraph-next` are already tokenized as a single symbol.

**Where to change:** `evalSymbol()` in `evaluator.ts`. Before the standard `env.lookup(name)` call, check if the name contains `/` and attempt qualified resolution.

**Files to modify:** `src/tlisp/evaluator.ts` (update `evalSymbol`)

---

### Gap 5: Import Table per Scope

**What exists:** Environments store only `bindings` and `parent`. No import metadata.

**What's needed:** Each environment that evaluates a `require-module` form needs an import table mapping aliases to module names:

```typescript
interface ModuleImport {
  moduleName: string;     // e.g., "editor/motions"
  alias: string;          // e.g., "motions" or custom "mot"
  importedSymbols?: Set<string>;  // if :import was used
}
```

**Options for storage:**

- **A. Extend TLispEnvironment** — add `moduleImports?: Map<string, ModuleImport>` field. Simple but couples module logic into the base environment type.
- **B. Side table in ModuleRegistry** — `Map<env, Map<string, ModuleImport>>`. Keeps environments unchanged but requires tracking which env belongs to which module.
- **C. Store as special binding** — `(require-module foo :as f)` defines `__import:f` as metadata in the env. Hacky but avoids type changes.

**Recommendation:** Option A. The `TLispEnvironment` interface already has `parent`, `bindings`, `createChild`. Adding `moduleImports` is a small, targeted extension. The `TLispEnvironmentImpl` class has ~30 lines; this adds ~5.

**Files to modify:** `src/tlisp/environment.ts` (add `moduleImports` field), `src/tlisp/types.ts` (update `TLispEnvironment` interface)

---

### Gap 6: `require-module` Builtin

**What exists:** `require` in `load-ops.ts` checks feature membership and calls `evalFile`. It evaluates into the current environment — no isolation.

**What's needed:** A new `require-module` special form that:

1. Checks if the named module is already in the registry → return if loaded
2. Resolves the module name to a file path (new resolution logic)
3. Reads and parses the file
4. Checks if the file has `defmodule` — if yes, evaluate it (module registry handles registration)
5. If no `defmodule`, evaluate into a new module environment anyway (implicit module)
6. Records the import in the current scope's import table based on the chosen style:
   - Default: `module-shortname/symbol` (e.g., `motions/paragraph-next`)
   - `:as alias`: `alias/symbol`
   - `:import [...]`: unqualified names in current env

**Module name → short alias extraction:** `editor/motions` → alias `motions`. Last segment of the `/`-separated path. Users override with `:as`.

**Resolution order** (new, replaces current `load-path` logic):

1. Module registry (already loaded?)
2. `core-path/src/tlisp/core/` — translate `editor/motions` to `commands/motions.tlisp` or `motions.tlisp`
3. `packages-path/~/.config/tmax/packages/` — translate `mekael/git-blame` to `mekael/git-blame/plugin.tlisp`
4. Fail with clear error

**Files to create:** `src/tlisp/module-loader.ts` (module resolution + loading logic)

**Files to modify:** `src/tlisp/evaluator.ts` (add `require-module` case), `src/editor/api/load-ops.ts` (extend or replace resolution logic)

---

### Gap 7: `export` Enforcement

**What exists:** Nothing. All definitions are visible to all code.

**What's needed:** When a module is loaded, only its exported symbols should be accessible to other modules. Internal helpers remain in the module's environment but are not returned by qualified lookup.

**Enforcement point:** The qualified name resolution in `evalSymbol()` (Gap 4) checks the module's export set before returning a value. If `paragraph-next` is exported but `vim-reset-prefix` is not, `motions/vim-reset-prefix` throws `Symbol not exported: vim-reset-prefix from module editor/motions`.

**No change needed for unqualified access** within the module itself — the module's own code calls `env.lookup()` normally and sees all its own bindings.

**Files to modify:** `src/tlisp/evaluator.ts` (export check in qualified resolution)

---

### Gap 8: Editor Integration Surfaces

Eight call sites currently iterate or inspect `globalEnv` directly. All need module awareness.

#### 8a. Command lookup (`editor.ts:616`)

```
const func = this.interpreter.globalEnv.lookup(functionName);
```

**Needed:** Also search loaded module exports. `M-x git-blame` should resolve to the `git-blame` export from `user/plugin/git-blame`. Options:

- Keep a flattened command registry (Map of command name → module/function) alongside modules
- Search all module exports on miss

**Recommendation:** Flattened command registry. `register-command` (already planned) maps a command name to a module + exported function. Faster than searching all modules.

#### 8b. Function listing / apropos (`editor.ts:686-693`)

```
for (const [name, value] of this.interpreter.globalEnv.bindings)
```

**Needed:** Iterate all loaded modules' exported bindings, not just `globalEnv`. Group results by module in output.

#### 8c. Variable listing (`editor.ts:713`)

Same pattern as 8b. Iterate module exports.

#### 8d. `functionp` builtin (`evaluator.ts:3111`)

Currently checks `env.lookup(name)`. Needs to also check module exports for qualified names.

#### 8e. `describe-function` (`editor.ts:603`)

Needs to show module origin: "paragraph-next — function from module editor/motions".

#### 8f. `apropos-command` (`editor.ts:697`)

Searches `globalEnv.bindings`. Needs to search across all module exports.

#### 8g. Stdlib function resolution (`stdlib.ts:53`)

```
const resolved = interpreter.globalEnv.lookup(value.value as string);
```

`funcall` and `apply` resolve symbols at runtime. These should also support qualified names.

#### 8h. `key-bind` evaluation

Key bindings contain quoted T-Lisp expressions as strings: `(key-bind "p" "(paragraph-next)" "normal")`. These are parsed and evaluated later. They evaluate in the module's environment — so if `paragraph-next` is imported, it resolves. No change needed for the mechanism, but the documentation should clarify that key-bind expressions resolve in the defining module's scope.

**Files to modify:** `src/editor/editor.ts` (8a-8c, 8e-8f), `src/tlisp/evaluator.ts` (8d), `src/tlisp/stdlib.ts` (8g)

---

### Gap 9: Core T-Lisp File Migration

**What exists:** 30 T-Lisp files with no `defmodule` wrapper. All evaluate into `globalEnv`. `loadCoreBindings()` loads them in a hardcoded order with no dependency declaration. `provide`/`require` exist as a feature-tracking system.

**What's needed:** Every core T-Lisp file gets wrapped in `defmodule` with explicit exports and `require-module` dependencies. `provide`/`require` are removed — replaced entirely by the module system. `defmodule` is the standard; there is no legacy path.

**What changes in each file:**

1. Add `defmodule` wrapper with module name and export list at the top
2. Replace `(require "feature")` with `(require-module editor/path)`
3. Replace `(provide "feature")` with the `(export ...)` list in `defmodule`
4. Remove `provide` and `require` builtins from the interpreter

**Concrete example — current vs. new:**

Current `src/tlisp/core/commands/save.tlisp`:
```lisp
(defun save-buffer (&optional filename)
  "Save current buffer to its associated file."
  (let ((path (or filename (buffer-filename))))
    ...))
(provide "save")
```

New:
```lisp
(defmodule editor/commands/save
  (export save-buffer))

(defun save-buffer (&optional filename)
  "Save current buffer to its associated file."
  (let ((path (or filename (buffer-filename))))
    ...))
```

Current `src/tlisp/core/commands/operators.tlisp` (calls motions):
```lisp
;; relies on motions being loaded before this file
(defun vim-operator-apply (operator start end)
  (vim-move-to-position ...))
(provide "operators")
```

New:
```lisp
(defmodule editor/commands/operators
  (export vim-delete-line-range vim-change-line-range
          vim-operator-apply vim-dispatch-operator-key)
  (require-module editor/commands/motions
    :import [vim-move-to-position vim-match-bracket]))

(defun vim-operator-apply (operator start end)
  (vim-move-to-position ...))
```

**Files that get `defmodule` wrappers (30 files):**

Binding files:
- `src/tlisp/core/bindings/normal.tlisp` → `(defmodule editor/bindings/normal ...)`
- `src/tlisp/core/bindings/insert.tlisp` → `(defmodule editor/bindings/insert ...)`
- `src/tlisp/core/bindings/visual.tlisp` → `(defmodule editor/bindings/visual ...)`
- `src/tlisp/core/bindings/command.tlisp` → `(defmodule editor/bindings/command ...)`

Command files:
- `src/tlisp/core/commands/save.tlisp` → `(defmodule editor/commands/save ...)`
- `src/tlisp/core/commands/find-file.tlisp` → `(defmodule editor/commands/find-file ...)`
- `src/tlisp/core/commands/isearch.tlisp` → `(defmodule editor/commands/isearch ...)`
- `src/tlisp/core/commands/replace.tlisp` → `(defmodule editor/commands/replace ...)`
- `src/tlisp/core/commands/indent.tlisp` → `(defmodule editor/commands/indent ...)`
- `src/tlisp/core/commands/dired.tlisp` → `(defmodule editor/commands/dired ...)`
- `src/tlisp/core/commands/windows.tlisp` → `(defmodule editor/commands/windows ...)`
- `src/tlisp/core/commands/tabs.tlisp` → `(defmodule editor/commands/tabs ...)`
- `src/tlisp/core/commands/edit-commands.tlisp` → `(defmodule editor/commands/edit-commands ...)`
- `src/tlisp/core/commands/motions.tlisp` → `(defmodule editor/commands/motions ...)`
- `src/tlisp/core/commands/operators.tlisp` → `(defmodule editor/commands/operators ...)`
- `src/tlisp/core/commands/vim-dispatch.tlisp` → `(defmodule editor/commands/vim-dispatch ...)`
- `src/tlisp/core/commands/vim-counts.tlisp` → `(defmodule editor/commands/vim-counts ...)`
- `src/tlisp/core/commands/insert-entries.tlisp` → `(defmodule editor/commands/insert-entries ...)`

Completion files:
- `src/tlisp/core/completion/completion.tlisp` → `(defmodule editor/completion ...)`
- `src/tlisp/core/completion/orderless.tlisp` → `(defmodule editor/completion/orderless ...)`
- `src/tlisp/core/completion/marginalia.tlisp` → `(defmodule editor/completion/marginalia ...)`
- `src/tlisp/core/completion/vertico.tlisp` → `(defmodule editor/completion/vertico ...)`
- `src/tlisp/core/completion/minibuffer.tlisp` → `(defmodule editor/completion/minibuffer ...)`

Indent files:
- `src/tlisp/core/indent/typescript.tlisp` → `(defmodule editor/indent/typescript ...)`
- `src/tlisp/core/indent/lisp.tlisp` → `(defmodule editor/indent/lisp ...)`
- `src/tlisp/core/indent/python.tlisp` → `(defmodule editor/indent/python ...)`
- `src/tlisp/core/indent/generic.tlisp` → `(defmodule editor/indent/generic ...)`

Mode files:
- `src/tlisp/core/modes/fundamental.tlisp` → `(defmodule editor/modes/fundamental ...)`
- `src/tlisp/core/modes/typescript-mode.tlisp` → `(defmodule editor/modes/typescript ...)`
- `src/tlisp/core/modes/python-mode.tlisp` → `(defmodule editor/modes/python ...)`
- `src/tlisp/core/modes/lisp-mode.tlisp` → `(defmodule editor/modes/lisp ...)`
- `src/tlisp/core/modes/go-mode.tlisp` → `(defmodule editor/modes/go ...)`
- `src/tlisp/core/modes/line-numbers-mode.tlisp` → `(defmodule editor/modes/line-numbers ...)`
- `src/tlisp/core/modes/relative-line-numbers-mode.tlisp` → `(defmodule editor/modes/relative-line-numbers ...)`
- `src/tlisp/core/modes/auto-fill-mode.tlisp` → `(defmodule editor/modes/auto-fill ...)`

Top-level:
- `src/tlisp/core-bindings.tlisp` → `(defmodule editor/core-bindings ...)`

**What changes in `loadCoreBindings()`:**

Current: Hardcoded ordered list of 30 file paths, loaded sequentially.

New: Load only the four binding entry points. Each binding file declares its own `require-module` dependencies, which triggers transitive loading:

```typescript
private async loadCoreBindings(): Promise<void> {
  const entryPoints = [
    "src/tlisp/core/bindings/normal.tlisp",
    "src/tlisp/core/bindings/insert.tlisp",
    "src/tlisp/core/bindings/visual.tlisp",
    "src/tlisp/core/bindings/command.tlisp",
  ];
  for (const path of entryPoints) {
    await this.loadBindingsFromFile(path);
  }
}
```

The module loader handles dependency resolution. If `normal.tlisp` requires `editor/commands/motions`, the loader loads `motions.tlisp` first. No more manual ordering.

**What gets removed:**

- `provide` builtin — dead code
- `require` builtin — replaced by `require-module`
- `featurep` builtin — replaced by `module-loaded?`
- The `Set<string>` of loaded features in `load-ops.ts` — replaced by module registry
- The hardcoded 30-file load list in `editor.ts`

**Files to modify:**
- All 30 `.tlisp` files listed above (add `defmodule`, remove `provide`, replace `require`)
- `src/editor/editor.ts` (simplify `loadCoreBindings` to entry points only)
- `src/editor/api/load-ops.ts` (remove `provide`, `require`, `featurep`, feature set)
- `src/editor/tlisp-api.ts` (remove wiring for deleted builtins)

---

### Gap 10: Plugin Isolation

**What exists:** `loadPluginsFromDirectory()` (`editor.ts:1625`) reads each plugin's `plugin.tlisp` and calls `this.interpreter.execute(pluginContent)`. All plugins share `globalEnv`.

**What's needed:** Each plugin gets its own module environment:

1. Plugin `plugin.tlisp` is evaluated as `(defmodule user/plugin/{name} ...)`
2. If the file already has `defmodule`, use it
3. If not, wrap it implicitly — create a module named `user/plugin/{pluginName}`, evaluate into it, export everything defined at top level
4. Plugin can `(require-module ...)` to access editor APIs

This solves the current collision problem where every plugin defines `plugin-init`.

**Files to modify:** `src/editor/editor.ts` (`loadPluginsFromDirectory` method)

---

### Gap 11: Module-Aware Error Messages

**What exists:** Errors reference symbol names and file paths where available. No module context.

**What's needed:** Errors should include module context:

- `Undefined symbol: paragraph-next in module editor/operators (did you mean motions/paragraph-next?)`
- `Module editor/motions not found (searched: core-path, packages-path)`
- `Symbol vim-reset-prefix not exported from module editor/motions`

**Files to modify:** `src/tlisp/evaluator.ts` (error messages in `evalSymbol`, `evalDefmodule`)

---

### Gap 12: Module Introspection Builtins

**What exists:** `featurep` checks if a feature loaded. No module introspection.

**What's needed:**

| Builtin | Purpose |
|---|---|
| `(module-loaded? "editor/motions")` | Check if module is loaded |
| `(module-exports "editor/motions")` | List exported symbols |
| `(module-list)` | List all loaded modules |
| `(module-lookup "editor/motions" "paragraph-next")` | Debug escape hatch — get value without importing |
| `(describe-module "editor/motions")` | Show module info, exports, source path |
| `(current-module)` | Return the name of the current module |

**Files to create/modify:** `src/editor/api/module-ops.ts` (new file, pattern follows `load-ops.ts`), `src/editor/tlisp-api.ts` (wire into API)

---

## Implementation Sequence

Dependencies between gaps constrain the order:

```
Gap 3 (env parenting)
  → Gap 1 (module registry)
    → Gap 2 (defmodule eval)
      → Gap 5 (import table)
        → Gap 6 (require-module)
          → Gap 4 (qualified resolution)
            → Gap 7 (export enforcement)
              → Gap 8 (editor integration)
              → Gap 10 (plugin isolation)
              → Gap 12 (introspection builtins)
    → Gap 11 (error messages)
Gap 9 (core file migration) — depends on Phase 2
```

### Phase 1: Foundation (Gaps 1, 2, 3, 5)

- Split builtins from global env
- Create module registry
- Implement `defmodule` evaluator case
- Add import table to environment

**Verify:** Can define a module, see its exports in the registry, and have its internals invisible from outside.

### Phase 2: Resolution (Gaps 4, 6, 7)

- Implement `require-module`
- Implement qualified name resolution
- Add export enforcement

**Verify:** Module A can require Module B and call `b/func`. Private functions in B are inaccessible. `:import` and `:as` both work.

### Phase 3: Integration (Gaps 8, 10, 11, 12)

- Update editor.ts call sites for module-aware lookup
- Isolate plugins into module environments
- Improve error messages
- Add introspection builtins

**Verify:** `M-x` finds commands from modules. `describe-function` shows module origin. Plugins don't collide. `apropos` searches across modules.

### Phase 4: Core File Migration (Gap 9)

- Wrap all 30 core T-Lisp files in `defmodule` with explicit exports
- Replace all `require`/`provide` with `require-module`
- Remove `provide`, `require`, `featurep` builtins
- Simplify `loadCoreBindings()` to four entry points (bindings files only)
- Fix all tests

**Verify:** All tests pass. `loadCoreBindings` loads only entry points. Dependency graph is declared, not hardcoded.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Circular module dependencies | Medium | Medium | Registry tracks "loading" state; error on cycle detection |
| Performance regression on qualified lookup | Low | Low | Module registry is a Map lookup; export check is Set.has — both O(1) |
| `key-bind` string expressions break | Low | High | These evaluate in the defining module's env; imported names resolve correctly |
| Macro expansion across modules | Medium | High | Macros must expand in their defining module's env, not the caller's — needs careful handling in Phase 2 |
| Stdlib builtins that accept symbol names (funcall, apply) | Medium | Medium | Gap 8g: add qualified name support to symbol resolution in stdlib |
| Missing exports during core file migration | Medium | Medium | Each file's export list is derived from existing `defun`/`defvar`/`defmacro` top-level forms — mechanical to generate |

---

## Effort Estimate

| Phase | Gaps | Files Changed | New Files | Estimated Effort |
|---|---|---|---|---|
| Phase 1 | 1, 2, 3, 5 | 4 | 1 | Medium |
| Phase 2 | 4, 6, 7 | 2 | 1 | Medium |
| Phase 3 | 8, 10, 11, 12 | 3 | 1 | Medium-High |
| Phase 4 | 9 | 30 .tlisp + 2 TS | 0 | Medium (mechanical but high volume) |
| **Total** | | **~39 files** | **3 new files** | |

---

## What Does NOT Need to Change

- **Tokenizer** — `/` already valid in symbols (line 266)
- **Parser** — No new syntax forms; `defmodule` and `require-module` parse as normal S-expressions
- **Symbol representation** — Strings remain strings; no interning needed
- **Buffer/terminal/cursor code** — Purely a language-level change
- **Daemon/client architecture** — Module registry is per-interpreter instance; no cross-client concern
