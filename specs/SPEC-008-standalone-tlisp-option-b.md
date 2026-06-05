# Feature: Standalone T-Lisp Runtime Profile and CLI

## Feature Description
Implement Option B from the standalone T-Lisp analysis: keep T-Lisp inside the current tmax repository, but add a standalone runtime profile, CLI, Clojure-like REPL, script runner, standalone module loader, I/O/system primitives, and Bun-compiled binary target.

This feature makes T-Lisp usable as a standalone language without extracting `src/tlisp/` into a separate package. Users get a `tlisp` command for interactive development and script execution. The editor keeps using the same interpreter, and future package-registry work can target pure `.tlisp` packages resolved by the standalone module loader.

This plan is based on:

- `docs/memos/standalone-tlisp-gap-analysis.md` — identifies the remaining gaps: CLI, I/O, REPL polish, standalone module loading, distribution, and stdlib asset strategy.
- `docs/memos/standalone-tlisp-options-analysis.md` — recommends Option B first, with package extraction deferred until embedding or npm distribution becomes necessary.
- `specs/SPEC-007-tlisp-module-system.md` — provides the module-system foundation that Option B should reuse rather than rebuild.
- `docs/memos/package-registry-options-analysis.md` — provides registry context for future `.tlisp` package distribution.

## User Story
As a T-Lisp user
I want to run `tlisp` as a standalone REPL and script runner
So that I can write, test, and share T-Lisp programs without launching the tmax editor.

As a tmax maintainer
I want standalone T-Lisp to use the same interpreter code as the editor
So that language improvements benefit both standalone scripts and editor customization without creating a fork.

As a future T-Lisp package author
I want standalone module loading to resolve bundled stdlib modules, local files, and `TLISP_PATH`
So that pure `.tlisp` packages can be developed before the runtime is extracted into a separate npm package.

## Problem Statement
T-Lisp is architecturally close to standalone: the parser, evaluator, environment, module registry, and value model do not depend on editor state. The editor API is injected through `defineBuiltin`, and the module system already has a loader hook.

The missing pieces are product and runtime concerns:

- No standalone `tlisp` binary or `bin/tlisp` launcher exists.
- The current REPL is a development tool in `src/tlisp/repl.ts`, not a full standalone profile.
- No standalone profile registers stdout/stdin/file/system primitives without editor state.
- No standalone module loader resolves bundled stdlib modules, local modules, and `TLISP_PATH`.
- No decision exists for loading `.tlisp` stdlib files inside a `bun build --compile` binary.
- `package.json` has `bin.tmax` only, no `tlisp` bin or `build:tlisp` script.
- Documentation presents T-Lisp REPL as a testing tool, not as a standalone language workflow.

## Solution Statement
Add a standalone runtime profile inside the existing repository. The profile creates a plain `TLispInterpreterImpl`, registers standalone I/O/system/stdlib helpers, installs a standalone module loader, and exposes that runtime through a new `src/tlisp/cli.ts` entry point.

The CLI supports:

- `tlisp` — interactive REPL
- `tlisp script.tlisp` — execute a file
- `tlisp -e '(+ 1 2)'` — evaluate one expression
- shebang scripts via `#!/usr/bin/env tlisp`
- Clojure-like REPL state: persistent environment, multiline forms, `*1`, `*2`, `*3`, and `*e`

Distribution uses Bun's built-in compilation:

```bash
bun build --compile ./src/tlisp/cli.ts --outfile dist/tlisp
```

Option A extraction is intentionally deferred. The breaking point for Option A is embedding demand, npm distribution, separate runtime semver, or import-boundary leakage.

## Relevant Files
Use these files to implement the feature:

- `README.md` — Update T-Lisp usage documentation from development-only REPL to standalone CLI/REPL/script workflows.
- `package.json` — Add `bin.tlisp`, `tlisp`, `build:tlisp`, and related scripts.
- `bin/tmax` — Existing shell launcher pattern for tmax; use as reference for `bin/tlisp`.
- `scripts/repl.ts` — Existing development REPL entry point; either keep as compatibility wrapper or route to the new CLI/REPL implementation.
- `scripts/build-binaries.ts` — Existing Bun compile orchestration for tmax; use as reference or extend for `tlisp` binary builds.
- `src/tlisp/interpreter.ts` — Existing interpreter wrapper with `execute()`, `defineBuiltin()`, `builtinsEnv`, `globalEnv`, and `setModuleLoader()`.
- `src/tlisp/evaluator.ts` — Existing evaluator and module-system implementation; do not fork it.
- `src/tlisp/repl.ts` — Existing REPL implementation; refactor or replace with standalone profile support, multiline input, and REPL bindings.
- `src/tlisp/stdlib.ts` — Existing generic stdlib registration; add missing string/type-conversion helpers here or in focused standalone stdlib modules.
- `src/tlisp/types.ts` — Existing interpreter/value types; use for profile and primitive implementations.
- `src/tlisp/values.ts` — Value constructors and `valueToString()` for REPL printing and primitive return values.
- `src/tlisp/mod.ts` — Public T-Lisp exports; update only if new standalone helpers should be exported from the internal module surface.
- `src/tlisp/module-registry.ts` — Existing module registry; use for standalone module resolution and tests.
- `docs/memos/standalone-tlisp-gap-analysis.md` — Source analysis for scope and gaps.
- `docs/memos/standalone-tlisp-options-analysis.md` — Option B recommendation and phased approach.
- `specs/SPEC-007-tlisp-module-system.md` — Related module system feature; standalone module loading should build on this foundation.
- `docs/memos/package-registry-options-analysis.md` — Related future registry direction; this feature should not block a pure `.tlisp` registry.

### New Files

- `bin/tlisp` — Executable launcher for the standalone T-Lisp CLI.
- `src/tlisp/cli.ts` — CLI entry point for REPL, script execution, one-shot eval, help, and exit codes.
- `src/tlisp/profiles/standalone.ts` — Registers standalone profile primitives and module loader.
- `src/tlisp/io-ops.ts` — Standalone stdout/stdin/filesystem primitives.
- `src/tlisp/sys-ops.ts` — Environment, process, time, shell, and exit primitives where appropriate.
- `src/tlisp/module-loader-standalone.ts` — Resolves bundled stdlib modules, current working directory, and `TLISP_PATH`.
- `src/tlisp/stdlib-assets.ts` — Embedded virtual stdlib source map for modules that must work inside a compiled binary.
- `src/tlisp/stdlib/*.tlisp` — Optional sidecar stdlib modules such as `lists.tlisp`, `strings.tlisp`, and `path.tlisp`.
- `test/unit/tlisp-standalone-profile.test.ts` — Unit tests for profile registration and standalone primitives.
- `test/unit/tlisp-standalone-module-loader.test.ts` — Unit tests for standalone module resolution.
- `test/integration/tlisp-cli.test.ts` — CLI integration tests for `-e`, script execution, errors, shebangs, and REPL smoke coverage.

## Implementation Plan
### Phase 1: Foundation
Create the standalone profile and CLI skeleton. Add launcher and package scripts. Reuse `TLispInterpreterImpl`, `defineBuiltin()`, and `setModuleLoader()` rather than creating a parallel evaluator.

### Phase 2: Core Implementation
Implement standalone I/O/system primitives, script execution, one-shot eval, REPL behavior, and standalone module loading. Add embedded stdlib asset handling so compiled binaries can load required `.tlisp` modules without relying on a checkout.

### Phase 3: Integration
Wire `bin/tlisp`, `package.json`, tests, README updates, and Bun binary builds. Keep editor behavior unchanged and ensure the standalone CLI never imports `src/editor/*`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Confirm Current Module and REPL Baseline

- Read `src/tlisp/interpreter.ts`, `src/tlisp/evaluator.ts`, `src/tlisp/repl.ts`, and `src/tlisp/stdlib.ts`.
- Confirm `TLispInterpreterImpl` exposes `execute()`, `defineBuiltin()`, and `setModuleLoader()`.
- Confirm `defmodule` and `require-module` already exist in `evaluator.ts`.
- Document any current REPL behavior that should be preserved: `help`, `env`, `clear`, `exit`, `quit`.

### Step 2: Create Standalone Profile

- Create `src/tlisp/profiles/standalone.ts`.
- Export `createStandaloneInterpreter()` and `registerStandaloneProfile(interpreter, options?)`.
- Use `new TLispInterpreterImpl()` as the runtime.
- Register I/O primitives, sys primitives, standalone doc/apropos helpers, and standalone module loader.
- Include an option to disable filesystem/process primitives for future sandboxed use.
- Do not import from `src/editor/*`.

### Step 3: Implement Standalone I/O Primitives

- Create `src/tlisp/io-ops.ts`.
- Implement `print`, `princ`, `read-line`, `read-file`, `write-file`, `file-exists?`, and `directory-files`.
- Keep default file operations synchronous for MVP, matching the options memo's recommendation.
- Return T-Lisp values with `createString`, `createBoolean`, `createList`, and `createNil`.
- Convert runtime exceptions into `Either.left` with useful `EvalError` messages.
- Add focused unit tests for arity, type errors, missing files, and success cases.

### Step 4: Implement Standalone System Primitives

- Create `src/tlisp/sys-ops.ts`.
- Implement `getenv`, `current-time`, `exit`, and a conservative `shell-command`.
- Make `shell-command` opt-in through the standalone profile options if security risk is a concern.
- Ensure `exit` can be tested without terminating the test process by allowing an injectable exit function.
- Add unit tests for environment lookup, time return shape, and injected exit behavior.

### Step 5: Add String and Type-Conversion MVP Helpers

- Add or register `string-join`, `string-trim`, `string-replace`, `number-to-string`, and `string-to-number`.
- Add compatibility aliases only where useful: `nilp`, `ceil`, `pow`.
- Prefer existing naming conventions from `stdlib.ts`.
- Add unit tests for success cases, wrong arity, wrong types, and edge cases such as empty strings and invalid numbers.

### Step 6: Implement Standalone Module Loader

- Create `src/tlisp/module-loader-standalone.ts`.
- Resolve modules in this order:
  1. already-loaded registry entries
  2. embedded stdlib map from `src/tlisp/stdlib-assets.ts`
  3. current working directory
  4. colon-separated `TLISP_PATH`
- Support module names such as `std/strings`, `local/tools`, and package-style names such as `mekael/strings`.
- Convert module names to file paths predictably, e.g. `std/strings` -> `std/strings.tlisp`.
- Reject path traversal attempts such as `../secret`.
- Add unit tests for embedded modules, CWD modules, `TLISP_PATH`, not-found errors, and traversal rejection.

### Step 7: Decide and Implement Stdlib Asset Strategy

- Implement embedded core stdlib modules in `src/tlisp/stdlib-assets.ts` for anything the compiled binary must always load.
- Optionally keep sidecar `.tlisp` stdlib files under `src/tlisp/stdlib/` for source checkout development.
- The standalone module loader should prefer embedded stdlib for `std/*` modules, then sidecar/user paths for extension.
- Document why this supports `bun build --compile` without requiring users to copy stdlib files manually.

### Step 8: Build CLI Entry Point

- Create `src/tlisp/cli.ts`.
- Parse args:
  - no args: start REPL
  - `-e` / `--eval`: evaluate one expression
  - script path: execute file
  - `--help`: usage
  - `--version`: package version
- Strip a shebang line from script files that start with `#!`.
- Use the standalone profile for every mode.
- Print results consistently with `valueToString()`.
- Return process exit code `0` on success and nonzero on parse/eval/runtime errors.

### Step 9: Upgrade REPL Behavior

- Refactor `src/tlisp/repl.ts` to use `TLispInterpreterImpl` plus `registerStandaloneProfile()`.
- Preserve persistent environment across inputs.
- Add multiline input by tracking balanced parentheses while respecting strings and comments.
- Add `*1`, `*2`, `*3` bindings for recent results.
- Add `*e` binding for the last error.
- Add `doc` and `apropos` helpers for standalone symbol lookup.
- Preserve special commands: `help`, `env`, `clear`, `exit`, `quit`.
- Add a smoke test that starts the REPL process, sends `(+ 1 2)`, then exits.

### Step 10: Add Launcher and Package Scripts

- Create `bin/tlisp` with a Bun shebang or shell wrapper that runs `src/tlisp/cli.ts`.
- Update `package.json`:
  - add `"tlisp": "bun src/tlisp/cli.ts"`
  - keep `"repl"` as compatibility or point it to the new CLI
  - add `"build:tlisp": "bun build --compile ./src/tlisp/cli.ts --outfile dist/tlisp"`
  - add `"tlisp": "./bin/tlisp"` under `bin`
- Ensure existing `bin.tmax` remains unchanged.

### Step 11: Integrate Binary Build Support

- Either add a focused `build:tlisp` script only, or extend `scripts/build-binaries.ts` to support a `tlisp` target.
- For MVP, prefer the focused script to reduce churn.
- Add cross-compile follow-up targets only after the local binary is proven.
- Validate the compiled binary can run `-e`, run a script, and load embedded stdlib modules.

### Step 12: Add Tests

- Add unit tests for standalone profile registration.
- Add unit tests for I/O/system primitives.
- Add unit tests for string/type-conversion helpers.
- Add unit tests for standalone module loader.
- Add CLI integration tests for:
  - `tlisp -e '(+ 1 2)'`
  - script execution
  - shebang script execution
  - parse error exit code
  - eval error exit code
  - module loading from embedded stdlib
  - module loading from a temp `TLISP_PATH`

### Step 13: Update Documentation

- Update `README.md` T-Lisp REPL section to show:
  - `bun run tlisp`
  - `bun run tlisp -- -e '(+ 1 2)'` if using npm script forwarding
  - `bin/tlisp script.tlisp`
  - compiled `dist/tlisp`
- Mention Clojure-like REPL behavior: persistent environment, multiline forms, `*1`, `*2`, `*3`, `*e`.
- Link or refer to `docs/memos/standalone-tlisp-gap-analysis.md` and `docs/memos/standalone-tlisp-options-analysis.md` as the architecture rationale.
- Mention that Option A package extraction is deferred until embedding or npm distribution is required.

### Step 14: Add Import-Boundary Guard

- Add a test or static check that standalone files do not import from `src/editor/*`.
- Suggested command: `rg -n 'from \"\\.\\./editor|from \"\\.\\./\\.\\./editor|src/editor' src/tlisp bin/tlisp`.
- Keep this lightweight unless the repo later adopts lint rules.

### Step 15: Run Validation Commands

- Run every command in the Validation Commands section.
- Fix all failures before marking the feature complete.
- Manually verify that editor commands still work through existing tmax flows.

## Testing Strategy
### Unit Tests
- Standalone profile registers expected primitives and does not register editor primitives such as `buffer-insert` or `cursor-move`.
- `print`/`princ` write to injected output streams.
- `read-file`, `write-file`, `file-exists?`, and `directory-files` handle success and failure paths.
- `getenv`, `current-time`, `exit`, and `shell-command` return predictable T-Lisp values with injectable process hooks.
- String/type-conversion helpers handle arity, type, and edge cases.
- Standalone module loader resolves embedded stdlib, CWD modules, `TLISP_PATH`, and rejects path traversal.
- REPL history bindings update `*1`, `*2`, `*3`, and `*e`.

### Integration Tests
- `bin/tlisp -e '(+ 1 2)'` prints `3` and exits `0`.
- `bin/tlisp script.tlisp` executes multiple top-level forms and returns the last result.
- `bin/tlisp shebang-script.tlisp` ignores the shebang and executes normally.
- A script can call `(print ...)`, `(read-file ...)`, and `(require-module std/strings)`.
- A temp package path in `TLISP_PATH` can be required from a script.
- The compiled `dist/tlisp` binary can run `-e` and a script without a Bun runtime.
- Existing editor startup and T-Lisp editor API tests continue to pass.

### Edge Cases
- Multiline REPL input with strings containing parentheses.
- Comments inside multiline forms.
- Empty script files.
- Script with only comments.
- Parse error in one-shot eval.
- Runtime error in script should stop execution and return nonzero exit.
- Missing script path.
- Missing module in `require-module`.
- `TLISP_PATH` with empty entries or nonexistent directories.
- `.tlisp` file path attempts using `..`.
- `shell-command` disabled by profile options.

## Acceptance Criteria
- [ ] `bin/tlisp` exists and launches the standalone T-Lisp CLI.
- [ ] `bun run tlisp` starts a standalone REPL.
- [ ] `bin/tlisp -e '(+ 1 2)'` prints `3` and exits `0`.
- [ ] `bin/tlisp script.tlisp` executes a T-Lisp script without launching the editor.
- [ ] Shebang scripts using `#!/usr/bin/env tlisp` execute correctly.
- [ ] REPL keeps definitions across inputs.
- [ ] REPL supports multiline forms.
- [ ] REPL provides `*1`, `*2`, `*3`, and `*e`.
- [ ] Standalone profile registers I/O and sys primitives without editor state.
- [ ] Standalone profile does not import or require `src/editor/*`.
- [ ] Standalone module loader supports embedded stdlib, CWD modules, and `TLISP_PATH`.
- [ ] Compiled `dist/tlisp` works for `-e` and script execution.
- [ ] `package.json` exposes `tlisp` and `build:tlisp`.
- [ ] README documents standalone T-Lisp usage.
- [ ] Existing editor behavior and tests are unchanged.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck` — Run TypeScript typecheck.
- `bun test` — Run all Bun tests.
- `bun run tlisp -- -e '(+ 1 2)'` — Validate one-shot standalone eval through package script.
- `bin/tlisp -e '(+ 1 2)'` — Validate launcher one-shot eval.
- `bash -lc 'tmp=$(mktemp /tmp/tlisp-script-XXXXXX.tlisp); printf "(defvar x 40)\\n(+ x 2)\\n" > "$tmp"; bin/tlisp "$tmp"'` — Validate script execution.
- `bash -lc 'tmp=$(mktemp /tmp/tlisp-shebang-XXXXXX.tlisp); printf "#!/usr/bin/env tlisp\\n(+ 2 3)\\n" > "$tmp"; chmod +x "$tmp"; bin/tlisp "$tmp"'` — Validate shebang stripping.
- `bash -lc '! bin/tlisp -e "(undefined-symbol)"'` — Validate eval errors return nonzero.
- `bash -lc 'rg -n "from \\"\\.\\./editor|from \\"\\.\\./\\.\\./editor|src/editor" src/tlisp bin/tlisp && exit 1 || exit 0'` — Validate standalone T-Lisp code has no editor imports.
- `bun run build:tlisp` — Compile standalone binary.
- `./dist/tlisp -e '(+ 1 2)'` — Validate compiled binary one-shot eval.
- `bash -lc 'bin/tmax --stop 2>/dev/null || true; bin/tmax --daemon >/tmp/tmax-spec008.log 2>&1 & trap "bin/tmax --stop 2>/dev/null || true" EXIT; for i in $(seq 1 100); do bin/tmaxclient --ping >/dev/null 2>&1 && break; sleep 0.1; done; bin/tmaxclient --ping >/dev/null; bin/tmaxclient --eval "(+ 1 2)"'` — Validate existing editor daemon evaluation still works.

## Notes
- No new external libraries are required. Use Bun, Node-compatible `readline`, and built-in filesystem/process APIs.
- Option B intentionally does not provide `npm install @tmax/tlisp`. That is Option A and should be triggered by embedding demand, separate semver needs, or import-boundary leakage.
- A JSR-like T-Lisp package registry can still start under Option B if packages are pure `.tlisp` modules consumed by the standalone `tlisp` binary.
- The first implementation should keep file/process primitives synchronous and simple. Async support can be added later if scripts need it.
