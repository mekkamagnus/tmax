# CWD-Independent Source Paths

## Status

Accepted

## Context

The editor loaded T-Lisp core bindings and resolved modules using hardcoded relative paths like `"src/tlisp/core/bindings/normal.tlisp"` and `coreRoot: "src/tlisp/core"`. These paths resolved relative to the process's current working directory (CWD).

When the daemon was started from any directory other than the tmax project root (e.g., from a tmux session whose CWD was a different project), all four binding files failed to load. The editor fell back to minimal bindings that lacked vim commands. The status line showed "Unbound key in normal mode" for most keys, and vim editing was completely broken.

The `bin/tmax` launcher worked around this by doing `cd "$PROJECT_DIR"` before starting the daemon, but this didn't cover `tmax --daemon` run from the global `tmax` binary (which delegates to `src/main.tsx`), manual `bun src/server/server.ts` invocations, or tmux sessions in other project directories.

## Decision

Resolve all source paths relative to `import.meta.dir` instead of CWD. Three locations in `src/editor/editor.ts` were changed:

1. **`loadPaths`** — Changed from `['src/tlisp/core']` to `[`${import.meta.dir}/../tlisp/core`]`
2. **`createModuleLoader({ coreRoot })`** — Changed from `"src/tlisp/core"` to `` `${import.meta.dir}/../tlisp/core` ``
3. **`loadCoreBindings()`** — Binding file paths now use `` `${import.meta.dir}/../tlisp/core/bindings` `` as the base directory

Additionally, the `loadBindingsFromFile()` fallback removed the `path.startsWith("src/tlisp/core/")` guard — since paths are now absolute, the `Bun.file()` fallback always applies when `readFile` fails.

## Consequences

- The daemon loads bindings and resolves modules correctly regardless of which directory it was started from.
- `import.meta.dir` is a Bun/ESM primitive that always resolves to the directory containing the source file, making it immune to CWD changes.
- No launcher changes needed — the fix is in the source code itself.
