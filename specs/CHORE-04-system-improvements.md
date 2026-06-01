# Chore: System Improvements — Test Fix, Logging, Keymap Migration, Editor Split, Save File

## Chore Description

A prioritized sequence of improvements to the tmax editor, covering test infrastructure repair, logging cleanup, the T-Lisp keymap architectural migration, editor.ts modularization, and the save-file feature. Each priority level depends on the one before it.

**P0 — Fix test harness:** 48 test failures across 2 files (`test-fixtures-system.test.ts`, `test-tlisp-testing-framework.test.ts`). Root cause: mock filesystem can't resolve `src/tlisp/core/bindings/*`, so `loadCoreBindings()` falls back to minimal bindings. T-Lisp testing framework also has internal bugs.

**P0.5 — `.tmaxrc` to `init.tlisp` cleanup (DONE):** All files updated to reference `~/.config/tmax/init.tlisp`. ADR/RFC files preserve historical context with "(previously `.tmaxrc`)" notes.

**P1 — Quiet the logging:** `FunctionLogger` emits ~34 lines of structured JSON per test. 1,278 tests produce 43,000 lines of output. Gate behind `DEBUG=tmax` env var.

**P2 — T-Lisp keymap migration (SPEC-005):** Move key storage from TypeScript `Map<string, KeyMapping[]>` to pure T-Lisp tagged alists. TypeScript becomes a thin executor; all key dispatch logic lives in T-Lisp.

**P3 — Split `editor.ts`:** 2,097 lines in one file. Split into ~5 focused modules by responsibility.

**P4 — Save-file feature (SPEC-032):** Fix broken `save-buffer` in daemon. Add `save-file` JSON-RPC method.

## Relevant Files

### Test infrastructure (P0)
- `test/mocks/filesystem.ts` — Mock filesystem; needs to resolve `src/tlisp/core/bindings/*` paths
- `test/unit/test-fixtures-system.test.ts` — 10 failing tests
- `test/unit/test-tlisp-testing-framework.test.ts` — 17 failing tests
- `src/tlisp/test-framework.ts` — T-Lisp testing framework; has internal bugs (cleanup `Undefined symbol: value`, assertion failures)
- `src/editor/editor.ts` — `loadCoreBindings()` at line 1320 uses relative paths; `loadBindingsFromFile()` at line 1305

### `.tmaxrc` cleanup (P0.5) — DONE
- `docs/README.md`, `specs/prd.md`, `prd.json`, `docs/ROADMAP.md`, `TEST_TMAX.md`
- `adr/007-core-bindings-in-tlisp-files.md`, `adr/006-tlisp-keymap-data-structures.md`, `adr/003-final-architecture-tlisp-first.md`, `adr/036-plugin-directory-structure.md`, `adr/039-macro-persistence.md`, `adr/052-plugin-repository.md`, `adr/056-init-file-refactoring.md`
- `rfcs/RFC-002-server-client-architecture.md`
- `specs/SPEC-003-core-editor.md`, `specs/SPEC-025-init-file-refactor.md`
- `SPEC-023-COMPLETION-SUMMARY.md`
- `TODO.org`
- `docs/manual/tmax.html`, `docs/manual/tmax.texi`
- `docs/contributing/CONTRIBUTING.md`
- `docs/examples/basic-config.tlisp`
- `test-binding-files.ts`

### Logging (P1)
- `src/utils/logger.ts` — `FunctionLogger` class; needs env var gating
- `src/main.tsx` — Logger initialization

### Keymap migration (P2)
- `src/editor/editor.ts` — `keyMappings` Map (delete), `initializeAPI()` T-Lisp builtins (refactor), `handleKey()` (replace with T-Lisp call)
- `src/editor/keymap-sync.ts` — Bridge between T-Lisp keymaps and TypeScript registry (delete after migration)
- `src/tlisp/core/bindings/normal.tlisp` — Will use new keymap format
- `src/tlisp/core/bindings/insert.tlisp` — Will use new keymap format
- `src/tlisp/core/bindings/visual.tlisp` — Will use new keymap format
- `src/tlisp/core/bindings/command.tlisp` — Will use new keymap format
- `src/tlisp/evaluator.ts` — May need changes for `:keymap` tagged alist handling
- `specs/SPEC-005-tlisp-centric-keybindings.md` — Target architecture spec

### Editor split (P3)
- `src/editor/editor.ts` — 2,097 lines; split target

#### New Files (P3)
- `src/editor/editor-api.ts` — T-Lisp builtin registration (~500 lines of `defineBuiltin` calls)
- `src/editor/editor-keys.ts` — Key dispatch, binding loading, prefix handling
- `src/editor/editor-modes.ts` — Mode state, transitions, mode-specific behavior
- `src/editor/editor-render.ts` — Screen rendering, status line, viewport management

### Save-file (P4)
- `src/server/server.ts` — Add `save-file` JSON-RPC method, fix broken `save-buffer` at line 462
- `src/editor/editor.ts` — `saveFile()` method at line 1894
- `src/server/serialize.ts` — Serialization helpers
- `bin/tmaxclient` — Needs `--save` and `--save-as` flags
- `specs/SPEC-032-save-file.md` — Feature spec

## Step by Step Tasks

### P0: Fix test harness

- Investigate `test/mocks/filesystem.ts` to understand how it resolves paths
- Make the mock filesystem serve real binding files from `src/tlisp/core/bindings/` — either by reading from disk at test setup time or by embedding the file contents
- Fix T-Lisp testing framework bugs in `src/tlisp/test-framework.ts`:
  - `Undefined symbol: value` in cleanup phase
  - Assertion failures in `test-failing-test` (`expected truthy value, got nil`)
  - `test-cleanup` failures
- Run the two failing test files individually to verify fixes:
  - `bun test test/unit/test-fixtures-system.test.ts`
  - `bun test test/unit/test-tlisp-testing-framework.test.ts`
- Run full suite to verify zero regressions

### P0.5: Replace all `.tmaxrc` references with `init.tlisp` (DONE)

- Searched all 24 files for `.tmaxrc`
- Replaced with correct reference: `~/.config/tmax/init.tlisp` for descriptive text, `init.tlisp` for short references
- Preserved historical context in ADR/RFC files (noted as "previously `.tmaxrc`" where appropriate)
- Verified no `.tmaxrc` references remain (except ADR/RFC historical notes): `rg '\.tmaxrc' --type md`

### P1: Gate logging behind DEBUG env var

- Read `src/utils/logger.ts` fully to understand `FunctionLogger` structure
- Add a check at the top of each logging method (`info`, `warn`, `debug`, `error`, `startOperation`, `completeOperation`): if `process.env.DEBUG` does not include `tmax`, return immediately
- Ensure the check happens once (module-level constant) rather than on every call
- Verify test output is clean: `bun test 2>&1 | wc -l` should be dramatically reduced
- Verify logging still works: `DEBUG=tmax bun test test/unit/tokenizer.test.ts` should show structured logs

### P2: T-Lisp keymap migration

- **Define keymap data structure:** Implement `:keymap` tagged alist support in T-Lisp. A keymap is `(:keymap (key . binding) ...)`. A binding is either a command string or a nested keymap (for prefix keys).
- **Create mode keymap variables:** Define `*normal-mode-keymap*`, `*insert-mode-keymap*`, `*visual-mode-keymap*`, `*command-keymap*`, `*mx-keymap*` as T-Lisp `defvar` variables initialized to empty `(:keymap)`.
- **Implement `(lookup-key keymap key)`:** Searches a keymap alist for a key. Returns the binding (command string), a nested keymap (prefix), or `nil` (unbound).
- **Rewrite `(key-bind key command mode)`:** Instead of writing to TypeScript Map, look up the mode's keymap variable and insert/update the `(key . command)` pair in the alist.
- **Implement `(handle-key key)`:** Single entry point for key dispatch. Maintains internal prefix state. Looks up key in `*current-keymap*`. Returns `:executed` (ran a command), `:prefix` (buffering for next key), or `:unbound`. Executes commands via `eval`.
- **Update binding files:** Change `src/tlisp/core/bindings/*.tlisp` to use new keymap format where beneficial. Prefix keys (like `g` for `gg`) should define nested keymaps.
- **Update TypeScript dispatch:** Replace `handleKey()` in editor.ts with a single call to `(handle-key normalizedKey)`. Process the return status: `:executed` -> re-render, `:prefix` -> show prefix indicator, `:unbound` -> beep/message.
- **Delete TypeScript key infrastructure:** Remove `keyMappings` Map, `KeyMapping` interface, `loadFallbackBindings()`, `initializeDefaultKeyMappings()`, and `KeymapSync` class.
- **Update `*current-keymap*` on mode change:** When mode transitions happen, T-Lisp sets `*current-keymap*` to the appropriate mode keymap variable.
- Add T-Lisp tests for keymap operations via `deftest`
- Add Bun integration tests for the new dispatch flow
- Run full test suite

### P3: Split editor.ts

- **Create `src/editor/editor-api.ts`:** Extract all `defineBuiltin` calls from `initializeAPI()` (~500 lines). Export a single `registerEditorAPI(editor)` function that takes the editor instance and registers all builtins.
- **Create `src/editor/editor-keys.ts`:** Extract key handling: `handleKey()`, `loadCoreBindings()`, `loadBindingsFromFile()`, `ensureCoreBindingsLoaded()`, prefix state management. After P2, this becomes a thin wrapper that calls `(handle-key key)`.
- **Create `src/editor/editor-modes.ts`:** Extract mode state: mode getter/setter, mode transitions, mode-specific behavior, `*current-keymap*` swapping.
- **Create `src/editor/editor-render.ts`:** Extract rendering: `render()`, status line rendering, viewport management, screen update logic.
- **Update `src/editor/editor.ts`:** Becomes a thin orchestrator importing from the four new modules. Constructor, `start()`, `stop()`, main loop.
- Run `bunx tsc --noEmit` to verify all types resolve
- Run full test suite

### P4: Save-file feature

- Follow `specs/SPEC-032-save-file.md` implementation plan
- Fix broken `save-buffer` in `src/server/server.ts` line 462: replace `this.editor.getState().currentBuffer.content` with `this.editor.saveFile()`
- Add `save-file` JSON-RPC method to `src/server/server.ts`
- Add `--save` and `--save-as` flags to `bin/tmaxclient`
- Run full test suite

## Validation Commands

- `bun test` — Full test suite must pass with 0 failures
- `bun test test/unit/test-fixtures-system.test.ts` — Previously failing file must pass
- `bun test test/unit/test-tlisp-testing-framework.test.ts` — Previously failing file must pass
- `rg '\.tmaxrc'` — Must return zero matches across all files (except ADR/RFC historical notes) — DONE
- `DEBUG=tmax bun test test/unit/tokenizer.test.ts 2>&1 | grep "LOG ENTRY"` — Must show structured logs (verify logging still works)
- `bun test 2>&1 | grep "LOG ENTRY" | wc -l` — Must be 0 (verify logging is silent by default)
- `bunx tsc --noEmit` — Zero type errors
- `rg "keyMappings|KeyMapping|loadFallbackBindings|KeymapSync" src/` — Must return zero matches after P2 (verify TypeScript key infra is deleted)

## Notes

- P2 is the architectural centerpiece and the riskiest change. P0 and P1 should be complete and validated before starting P2.
- The P3 editor split is most useful when done after P2, since P2 changes the key dispatch fundamentally. Splitting before P2 would mean splitting code that's about to be rewritten.
- All decisions from the grill session are documented in `CONTEXT.md` at the project root.
- The T-Lisp keymap design follows the Emacs principle: tagged keymaps (`:keymap`), procedural `key-bind`, prefix state in Lisp, `handle-key` as single dispatch entry point.
