# RFC-010: Loom — T-Lisp Package Manager

**Date:** 2026-06-08
**Status:** Proposed
**Author:** Mekael Turner

## Summary

Loom is a package manager for T-Lisp, modeled on Emacs' `package.el` + MELPA. Users browse, install, update, and remove T-Lisp packages from inside the editor (`M-x list-packages`) or from the CLI (`loom install`). The package manager is itself a T-Lisp package — TypeScript only provides filesystem and network primitives.

## Motivation

tmax has a module system (`defmodule`/`require-module`/`export`) and a plugin directory structure, but no discovery or distribution mechanism. Users must manually find, clone, and configure plugins. This limits the ecosystem to users who read source code.

A package manager solves:
- **Discovery**: Users find packages without knowing git URLs
- **Installation**: One command instead of manual clone + config
- **Updates**: Check and update all installed packages
- **Documentation**: Auto-generated API docs from exports and docstrings

## Design

### Name

**Loom** — weaving packages together. The registry is "the Loom." CLI command: `loom`.

### Interfaces

Loom has two interfaces to the same underlying T-Lisp functions:

**Primary — In-editor (Emacs model):**
- `M-x list-packages` — Opens a `*Packages*` buffer with all available and installed packages
- `M-x package-install RET name` — Fetches and installs a package
- `M-x package-delete RET name` — Removes an installed package
- `M-x package-refresh-contents` — Updates the package index
- `M-x package-reinstall RET name` — Reinstalls a package

**Secondary — CLI:**
- `loom install <name>` — Install from registry
- `loom install github.com/user/plugin` — Install from git URL
- `loom list` — List installed packages
- `loom update` — Update all installed packages
- `loom remove <name>` — Remove a package
- `loom search <query>` — Search available packages
- `loom publish` — Publish to registry (v2)

### Architecture

```
Loom T-Lisp Package (the package manager itself)
  ├── loom-core.tlisp       — package-install, package-delete, package-refresh
  ├── loom-ui.tlisp          — *Packages* buffer, keymaps, rendering
  ├── loom-recipes.tlisp     — recipe parsing, index management
  └── loom-use-package.tlisp — use-package macro for declarative config

TypeScript Primitives (provided by editor API)
  ├── network-fetch          — HTTP GET for registry index
  ├── git-clone              — Clone git repos
  └── filesystem ops         — read/write/delete in packages dir
```

The package manager is a T-Lisp package that ships with tmax (like `package.el` ships with Emacs). It calls TypeScript primitives for I/O, but all logic, UI, and state management are in T-Lisp.

### Package Format

A Loom package is a git repository containing:

```
my-plugin/
├── plugin.tlisp          ; entry point with defmodule + export
├── README.md              ; description
└── loom.toml              ; metadata (optional)
```

`loom.toml` (optional — metadata can be inferred from `defmodule`):
```toml
[name]
package = "user/my-plugin"
version = "0.1.0"
description = "A tmax plugin for X"
author = "User Name"
tmax-version = ">=0.2.0"
```

`plugin.tlisp` (required):
```lisp
(defmodule user/my-plugin
  (export my-feature my-other-feature)
  (require-module std/strings)

  (defun my-feature ()
    "Does something useful"
    ...))
```

### Package Index

The package index is a curated collection of recipes (git URL + metadata), stored as a JSON file:

```json
{
  "user/my-plugin": {
    "url": "https://github.com/user/tmax-plugin-name",
    "description": "A tmax plugin for X",
    "version": "0.1.0"
  }
}
```

**v1:** Index lives in the tmax repo at `packages/registry.json`. Updated via PR. Like MELPA's recipe format — community curates via pull request.

**v2:** Index served from `loom.tmux.mekaelturner.com`. `loom publish` adds packages automatically. Website renders docs.

### Installation Location

Packages install to `~/.config/tmax/packages/<author>/<package>/`. The `require-module` resolver already checks `TLISP_PATH` — adding the packages directory to the path makes installed packages available via the existing module system.

```lisp
;; After loom install user/my-plugin, this just works:
(require-module user/my-plugin)
```

### use-package Macro

A `use-package`-style macro for declarative configuration with lazy loading:

```lisp
(use-package user/org-mode
  :after fundamental
  :bind (("C-c o a" org-agenda)
         ("C-c o c" org-capture))
  :config
  (setq org-directory "~/org"))
```

This macro:
- Declares the package dependency
- Defers loading until needed (`:after` trigger)
- Binds keys only after the package loads
- Runs `:config` body after load

### Package Browser Buffer

`M-x list-packages` opens a `*Packages*` buffer:

```
  Package              Version  Description              Status
  user/org-mode        0.3.1    Org-mode for tmax        installed
  user/fancy-mode      0.1.0    Fancy UI enhancements    available
  user/projectile      0.2.0    Project navigation       available
  std/strings          1.0.0    String utilities          built-in
```

Key bindings in the buffer:
- `i` — mark for install
- `d` — mark for delete
- `U` — mark for upgrade
- `x` — execute marks
- `r` — refresh package list
- `RET` — show package details

## Implementation Phases

### Phase 1: Core Infrastructure
- TypeScript primitives: `network-fetch`, `git-clone` exposed to T-Lisp
- `loom-core.tlisp`: `package-install`, `package-delete`, `package-refresh-contents`
- Package index format and bundled `registry.json`
- `loom install` / `loom list` / `loom remove` CLI commands
- `require-module` integration with `~/.config/tmax/packages/` path

### Phase 2: In-Editor UX
- `loom-ui.tlisp`: `*Packages*` buffer with tabulated listing
- `M-x list-packages`, `M-x package-install`, `M-x package-refresh-contents`
- Package detail view with description, exports, and version

### Phase 3: use-package and Polish
- `loom-use-package.tlisp`: `use-package` macro with `:after`, `:bind`, `:config`
- `loom update` / `M-x package-update-all`
- Package dependency resolution
- Error handling for failed installs

### Phase 4: Registry (v2 — post-adoption)
- Hosted registry at `loom.tmux.mekaelturner.com`
- `loom publish` command
- `loom search` / `M-x package-search`
- Website `/packages/[name]` auto-generated docs

## Alternatives Considered

### npm-based distribution
Rejected. tmax is closed-source (binary distribution via Bun `--compile`). npm packages are raw JavaScript, exposing source code. T-Lisp packages are a different ecosystem from npm.

### Raw git clone without a package manager
Current state. Works but provides no discovery, no version tracking, no update mechanism, and no standard metadata. Not scalable for an ecosystem.

### Separate package manager per frontend
Rejected. T-Lisp is the extension language regardless of which frontend (TUI, Ink, Steep) is active. One package manager for all frontends.

## Open Questions

- Should packages support semantic versioning constraints in dependencies?
- Should the v1 index be a JSON file or a directory of recipe files (like MELPA)?
- How to handle package name conflicts (multiple authors with same package name)?
- Should `use-package` support `:ensure t` to auto-install missing packages?

## References

- PRD Phase 4.1a: Loom — T-Lisp Package Manager
- RFC-005: T-Lisp Module System (`defmodule`, `require-module`, `export`)
- Emacs `package.el`: The primary design reference
- MELPA: Community package archive model
- JSR: Auto-generated docs from code metadata
