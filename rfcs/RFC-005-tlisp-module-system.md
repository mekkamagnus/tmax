# RFC-005: T-Lisp Module System and Package Registry

**Author:** Mekael Turner
**Date:** 2026-06-05
**Status:** DRAFT
**Depends on:** None (foundational)

## Abstract

T-Lisp needs a module system that prevents name collisions, defines explicit public APIs, and supports dependency declaration. This module system is the foundation for a centralized package registry (analogous to npm, JSR, or crates.io) where users can discover, install, and publish T-Lisp packages.

This RFC evaluates three established Lisp module/namespace designs — Guile/Racket, Clojure, and Common Lisp — against the specific requirements of a package registry ecosystem. It recommends one and specifies how it maps onto T-Lisp's existing architecture.

## Motivation

### Current State

T-Lisp evaluates all code into one flat global environment:

- **98 unique top-level definitions** across 30 T-Lisp source files
- `provide`/`require` tracks whether a feature loaded but provides no symbol isolation
- `load` evaluates files into the shared environment — no boundary between modules
- Every plugin is evaluated into the same environment, so any two plugins defining `plugin-init` will collide
- `M-x`, `describe-function`, and `apropos` inspect only global bindings

### Why Now

- Plugin loading already exists and already has a naming collision problem (every generated plugin defines `plugin-init`, `plugin-enable`, `plugin-disable`)
- Core libraries are growing (commands, modes, indent engines) with no API boundary
- A package registry requires packages to declare dependencies and public APIs — impossible without a module system
- Naming conventions alone do not scale to third-party packages

### Requirements for a Package Registry

A package registry for T-Lisp needs the module system to provide:

1. **Global uniqueness** — Package names must not collide across authors
2. **Explicit exports** — A package's public API must be declared, not implicit
3. **Dependency declaration** — Packages must state what they depend on
4. **Versioned resolution** — The registry must resolve compatible dependency versions
5. **Encapsulated internals** — Refactoring a package's private code must not break dependents
6. **Discoverable API** — `M-x`, `describe-function`, completion, and documentation must know what's public
7. **REPL-friendly** — Interactive exploration must work naturally
8. **Incremental adoption** — Existing code must continue working during migration

---

## Option A: Guile/Racket-Style Explicit Modules

### Model

Each file declares a module with an explicit export list. Definitions are private by default. Dependencies are declared with controlled import styles (qualified, aliased, or selective).

**Guile:**
```scheme
(define-module (editor motions)
  #:export (paragraph-next paragraph-previous)
  #:use-module (editor vim-counts))
```

**Racket:**
```racket
#lang racket
(provide paragraph-next paragraph-previous)
(require editor/vim-counts)
```

### T-Lisp Adaptation

```lisp
(defmodule editor/motions
  (export paragraph-next paragraph-previous
          vim-match-bracket)
  (require-module editor/vim-counts))

;; Private — invisible outside this module
(defvar vim-pending-prefix nil)

(defun vim-reset-prefix () ...)      ;; private

(defun paragraph-next () ...)        ;; public (exported)
```

Three import styles:

```lisp
(require-module editor/motions)                              ;; qualified: motions/paragraph-next
(require-module editor/motions :as mot)                       ;; aliased: mot/paragraph-next
(require-module editor/motions :import [paragraph-next])      ;; unqualified: paragraph-next
```

### Implementation in T-Lisp

| Aspect | Mapping |
|---|---|
| Module identity | String name (`editor/motions`) |
| Module environment | New child of builtins environment (not global) |
| Export list | Set of symbol names stored on the module |
| Qualified access | `module/func` — split on `/`, lookup in module's exports |
| `require-module` | Loads if needed, makes exports available under chosen style |
| No `defmodule` | Evaluates into `user` module — full backward compat |

**Implementation cost:** Moderate. Reuses existing `Environment` parent-chain mechanism. No tokenizer changes (`/` already valid in symbols). Requires: module registry, `defmodule` evaluator case, `require-module` builtin, qualified-name resolution.

### Package Registry Fit

| Requirement | Assessment |
|---|---|
| Global uniqueness | Module namespaced by author/package: `@mekael/git-blame` or `mekael/git-blame` |
| Explicit exports | Built into the model — `(export ...)` is required |
| Dependency declaration | `require-module` is the dependency edge; trivial to extract for resolution |
| Versioned resolution | Module name can carry version constraint: `(require-module "mekael/git-blame@^1.2")` |
| Encapsulated internals | Private by default — the core value proposition |
| Discoverable API | Export list is the public API surface; `M-x` and `describe-function` use it directly |
| REPL-friendly | Qualified names work at REPL; `:import` for convenience; `user` module as scratchpad |
| Incremental adoption | Files without `defmodule` evaluate into `user` — zero migration cost |

**Registry manifest example:**
```json
{
  "name": "mekael/git-blame",
  "version": "1.3.0",
  "exports": ["git-blame", "git-blame-line", "git-blame-mode"],
  "dependencies": {
    "tmax/editor-core": "^0.2.0",
    "tmax/completion": "^1.0.0"
  },
  "module": "plugin.tlisp"
}
```

The `exports` field is extracted from the `defmodule` form — not manually maintained. The registry validates that the manifest matches the code.

### Strengths

- **Enforced privacy** — Cannot accidentally depend on internals
- **Explicit API** — Export list doubles as package surface documentation
- **Clean dependency graph** — `require-module` edges are auditable
- **Maps directly onto existing Environment class** — no new abstraction layer
- **Registry-friendly** — Package boundaries are the same as module boundaries

### Weaknesses

- **More verbose** than Clojure for REPL exploration of internals
- **Export list maintenance** — Adding a public function requires updating the export list (this is the point, but it is overhead)
- **No dynamic re-binding** — Cannot swap a module's implementation at runtime for testing/mocking (could be added later if needed)

---

## Option B: Clojure-Style Namespaces

### Model

A namespace is a dynamic mapping from symbols to Vars. All definitions in a namespace are accessible from outside — there is no enforcement of privacy. `defn-` is a naming convention, not a language guarantee. `require` and `use` pull names into scope.

```clojure
(ns editor.motions
  (:require [editor.vim-counts :as counts]))

(defn- vim-reset-prefix [] ...)     ;; "private" by convention only

(defn paragraph-next []             ;; public — everything is public
  (counts/vim-count-consume))
```

```clojure
;; Consumer
(require '[editor.motions :as mot])
(mot/paragraph-next)                ;; works
(mot/vim-reset-prefix)              ;; also works — no enforcement
```

### T-Lisp Adaptation

```lisp
(ns editor/motions
  (require editor/vim-counts :as counts))

;; Convention-only "private" — underscore prefix
(defun _vim-reset-prefix () ...)

(defun paragraph-next () ...)
```

### Package Registry Fit

| Requirement | Assessment |
|---|---|
| Global uniqueness | Namespace names can carry author prefix — same as any scheme |
| Explicit exports | **No enforcement.** All defs are accessible. `defn-` or `_` prefix is convention only. |
| Dependency declaration | `require` serves this purpose |
| Versioned resolution | Clojure uses Maven-style coordinates; similar approach possible |
| Encapsulated internals | **Weak.** Any package can reach into any other package's internals. |
| Discoverable API | Harder — no distinction between public API and implementation detail |
| REPL-friendly | **Strong.** Everything is accessible, everything is inspectable. |
| Incremental adoption | Natural — `ns` replaces current flat evaluation |

**Registry manifest example:**
```json
{
  "name": "mekael/git-blame",
  "version": "1.3.0",
  "dependencies": { ... },
  "module": "plugin.tlisp"
}
```

No `exports` field — because the language doesn't enforce one. The registry would need a separate convention or tool to define public API.

### Strengths

- **REPL-first** — Everything visible, everything malleable, excellent for interactive development
- **Proven at scale** — clojars.org has 20K+ packages; Clojure namespace model works for real ecosystems
- **Less boilerplate** — No export list to maintain
- **Dynamic** — Can rebind, redef, and swap implementations at runtime

### Weaknesses

- **No enforced privacy** — The single biggest problem for a registry. If `git-blame` has an internal helper `_parse-blame-output`, any other package can call it. When `_parse-blame-output` changes in v2, every package that reached into it breaks. This is exactly the problem npm had before `exports` in `package.json`, and that Rust avoids entirely with `pub`.
- **Implicit API surface** — Without an export list, `describe-function` and `M-x` cannot distinguish public API from implementation detail. The registry must rely on convention (naming, documentation) rather than enforcement.
- **Var objects required** — Clojure's `def` creates Vars (indirection boxes that can be rebound per-thread). T-Lisp symbols resolve to plain values. Implementing Clojure namespaces properly requires adding a Var-like indirection layer, which is a significant runtime change.
- **Requires symbol interning changes** — Qualified names like `editor.motions/paragraph-next` require the evaluator to understand namespace-qualified symbols as a distinct resolution path, not just string lookup.

### Why This Doesn't Fit T-Lisp's Registry Goal

A package registry's core value proposition is: *install a package and it works; upgrade a package and your code doesn't break.* That requires packages to have a stable, explicit API boundary. Clojure's model assumes good faith and naming conventions. That works inside a company or a tight-knit community. It works less well for an open registry where you don't control the authors.

npm learned this lesson. `package.json` originally had no `exports` field — any file in a package was importable. Node added `exports` in v12 specifically because the lack of encapsulation was causing breakage at scale. Starting with the weaker model means repeating that migration.

---

## Option C: Common Lisp Package System

### Model

Packages are symbol tables. The reader resolves symbol identity at parse time — before evaluation. `foo:bar` means "symbol `bar` exported from package `foo`." `foo::bar` means "internal symbol `bar` in package `foo`." Symbols are interned objects with identity beyond their name.

```lisp
(defpackage :editor.motions
  (:use :cl :editor.vim-counts)
  (:export :paragraph-next :paragraph-previous :vim-match-bracket))

(in-package :editor.motions)

(defun vim-reset-prefix ...)        ;; internal — accessible via editor.motions::vim-reset-prefix

(defun paragraph-next ...)          ;; exported — accessible via editor.motions:paragraph-next
```

### T-Lisp Adaptation

Would require fundamental changes to how T-Lisp represents and resolves symbols.

### Package Registry Fit

| Requirement | Assessment |
|---|---|
| Global uniqueness | Package names provide this naturally |
| Explicit exports | `:export` list — strong |
| Dependency declaration | `:use` and `:import-from` — strong |
| Versioned resolution | Not part of the package system; would need a separate layer (Quicklisp does this externally) |
| Encapsulated internals | Strong — `::` escape hatch exists but is explicitly scoped |
| Discoverable API | Strong — exported symbols are the public API |
| REPL-friendly | Qualified names work; `in-package` switches context |
| Incremental adoption | **Weak.** Requires tokenizer and symbol representation changes before any file can adopt it. |

### Strengths

- **Mature and battle-tested** — 35+ years of production use in Common Lisp
- **Reader-level isolation** — Symbol identity is resolved before evaluation; very robust
- **Fine-grained import control** — `:import-from`, `:shadow`, `:shadowing-import-from` give precise control
- **Explicit exports** — Comparable to Guile/Racket

### Weaknesses

- **Requires interning and symbol identity.** T-Lisp symbols are strings (`{ type: "symbol", value: "paragraph-next" }`). CL packages require symbols to be objects with a package slot. This means rewriting the tokenizer, the AST node representation, the evaluator's symbol comparison, and every TypeScript function that constructs or matches symbols. This is a foundational rewrite of the language runtime.
- **Reader-level complexity.** The package system is wired into the reader, not the evaluator. T-Lisp's tokenizer would need to maintain package context during parsing — it would need to understand `pkg:sym`, `pkg::sym`, `:keyword`, `#:uninterned`, and the current `*package*` variable. This is a significant increase in tokenizer complexity.
- **Symbol collision at intern time.** If two packages export the same symbol and a third uses both, it's a runtime error that requires explicit `:shadow` or `:shadowing-import-from`. This is more confusing than the qualified-name approach.
- **No versioning in the model.** CL packages are purely about naming. Quicklisp (the de facto CL package manager) handles versions through a separate system. The package system and the registry are disconnected by design.
- **Migration is all-or-nothing.** You cannot gradually adopt CL packages. The reader change affects every file, every eval, every REPL interaction from day one.

### Why This Doesn't Fit T-Lisp

The cost is disproportionate. T-Lisp's symbols-are-strings model is simpler and works well. Rewriting the runtime's symbol representation to gain a package system would touch:

- `tokenizer.ts` — package-aware symbol resolution
- `types.ts` — new symbol representation with package slot
- `evaluator.ts` — symbol comparison and lookup changes
- `environment.ts` — package-scoped lookup
- `interpreter.ts` — package context management
- Every `TLispSymbol` construction site across the codebase
- Every TypeScript comparison `sym.value === "foo"`

Guile-style modules achieve the same encapsulation and export control without touching any of these. The difference is purely in *when* resolution happens (evaluation time vs. read time) — and for an editor extension language, evaluation time is sufficient.

---

## Comparative Summary

| Criterion | Guile/Racket (A) | Clojure (B) | Common Lisp (C) |
|---|---|---|---|
| **Enforced privacy** | Yes — private by default | No — convention only | Yes — `:export` required |
| **Explicit API** | Yes — `(export ...)` | No — all accessible | Yes — `(:export ...)` |
| **Registry-ready exports** | Natural — export list = manifest | Needs extra tooling | Natural — export list = manifest |
| **Dependency edges** | `require-module` — explicit, extractable | `require` — explicit | `:use`/`:import-from` — explicit |
| **Qualified names** | `module/name` — no tokenizer change | `ns/name` — needs resolution | `pkg:name` — needs reader change |
| **Runtime changes needed** | Module registry + eval case | Var indirection layer | Symbol interning + reader rewrite |
| **Implementation effort** | Moderate (4-6 files) | Moderate-High (Var layer) | High (foundational rewrite) |
| **REPL ergonomics** | Good — qualified + selective import | Excellent — everything visible | Good — `in-package` + qualified |
| **Migration path** | Incremental — files adopt individually | Incremental — files adopt individually | All-or-nothing — reader change first |
| **Proven at registry scale** | Racket: pkg.racket-lang.org (~3K packages) | Clojure: clojars.org (~20K packages) | CL: Quicklisp (~2K libs) |
| **Stability for dependents** | Strong — can't reach internals | Weak — internals are reachable | Strong — `::` is scoped escape hatch |
| **Thread/runtime model fit** | Fits T-Lisp's single-env model | Requires per-thread Var bindings | Requires symbol identity across threads |

---

## Recommendation

**Option A: Guile/Racket-style explicit modules.**

### Rationale

For a package registry to work at scale, packages must have a hard boundary between public API and private implementation. This is the lesson from every successful registry:

- **npm** added `exports` in `package.json` after years of breakage from unencapsulated internals
- **Rust** requires `pub` on every exported item — the default is private
- **Go** uses capitalized names for export, lowercase for private
- **JSR** (Deno registry) validates exported types and documentation

Clojure's model (Option B) is the outlier — it works for clojars.org because Clojure culture values malleability over stability, and because most Clojure libraries are maintained by experienced teams who follow conventions. An open editor plugin registry needs stronger guarantees.

Common Lisp (Option C) provides the right semantics but at wrong cost. Rewriting T-Lisp's symbol representation to gain reader-level packages is a foundational change for a problem that evaluation-time modules solve adequately.

Guile/Racket (Option A) gives:

1. **Enforced privacy** — the single most important property for registry stability
2. **Explicit exports** — doubles as package manifest, `M-x` surface, and documentation source
3. **Clean dependency graph** — `require-module` edges are auditable and versionable
4. **Moderate implementation cost** — reuses existing `Environment` mechanism, no tokenizer changes
5. **Incremental migration** — files without `defmodule` continue working as-is

### The one thing to borrow from Clojure

Clojure's REPL experience is genuinely better because everything is inspectable. The Guile model should add a debug escape hatch:

```lisp
(module-lookup "editor/motions" "vim-reset-prefix")
;; → returns the function value for inspection, without putting it in scope
```

This preserves the REPL's diagnostic capability without weakening the encapsulation boundary.

### The one thing to borrow from Common Lisp

CL's `:import-from` gives fine-grained control over what enters scope. The recommended `:import [...]` syntax already captures this. If needed later, `:exclude` and `:rename` can be added without changing the model:

```lisp
(require-module editor/motions
  :import [paragraph-next]
  :rename [paragraph-next goto-next-paragraph])
```

---

## Proposed Package Registry Design ( sketches)

### Package Identity

Packages use a namespaced naming convention:

```
author/package-name
```

Examples: `mekael/git-blame`, `tmax/vim-motions`, `community/org-mode`

The `tmax/` prefix is reserved for first-party packages shipped with the editor.

### Package Manifest (`tpkg.json`)

```json
{
  "name": "mekael/git-blame",
  "version": "1.3.0",
  "description": "Inline git blame annotations for tmax",
  "author": "Mekael Turner",
  "license": "MIT",
  "tmax": "^0.2.0",
  "module": "plugin.tlisp",
  "exports": ["git-blame", "git-blame-line", "git-blame-mode"],
  "dependencies": {
    "tmax/completion": "^1.0.0"
  },
  "commands": {
    "git-blame": "Show git blame for current line",
    "git-blame-mode": "Toggle automatic blame annotations"
  }
}
```

- `exports` is validated against the `defmodule` export list — they must match
- `commands` are auto-registered for `M-x` discovery
- `tmax` is the editor version constraint (like `engines` in `package.json`)

### Registry Workflow

```bash
# Install a package
tmax pkg install mekael/git-blame

# Published to registry
tmax pkg publish

# Search
tmax pkg search "git"

# List installed
tmax pkg list
```

### Dependency Resolution

Semver-compatible. The registry resolves the dependency graph at install time. Circular dependencies are rejected. Version constraints use caret (`^`) and tilde (`~`) ranges, matching the npm convention.

### File Layout

```
~/.config/tmax/
├── init.tlisp                          # user config
├── packages/
│   ├── mekael/
│   │   └── git-blame/
│   │       ├── tpkg.json
│   │       └── plugin.tlisp
│   └── community/
│       └── org-mode/
│           ├── tpkg.json
│           └── plugin.tlisp
└── package-lock.json                   # resolved dependency tree
```

### Module Resolution Order

1. Check module registry (already loaded in this session?)
2. Check `core-path` (`src/tlisp/core/`) — first-party modules
3. Check `packages-path` (`~/.config/tmax/packages/`) — installed packages
4. Check `user-path` (`~/.config/tmax/`) — user modules
5. Fail with: `Module {name} not found`

---

## Open Questions

1. **Should the registry be centralized or distributed?** Centralized (like npm/crates.io) is simpler for discovery and security. Distributed (like Quicklisp) gives more control. Start centralized.

2. **Should packages be allowed to export macros?** Yes, but this requires module-aware macro expansion — macros must be evaluated in their defining module's environment, not the caller's. This is a follow-up design.

3. **Should `require-module` support version constraints inline?** E.g., `(require-module "mekael/git-blame@^1.2")`. Or should versioning be confined to `tpkg.json`? Confine to `tpkg.json` initially — module code shouldn't need to know about versions.

4. **How does hot-reload interact with modules?** `(module-reload "editor/motions")` should re-evaluate the file and update the module's environment. This needs a follow-up RFC.

5. **Should the `tmax/` prefix be enforced for first-party packages, or should they use unqualified names like `editor/motions`?** Recommend unqualified for first-party (they ship with the editor), namespaced for third-party.

---

## Next Steps

If this RFC is accepted:

1. Write SPEC for module system implementation (module registry, `defmodule`, `require-module`, qualified resolution)
2. Write SPEC for `tpkg.json` format and package layout
3. Write SPEC for registry client (`tmax pkg` commands)
4. Implement module system first — registry depends on it
5. Migrate existing core T-Lisp files to `defmodule` incrementally
6. Build registry client
7. Deploy registry infrastructure (API server, package storage)
