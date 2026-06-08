# Feature: Lisp-First Emacs-Style Mode and Editor Policy System

## Feature Description
Add an Emacs-style mode system to tmax and use it as the foundation for moving editor policy into T-Lisp. The goal is for tmax to become mainly a Lisp project in the same architectural sense as Emacs: TypeScript provides the runtime substrate and primitive capabilities, while T-Lisp owns modes, keymaps, editor commands, workflow policy, customization, and extension libraries.

This feature makes major modes and minor modes load, activate, compose, and render consistently across daemon, TUI, and direct editor workflows. It also establishes a clear ownership boundary so future feature work defaults to T-Lisp libraries instead of high-level TypeScript modules.

Major modes are file-type-specific and exactly one is active per buffer. Minor modes are feature-specific and any number can be active per buffer. Some minor modes may also provide a globalized wrapper that enables the mode across all existing buffers and future buffers, matching Emacs's distinction between buffer-local minor modes and global minor modes.

A minor mode provides:
- A stable mode name and optional description
- A lighter for status-line display
- Optional keymap entries that shadow major-mode and global bindings while active
- Activate and deactivate hooks
- Buffer-local active state by default
- Optional globalized activation for all buffers

The system integrates with the existing T-Lisp API, hook system, keymap infrastructure, mode files in `src/tlisp/core/modes/`, daemon observability, and renderer status lines. Users can toggle minor modes interactively through M-x, define custom modes in T-Lisp, enable modes from init files, and enable minor modes from major-mode hooks.

This spec also starts the broader migration from TypeScript-owned editor behavior to T-Lisp-owned editor behavior. After this work, the default direction should be: expose a small primitive in TypeScript only when T-Lisp cannot express the behavior yet, then implement the user-facing command or workflow in T-Lisp.

## User Story
As a tmax user and T-Lisp extension author
I want to define, register, load, and toggle composable minor modes on top of buffer-local major modes, with most editor behavior implemented in T-Lisp
So that tmax is customizable and extensible through its Lisp layer rather than requiring TypeScript changes for ordinary editor features.

## Additional User Stories

### Built-In Mode Loading
As a tmax user using daemon/client workflows
I want built-in major and minor mode files loaded before the daemon accepts eval or status requests
So that `tmaxclient` sees the same registered modes as the interactive editor.

### Truthful Load/Require Semantics
As a T-Lisp extension author
I want `(load)`, `(provide)`, `(featurep)`, and `(require)` to report only successfully evaluated features
So that missing or broken mode files cannot produce false-positive loaded state.

### Callable Mode Hooks
As a T-Lisp extension author
I want symbols, string function names, and lambda hooks to execute in direct editor and daemon eval paths
So that mode activation can customize buffers without TypeScript-specific wiring.

### Global Minor Modes
As a tmax user
I want global minor modes to apply to existing buffers and future buffers while preserving explicit buffer-local overrides
So that features such as line numbers behave predictably across a session.

### Mode Observability
As an AI harness and tmax user
I want daemon status, frames, render state, and full-state responses to expose major and minor mode metadata
So that tests and clients can verify mode behavior without scraping renderer text.

### Lisp Ownership Standard
As a tmax maintainer
I want the ownership map and SRS to define which editor behavior belongs in T-Lisp
So that future specs and harnesses keep tmax moving toward a Lisp-first editor rather than a TypeScript editor with Lisp configuration.

## Problem Statement
tmax has partial major-mode support, but the current behavior is not close enough to Emacs:

- Built-in mode files under `src/tlisp/core/modes/` are not reliably loaded before daemon/client eval workflows.
- Major-mode state is effectively global in `major-mode-ops.ts` instead of buffer-local.
- Major-mode auto-detection has an extension mismatch: mode files register extensions such as `".py"`, while auto-detect compares against `"py"`.
- The hook API currently stores string names only, and `createEditorAPI` wires hook execution to a no-op callback.
- There is no minor-mode registry, no buffer-local minor-mode state, no globalized minor-mode wrapper, and no minor-mode keymap precedence.
- Key dispatch is duplicated across mode handlers and reads `keyMappings` directly, which makes it hard to insert Emacs-style keymap precedence consistently.
- Status and daemon serialization do not expose active minor modes or reliable current major-mode state.
- Most editor behavior still lives in TypeScript modules rather than T-Lisp libraries. Patch-review measurement found runtime source at about 43,742 TypeScript/TSX lines versus 529 T-Lisp lines, which is the opposite of Emacs's C/Elisp shape.

Without these pieces, a minor-mode implementation would become a basic global toggle registry rather than an Emacs-style mode system.

Without a Lisp-ownership boundary, tmax will keep growing as a TypeScript editor with Lisp configuration rather than a Lisp editor with a TypeScript substrate.

### Patch Review Current State
A first implementation attempt exists, but it must be treated as incomplete. A rerun of this spec must repair or replace the partial patch before continuing:

- Built-in mode loading is not reliable. After daemon startup, `(major-mode-list)` returned only `["fundamental"]`; `(featurep "python-mode")` and `(featurep "line-numbers-mode")` were false; `(minor-mode-list-all)` only showed partially evaluated minor-mode registrations.
- Optional mode-file loading currently ignores failures in `editor.ts`, which hides broken generated functions, broken `(provide)` calls, and syntax/runtime errors in built-in mode files.
- `(require "python-mode")` produced a false-positive feature state: it marked the feature loaded without proving the file evaluated or that `(provide "python-mode")` ran.
- Existing `test/unit/major-mode.test.ts` regressed because `createMajorModeOps` now requires injected getter/setter callbacks and old tests still call the previous signature. Existing major-mode tests must either keep working through a compatibility path or be updated in the same patch.
- Callable hooks are accepted by the unit-level API but do not execute through the live editor/daemon T-Lisp path because `createHookOps` is not wired with a real `evalValue` callback. `hook-list` also serializes lambdas as `"[object Object]"`, which is not inspectable enough for debugging.
- Daemon status, frame sync, render-state sync, and full-state serialization do not yet include `currentMajorMode`, `activeMinorModes`, or `activeMinorModeLighters`.
- Global minor mode behavior mutates only existing buffers. Future buffers do not inherit active global modes, and there is no source/override tracking to preserve explicit local re-enable/disable semantics.
- Built-in `line-numbers-mode.tlisp` and `auto-fill-mode.tlisp` are stubs. They register/toggle names but do not change real editor configuration or restore previous buffer-local state.
- Large required deliverables are still absent, including `mode-loader.ts`, `auto-mode.ts`, `key-resolution.ts`, mode-specific unit tests, native T-Lisp mode tests, `test/ui/tests/13_modes.py`, and the Lisp-owned command libraries listed below.
- `docs/lisp-ownership-map.md` exists but currently overstates completion: it marks callable hooks and minor-mode registry work as done, references command-library files that are not present, and reports only an editor-API ratio instead of the runtime TypeScript/TSX-to-T-Lisp ratio.

### Remediation Status After Implementation

The rerun of this spec repaired the patch-review failures above:

- Built-in major and minor mode files load during shared editor initialization, and required mode-file load failures now fail startup instead of being ignored.
- `(load)`, `(provide)`, `(featurep)`, and `(require)` use real file evaluation and truthful feature state; missing features do not become loaded.
- Major-mode state is buffer-local, extension normalization works, and daemon status exposes the active major mode.
- Callable hooks run through the live editor/daemon interpreter path, and `hook-list` returns inspectable entries.
- Global minor modes apply to existing and future buffers while preserving explicit local disable/re-enable semantics.
- Built-in `line-numbers` and `auto-fill` minor modes change editor config state and restore previous values on deactivation.
- Generated built-in minor-mode commands distinguish no argument from explicit `nil` by using optional supplied-p parameters.
- Mode metadata is serialized through daemon status, frame state, full editor state, and ANSI/Ink status lines.
- `mode-loader.ts`, `auto-mode.ts`, `key-resolution.ts`, native T-Lisp mode tests, `test/ui/tests/13_modes.py`, and representative Lisp-owned command libraries exist and pass targeted validation.
- `docs/lisp-ownership-map.md` reports the runtime TypeScript/T-Lisp ratio and marks migration status as partial where broader policy movement remains.

Remaining follow-up work is limited to the broader, non-blocking migration goals: routing every editor handler and which-key path through the central key resolver, adding full command metadata registration for Lisp-owned commands, and continuing the larger TypeScript-policy-to-T-Lisp migration.

## Solution Statement
Implement a mode subsystem with explicit registries, buffer-local mode state, mode loading, real hook execution, central key resolution, and renderer/daemon serialization.

Also define and begin enforcing a Lisp-first ownership model:

- TypeScript owns primitives: interpreter/runtime, parser/evaluator, buffer data structures, terminal IO, daemon/client JSON-RPC, filesystem/process/LSP integration, serialization, rendering, and small primitive operations exposed to Lisp.
- T-Lisp owns editor policy: major modes, minor modes, keymaps, command definitions, modal command behavior, search/replace workflows, buffer/window/file commands, help/discovery, completion sources, dired workflows, plugin/package behavior, and user customization.
- Existing TypeScript editor APIs that contain high-level policy should be treated as migration candidates. During this feature, migrate the mode/keymap/hook slice and create a follow-up migration map for the remaining policy modules.

Major modes will:
- Be registered by mode files with `(major-mode-register NAME EXTENSIONS ...)`.
- Normalize extensions with or without a leading dot.
- Activate per buffer when a file is opened through auto-detection.
- Store the current major mode in buffer-local mode state.
- Run mode hooks after activation.
- Display in the status line as `[python]`, `[typescript]`, `[lisp]`, or `[fundamental]`.

Minor modes will:
- Be registered with a low-level API and a T-Lisp `define-minor-mode` helper.
- Be enabled or disabled per buffer with `(minor-mode-set NAME t/nil)`.
- Be toggled interactively with `(minor-mode-toggle NAME)` or the generated mode command, such as `(line-numbers-mode)`.
- Follow Emacs-style generated mode command argument semantics: no argument toggles interactively, `t` or a positive number enables, and `nil`, `0`, or a negative number disables.
- Optionally expose a globalized wrapper, such as `(global-line-numbers-mode)`, that applies to all buffers.
- Run activate/deactivate hooks through the real hook system.
- Contribute active keymaps to the central key resolver.
- Display lighters in the status line, for example `NORMAL [python] (Ln Fill)`.

### Mode Loading Model
Use an Emacs-inspired loading model adapted to the current tmax runtime.

1. **Shared editor startup loading**: Built-in mode files are loaded by the shared editor initialization path, not only by the daemon. Direct editor, daemon, TUI, and tests must see the same registered modes.
2. **Deterministic eager built-in loading**: As a first implementation, load built-in `.tlisp` files from `src/tlisp/core/modes/` during editor runtime initialization before user init files run. This is simpler than full Emacs autoloading and makes daemon `tmaxclient --eval` workflows reliable.
3. **Load path and require/provide groundwork**: Add minimal T-Lisp load-state APIs so mode files can mark loaded features and future on-demand loading can be added without redesign: `(load FILE)`, `(load-path-add DIR)`, `(load-path-list)`, `(provide FEATURE)`, `(featurep FEATURE)`, and `(require FEATURE &optional FILE)`.
4. **Auto-mode behavior**: When a file is opened, auto-detect the major mode from registered extensions and activate it for that buffer. This is the first tmax equivalent of Emacs `auto-mode-alist`.
5. **Init file integration**: User init files run after built-in modes load, so init code can call `(minor-mode-set "line-numbers" t)`, `(global-minor-mode-set "line-numbers" t)`, or add hooks for registered modes.

### Emacs Compatibility Boundaries
This spec intentionally implements the Emacs-shaped core, then documents the remaining differences so they are not accidental:

- Full autoload generation is not required in this feature, but `load`, `load-path`, `provide`, and `require` must be designed so autoload can be added later.
- `auto-mode-alist` is implemented as extension and optional regexp matching in this feature. Shebang matching, magic-mode content matching, file-local variables, and dir-local variables are deferred.
- Hook ordering must support append-style behavior now. Numeric hook depth, buffer-local hook variables, and permanent-local hook properties can be deferred, but the hook registry must not block them structurally.
- The key precedence model captures the practical Emacs rule that active minor-mode keymaps shadow major-mode and global bindings. Full Emacs precedence layers such as overriding maps, emulation maps, text-property maps, and terminal-local maps are deferred.
- `define-derived-mode` is out of scope, but major-mode state and hooks must be implemented in a way that can support derived modes later.

### T-Lisp Ownership Boundary
To keep tmax primarily a Lisp project, these areas should move to or remain in T-Lisp:

- Mode definitions: major modes, minor modes, mode hooks, indentation rules, syntax rules, and auto-mode registrations.
- Keymaps and binding policy: normal, insert, visual, command, M-x, major-mode, minor-mode, and global maps.
- Editing commands: delete, yank, change, paste, text objects, count-prefix command behavior, undo/redo command wrappers, and macro-facing command composition.
- Command mode and M-x command libraries: `:w`, `:e`, `:q`, command aliases, command parsing, command dispatch, and interactive command metadata.
- Search and replace workflows: incremental search, query replace, repeat search, no-match behavior, word-under-cursor search, and match navigation.
- Buffer, window, and file commands: buffer switching, buffer listing, find file, save buffer, revert buffer, split/select window, messages-buffer commands, and user-facing file workflows.
- Help and discovery: `describe-key`, `describe-function`, `apropos`, command docs, which-key metadata, and completion sources.
- Dired and directory workflows.
- Plugin/package/user customization layer.
- T-Lisp self-tests for Lisp-owned editor behavior.

These areas should stay in TypeScript:

- T-Lisp parser, evaluator, environment, values, and runtime performance work.
- Low-level buffer primitives and immutable buffer data structures.
- Terminal/raw input and renderer frontends.
- Daemon/client JSON-RPC, frame sync, and observability transport.
- Filesystem/process/LSP integration.
- Serialization and state normalization.
- Primitive operations exposed to Lisp, such as `buffer-insert`, `cursor-move`, `file-read`, `terminal-size`, and daemon-safe query primitives.

New features should default to T-Lisp unless they need a missing primitive. When a missing primitive is needed, add the primitive in TypeScript and implement the user-facing behavior in T-Lisp.

### Documentation Update Standard
This spec must follow the project-local `update-tmax-documentation` standard in `.claude/skills/update-tmax-documentation/SKILL.md`. Future specs that change user-facing editor behavior, T-Lisp APIs, key bindings, daemon/client behavior, or runtime architecture should follow the same standard.

Documentation updates are part of implementation, not follow-up cleanup:

1. Read the source of truth before editing docs:
   - `src/editor/tlisp-api.ts`
   - `src/editor/api/*.ts`
   - `src/tlisp/stdlib.ts`
   - `src/tlisp/evaluator.ts`
   - `src/tlisp/types.ts`
   - `src/editor/editor.ts`
   - `src/server/server.ts`
   - `src/client/tui-client.ts`
   - New T-Lisp libraries created by this spec under `src/tlisp/core/`
2. Update the documentation files that describe the changed behavior:
   - `docs/tmax/tmax.texinfo` - tmax editor manual
   - `docs/tmax/tlisp.texinfo` - T-Lisp language and API reference
   - `README.md` - project overview, only where the overview or examples change
   - `docs/srs.md` - product-level user stories and acceptance criteria for the final behavior standard
   - `docs/lisp-ownership-map.md` - Lisp-first ownership and migration status
3. Fix inaccuracies rather than rewriting manuals from scratch:
   - Missing API functions and wrong signatures
   - Outdated feature status
   - Runtime references that say Deno instead of Bun
   - Missing mode/keymap/hook/minor-mode/Lisp-ownership sections
   - Stale key binding, command, daemon/client, or T-Lisp examples
4. Recompile and validate generated documentation:
   - `cd docs/tmax && make validate`
   - `cd docs/tmax && make info`
5. Cross-check documented functions against implemented functions and report any remaining gaps.

## Relevant Files

### Existing Files to Modify
- `src/core/types.ts` - Add serializable mode state fields to `EditorState` and `Frame`: `currentMajorMode`, `activeMinorModes`, `activeMinorModeLighters`, and optional global minor-mode metadata.
- `src/editor/editor.ts` - Add shared runtime initialization for built-in mode loading, buffer-local mode-state tracking, current-buffer mode-state accessors, central key resolution entrypoints, status serialization, and init-file ordering.
- `src/editor/tlisp-api.ts` - Wire major-mode and minor-mode ops with real state callbacks and real eval callbacks. Stop using no-op callbacks for major-mode syntax, indent, and hooks.
- `src/editor/api/major-mode-ops.ts` - Convert current major mode from module-level global state to injected buffer-local state. Normalize extensions and run hooks on activation.
- `src/editor/api/hook-ops.ts` - Support callable hook entries and real hook execution. Preserve string function names for backwards compatibility.
- `src/editor/api/keymap-ops.ts` - Reuse existing T-Lisp keymap values for major and minor mode keymaps where possible.
- `src/editor/api/buffer-ops.ts` - Ensure buffer switching calls the mode-state restore path if buffer switching is implemented through T-Lisp APIs.
- `src/editor/api/delete-ops.ts` - Keep primitive delete operations; migrate operator policy and user-facing delete commands to T-Lisp.
- `src/editor/api/yank-ops.ts` - Keep primitive yank/register operations; migrate user-facing yank commands to T-Lisp.
- `src/editor/api/change-ops.ts` - Keep primitive change operations; migrate composed change commands to T-Lisp.
- `src/editor/api/search-ops.ts` - Keep primitive search operations; migrate interactive search workflows to T-Lisp.
- `src/editor/api/replace-ops.ts` - Keep primitive replacement operations; migrate query-replace workflow policy to T-Lisp.
- `src/editor/api/dired-ops.ts` - Keep filesystem/directory primitives; migrate dired command workflow to T-Lisp.
- `src/editor/api/documentation.ts` - Keep primitive metadata lookups; migrate help/discovery commands to T-Lisp.
- `src/editor/api/minibuffer-ops.ts` - Keep minibuffer primitives; migrate M-x completion and command policy to T-Lisp.
- `src/editor/api/window-ops.ts` - Keep frame/window primitives; migrate user-facing window commands to T-Lisp.
- `src/editor/api/file-ops.ts` - Keep file primitives; migrate command-mode file workflows to T-Lisp.
- `src/editor/keymap-sync.ts` - Support lookup across a stack of active keymaps instead of a single keymap per editing mode.
- `src/editor/handlers/normal-handler.ts` - Use central key resolution instead of reading `keyMappings` directly.
- `src/editor/handlers/insert-handler.ts` - Use central key resolution for non-printable and mapped insert-mode keys.
- `src/editor/handlers/visual-handler.ts` - Use central key resolution.
- `src/editor/handlers/command-handler.ts` - Use central key resolution for non-command-input keys.
- `src/editor/handlers/mx-handler.ts` - Use central key resolution for non-minibuffer-input keys.
- `src/editor/utils/which-key.ts` - Include active minor-mode and major-mode keymaps in prefix discovery and documentation.
- `src/frontend/render/status-line.ts` - Render current major mode and active minor-mode lighters.
- `src/frontend/components/StatusLine.tsx` - Render mode metadata in the Ink/React status line.
- `src/frontend/frontends/ink/components/StatusLine.tsx` - Render mode metadata in the Ink frontend duplicate component.
- `src/frontend/types.ts` - Add mode metadata fields if frontend state types are separate from core state.
- `src/server/server.ts` - Initialize the editor runtime before accepting daemon requests and include mode metadata in status/frame sync.
- `src/server/serialize.ts` - Include current major mode and active minor modes in serialized editor state if this serializer is used by daemon responses.
- `src/tlisp/core/modes/fundamental.tlisp` - Ensure the built-in fundamental mode uses normalized registration and provides its feature.
- `src/tlisp/core/modes/python-mode.tlisp` - Normalize extension registration and provide the feature.
- `src/tlisp/core/modes/typescript-mode.tlisp` - Normalize extension registration and provide the feature.
- `src/tlisp/core/modes/lisp-mode.tlisp` - Normalize extension registration and provide the feature.
- `src/tlisp/core/modes/go-mode.tlisp` - Normalize extension registration and provide the feature.
- `src/tlisp/core/bindings/normal.tlisp` - Keep normal-mode binding policy in T-Lisp and route through central key resolution.
- `src/tlisp/core/bindings/insert.tlisp` - Keep insert-mode binding policy in T-Lisp.
- `src/tlisp/core/bindings/visual.tlisp` - Keep visual-mode binding policy in T-Lisp.
- `src/tlisp/core/bindings/command.tlisp` - Keep command-mode binding policy in T-Lisp.
- `src/tlisp/core/commands/*.tlisp` - Expand from small command shims into the primary home for editor command behavior.
- `docs/tmax/tmax.texinfo` - Update the editor manual for mode loading, keymaps, minor modes, daemon-visible mode state, Lisp-first ownership, and user-facing workflows.
- `docs/tmax/tlisp.texinfo` - Update the T-Lisp reference for new APIs, mode macros/helpers, hooks, load/provide/require, auto-mode rules, and migrated Lisp-owned commands.
- `docs/tmax/tmax.info` - Rebuild generated Info output after texinfo edits.
- `docs/tmax/tlisp.info` - Rebuild generated Info output after texinfo edits.
- `README.md` - Document mode loading, major-mode APIs, minor-mode APIs, hooks, globalized modes, status-line display, and Lisp-first ownership where appropriate.
- `docs/srs.md` - Keep the product-level requirements aligned with the Lisp-first mode-system target and patch-review acceptance criteria.
- `docs/lisp-ownership-map.md` - Correct the existing ownership map if present; classify runtime source honestly and remove overstated "done" labels for incomplete mode/hook/command work.
- `rules/ui-testing.md` - Add mode-system UI test expectations if new UI tests are introduced.
- `test/ui/run_python_suite.py` - Ensure the mode UI test is included in the default Python UI suite if the suite uses explicit registration.

### New Files
- `src/editor/mode-state.ts` - Shared mode-state types and pure helpers for buffer-local major/minor mode state.
- `src/editor/mode-loader.ts` - Shared built-in mode loading, feature tracking, and deterministic mode-file discovery.
- `src/editor/key-resolution.ts` - Central key resolver implementing tmax's Emacs-style keymap precedence.
- `src/editor/auto-mode.ts` - Auto-mode rule registry for extension and regexp based mode detection.
- `src/editor/api/minor-mode-ops.ts` - T-Lisp API functions for minor mode register/toggle/query/list/global wrappers.
- `src/editor/api/load-ops.ts` - Minimal `(provide)`, `(featurep)`, and `(require)` support backed by the shared mode loader.
- `src/tlisp/core/commands/editing.tlisp` - Lisp-owned editing commands for delete/yank/change/paste/text-object workflows.
- `src/tlisp/core/commands/search-workflows.tlisp` - Lisp-owned incremental search, repeat search, word search, and no-match workflow policy.
- `src/tlisp/core/commands/replace-workflows.tlisp` - Lisp-owned query-replace and replace command workflows.
- `src/tlisp/core/commands/buffers.tlisp` - Lisp-owned buffer list, switch, kill, and messages-buffer commands.
- `src/tlisp/core/commands/windows.tlisp` - Lisp-owned window selection/split command wrappers.
- `src/tlisp/core/commands/files.tlisp` - Lisp-owned find/save/revert/write command workflows.
- `src/tlisp/core/commands/help.tlisp` - Lisp-owned describe/apropos/help commands and command documentation.
- `src/tlisp/core/commands/completion.tlisp` - Lisp-owned completion sources for M-x and command discovery.
- `src/tlisp/core/commands/dired-workflows.tlisp` - Lisp-owned dired navigation, mark, refresh, and open workflows.
- `src/tlisp/core/policy-migration.tlisp` - Optional transitional library that re-exports migrated commands while TypeScript modules are narrowed to primitives.
- `src/tlisp/core/modes/line-numbers-mode.tlisp` - Built-in line-numbers minor mode definition.
- `src/tlisp/core/modes/auto-fill-mode.tlisp` - Built-in auto-fill minor mode definition.
- `test/unit/lisp-owned-commands.test.ts` - Unit tests that validate migrated editor commands are defined and executable from T-Lisp.
- `test/unit/mode-loader.test.ts` - Unit tests for deterministic mode loading and feature tracking.
- `test/unit/major-mode-buffer-local.test.ts` - Unit tests for buffer-local major-mode state and extension normalization.
- `test/unit/minor-mode-ops.test.ts` - Unit tests for the minor-mode T-Lisp API.
- `test/unit/key-resolution-modes.test.ts` - Unit tests for key resolution precedence across modal, minor, major, and global keymaps.
- `test/unit/hook-ops-callable.test.ts` - Unit tests for callable hooks and backwards-compatible string hook entries.
- `test/tlisp/modes.test.tlisp` - Native T-Lisp tests for mode loading, generated minor-mode commands, hooks, and Lisp-owned command registration.
- `test/ui/tests/13_modes.py` - Optional daemon-first UI coverage for mode loading, mode activation, status serialization, and daemon-tmux status-line rendering.

## Implementation Plan

### Phase 0: Patch Review Remediation
Fix the incomplete first implementation attempt before adding more surface area. Make built-in loading fail loudly, make `require`/`provide` truthful, restore existing major-mode tests, wire callable hooks into the live interpreter, serialize mode metadata, and add missing source/test files called out by this spec.

### Phase 1: Foundation
Create the shared mode-state and mode-loader infrastructure. Fix major-mode loading and state while preserving existing public major-mode API names. Add minimal feature tracking and load APIs needed for mode files.

### Phase 2: Core Implementation
Implement minor-mode registry, buffer-local active mode state, optional globalized minor modes, callable hooks, and central key resolution. Route all editor handlers and which-key through the central resolver.

### Phase 3: Integration
Add built-in minor-mode T-Lisp files, update status rendering and daemon serialization, add tests, and update documentation. Validate both daemon-only and daemon-tmux UI lanes.

### Phase 4: Lisp Policy Migration
Create the migration map and move the first major slice of editor policy into T-Lisp libraries. This feature must migrate modes, keymaps, command-mode/M-x dispatch metadata, and representative editing/search/buffer/help workflows far enough that future work has a clear Lisp-first pattern to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create Shared Mode State
- Create `src/editor/mode-state.ts`.
- Define `BufferModeState`: `{ majorMode: string; activeMinorModes: string[]; minorModeActivationOrder: string[]; minorModeSources: Record<string, "local" | "global">; localMinorModeOverrides: Record<string, "enabled" | "disabled"> }`.
- Define `MinorModeConfig`: `{ name; description; lighter; keymap?; global; initValue; activateHook; deactivateHook }`.
- Define `MajorModeConfig`: keep existing fields and add optional `keymap` and normalized `extensions`.
- Add pure helpers to get or initialize mode state for a buffer key.
- Add pure helpers to activate/deactivate minor modes while preserving activation order.
- Add pure helpers to apply active global minor modes to new buffers.
- Add pure helpers to distinguish global activation from explicit buffer-local overrides.
- Add pure helpers to compute active minor-mode lighters.

### Step 2: Add Buffer-Local Mode State to `Editor`
- Add a private `bufferModeStates: Map<string, BufferModeState>` to `src/editor/editor.ts`.
- Add helper methods to identify the current buffer key from current filename, buffer name, or `*scratch*`.
- Initialize mode state when buffers are created or opened.
- Ensure switching buffers restores that buffer's major mode and active minor modes.
- Serialize the current buffer's mode metadata through `getEditorState()`.
- Preserve existing behavior when no buffer exists by falling back to `fundamental` and no active minor modes.

### Step 3: Fix Major-Mode State and Auto-Detection
- Update `src/editor/api/major-mode-ops.ts` so current mode is read and written through injected callbacks instead of module-level `currentMode`.
- Preserve the existing `createMajorModeOps` test/API call path or update every existing test in the same patch; `test/unit/major-mode.test.ts` must pass again.
- Normalize registered extensions by stripping a leading dot, so both `".py"` and `"py"` work.
- Create `src/editor/auto-mode.ts` with an ordered rule registry for extension and regexp matching.
- Add T-Lisp APIs such as `(auto-mode-add PATTERN MODE &optional KIND)`, `(auto-mode-list)`, and `(auto-mode-detect FILENAME)`.
- Update `(major-mode-auto-detect)` to use the auto-mode registry and activate the detected mode for the current buffer.
- Run the major-mode hook after activation.
- Set syntax and indent rules through a real eval callback.
- Add tests proving two buffers can have different current major modes.

### Step 4: Implement Real Hook Execution
- Update `src/editor/api/hook-ops.ts` to store hook entries as callable values, symbols, or string function names.
- Keep existing string function-name support for backwards compatibility.
- Allow `(add-hook "hook-name" some-function-symbol)` and `(add-hook "hook-name" (lambda () ...))`.
- Support append-style ordering now: `(add-hook HOOK FN)` prepends by default and `(add-hook HOOK FN t)` appends.
- Shape hook storage so numeric depth and buffer-local hook lists can be added later without changing public hook APIs.
- Update `run-hooks` to resolve and execute each hook entry through the real interpreter.
- Wire hook ops where the real interpreter is available by passing an evaluator capable of executing T-Lisp values, not only string function names, from `createEditorAPI`/`editor.ts`.
- Ensure the daemon/client eval path exercises the same hook execution path as direct editor tests.
- Make `hook-list` return inspectable hook entries, such as function names, symbol names, or readable lambda/form descriptions, never `"[object Object]"`.
- Add `remove-hook` coverage for string, symbol, and callable entries if the public API exposes removal.
- Add tests proving lambda hooks and string function-name hooks both execute.

### Step 5: Add Mode Loading and Feature Tracking
- Create `src/editor/mode-loader.ts`.
- Create `src/editor/api/load-ops.ts` with `(load FILE)`, `(load-path-add DIR)`, `(load-path-list)`, `(provide FEATURE)`, `(featurep FEATURE)`, and `(require FEATURE &optional FILE)`.
- Track loaded features in editor runtime state.
- Track load paths in editor runtime state, seeded with built-in T-Lisp directories.
- Load built-in mode files from `src/tlisp/core/modes/` deterministically before user init files run.
- Put this loading in shared editor initialization, not only in `src/server/server.ts`.
- Ensure the daemon initializes this runtime before accepting `tmaxclient --eval` requests.
- Remove or replace silent optional mode-load failures. Built-in mode load failures must surface in startup diagnostics, daemon readiness state, and failing tests.
- Implement `(load FILE)` as real file evaluation, not as a call to an unwired placeholder.
- Implement `(require FEATURE &optional FILE)` so it evaluates a candidate file when needed and succeeds only if `(featurep FEATURE)` becomes true after evaluation.
- Do not add a feature to the loaded-feature set before the file has evaluated and called `(provide FEATURE)`.
- Missing required features and mode-file syntax/runtime failures must return structured T-Lisp errors instead of marking features loaded.
- Keep built-in loading eager for this implementation; design `require` so on-demand loading can be added later without changing public APIs.

### Step 6: Update Built-In Major Mode Files
- Update all built-in major mode files to use normalized extension registration consistently.
- Register built-in auto-mode rules for extension matching through the new auto-mode registry.
- Add `(provide "fundamental-mode")`, `(provide "python-mode")`, `(provide "typescript-mode")`, `(provide "lisp-mode")`, and `(provide "go-mode")`.
- Confirm `(major-mode-list)` includes all built-in modes immediately after daemon startup.
- Confirm opening `.py`, `.ts`, `.tlisp`, and `.go` files activates the expected major mode.

### Step 7: Create Minor Mode API
- Create `src/editor/api/minor-mode-ops.ts`.
- Implement low-level API functions:
  - `(minor-mode-register NAME DESCRIPTION &optional LIGHTER)` - Register or update a minor mode.
  - `(minor-mode-set-keymap NAME KEYMAP)` - Associate an existing T-Lisp keymap with a minor mode.
  - `(minor-mode-toggle NAME)` - Toggle the mode for the current buffer.
  - `(minor-mode-set NAME STATE)` - Enable or disable the mode for the current buffer.
  - `(minor-mode-active-p NAME)` - Return `t` if active in the current buffer.
  - `(minor-mode-list-active)` - Return active mode names for the current buffer.
  - `(minor-mode-list-all)` - Return all registered minor mode names.
  - `(minor-mode-lighter NAME)` - Return a mode's status-line lighter.
  - `(minor-mode-list-lighters)` - Return lighters for currently active minor modes.
  - `(minor-mode-global-p NAME)` - Return whether a mode has globalized behavior.
- Implement globalized API functions:
  - `(global-minor-mode-set NAME STATE)` - Enable or disable a minor mode across all buffers and future buffers.
  - `(global-minor-mode-active-p NAME)` - Return whether a globalized mode is active.
  - `(global-minor-mode-list-active)` - Return active globalized minor modes.
- Store active global minor modes in editor runtime state so future buffers inherit them.
- Ensure explicit buffer-local disable of a global minor mode is remembered for that buffer while the global mode remains active.
- Ensure disabling a globalized minor mode removes the global-sourced activation from every buffer while preserving a buffer that explicitly re-enabled the mode locally after global activation.
- Add tests for existing buffers, future buffers, explicit local disable, explicit local re-enable, and global disable.

### Step 8: Add `define-minor-mode` T-Lisp Helper
- Add a real T-Lisp helper or macro equivalent named `define-minor-mode` to define minor modes in mode files and user init files.
- Support at least `:lighter`, `:keymap`, `:global`, `:init-value`, `:activate-hook`, and `:deactivate-hook` keyword-style options if the parser supports keyword symbols.
- If keyword options are not practical in the current interpreter, implement a documented low-level sequence using `minor-mode-register`, `minor-mode-set-keymap`, and hooks.
- Generate a convenience toggle function named `{mode-name}-mode`, for example `(line-numbers-mode)`.
- For globalized modes, generate `global-{mode-name}-mode`.
- Generated mode commands must follow Emacs-style argument semantics:
  - no argument toggles when called interactively or directly
  - `t` enables
  - positive numbers enable
  - `nil`, `0`, and negative numbers disable
- Generated globalized mode commands must follow the same argument semantics.
- Built-in minor mode files must use this helper or the documented fallback sequence; they must not hand-roll partial generated commands that fail during startup.

### Step 9: Centralize Key Resolution
- Create `src/editor/key-resolution.ts`.
- Define `resolveKeyBinding(context, mode, key)` returning command, source, source mode, and optional documentation.
- Implement precedence for tmax:
  - modal editing state keymaps and direct modal behavior
  - active minor-mode keymaps in reverse activation order
  - current major-mode keymap
  - mode-specific `key-bind` mappings
  - global `key-bind` mappings
- Preserve tmax's modal editing behavior while allowing minor-mode keymaps to shadow major-mode and global bindings, matching Emacs's minor-mode-over-major-mode rule.
- Include the source in `describe-key`, `key-binding`, and diagnostics.
- Add tests for conflicts between two minor modes and between minor mode, major mode, and global bindings.

### Step 10: Route Handlers Through Central Resolution
- Update normal, insert, visual, command, and M-x handlers to use `resolveKeyBinding` for mapped keys.
- Keep direct text insertion behavior in insert mode before mapped-key fallback, unless an explicit non-printable or control binding is being resolved.
- Update which-key prefix discovery to include active minor-mode and major-mode keymaps.
- Ensure count prefixes and pending operators still behave as they do today.

### Step 11: Add Built-In Minor Modes
- Create `src/tlisp/core/modes/line-numbers-mode.tlisp`.
- Register `line-numbers` with lighter `"Ln"`.
- Implement activation by setting `showLineNumbers` through a T-Lisp API if available; add a small config API if needed.
- Implement deactivation by restoring the previous value or setting line numbers off for the current buffer.
- Prove activation changes real render/editor state, not only `activeMinorModes`.
- Prove deactivation restores the previous buffer-local line-number setting when the setting was already on before mode activation.
- Provide `(line-numbers-mode)` and `(global-line-numbers-mode)`.
- Create `src/tlisp/core/modes/auto-fill-mode.tlisp`.
- Register `auto-fill` with lighter `"Fill"`.
- Implement activation/deactivation using existing word-wrap or fill-column settings if available; add minimal config state only if needed.
- Prove activation changes real editor behavior/config state, not only `activeMinorModes`.
- Prove deactivation restores the previous buffer-local wrapping/fill setting when the setting was already on before mode activation.
- Provide `(auto-fill-mode)` and `(global-auto-fill-mode)`.
- Add `(provide "line-numbers-mode")` and `(provide "auto-fill-mode")`.

### Step 12: Update Status and Serialization
- Add `currentMajorMode`, `activeMinorModes`, and `activeMinorModeLighters` to `EditorState`.
- Add the same metadata to `Frame` where frame state is serialized or copied.
- Update `src/server/server.ts` status, clients/frames metadata, render-state sync, and full-state query responses. `tmaxclient --json --status` must expose `currentMajorMode`, `activeMinorModes`, and `activeMinorModeLighters`.
- Update frame sync in both directions so mode metadata is not dropped by `syncFrameToEditor`, `syncEditorToFrame`, or equivalent helpers.
- Update `src/server/serialize.ts` if used by daemon responses.
- Update `src/frontend/render/status-line.ts` to render `NORMAL [python] (Ln Fill)`.
- Update both Ink status-line components so React/Ink status displays match the ANSI renderer.
- Update shared frontend prop/types definitions, including `src/frontend/types.ts`, so Ink/React components receive mode metadata through typed props.
- Ensure status-line layout remains width-safe when many minor modes are active.

### Step 13: Update Lisp Ownership Map
- Update `docs/lisp-ownership-map.md` if it exists, or create it if absent.
- Classify each `src/editor/api/*.ts` module as one of:
  - `substrate` - should stay TypeScript.
  - `primitive-api` - should expose low-level operations to T-Lisp.
  - `transitional-policy` - currently owns behavior that should move to T-Lisp.
  - `lisp-owned` - behavior is already in T-Lisp or has been migrated.
- Include the current measured source ratio for runtime source, not just `src/editor/api`: TypeScript/TSX LOC, T-Lisp LOC, and T-Lisp percentage. The patch-review baseline was 43,742 TypeScript/TSX lines and 529 T-Lisp lines.
- Mark partially implemented or failing areas honestly. Do not mark callable hooks, minor modes, mode loading, or Lisp-owned command libraries as done until their runtime tests and files exist.
- Add a target direction: move editor policy toward T-Lisp ownership, not by inflating Lisp code artificially, but by making user-facing editor behavior Lisp-defined.
- List follow-up migration candidates after this spec: search/replace workflows, dired workflows, help/discovery, completion, buffer/window/file command libraries, and plugin/package workflows.

### Step 14: Move Keymaps and Command Metadata to T-Lisp
- Ensure normal, insert, visual, command, and M-x binding policy lives in T-Lisp keymap files.
- Move command metadata needed by `describe-key`, which-key, and M-x discovery into T-Lisp where possible.
- Add a T-Lisp command registration layer, such as `defcommand` and/or `command-register`, if current metadata APIs cannot represent Lisp-owned commands.
- Command metadata must include command name, callable implementation, docstring/description, interactive category where available, and keybinding source when available.
- Keep TypeScript handlers focused on primitive modal input mechanics, text insertion, terminal input normalization, and dispatch into the central key resolver.
- Ensure adding a new user-facing command does not require editing TypeScript unless a new primitive is needed.

### Step 15: Move Representative Editor Workflows to T-Lisp
- Create or expand T-Lisp command libraries for:
  - Editing operators: delete, yank, change, paste, text objects, and count-prefix command wrappers.
  - Search workflows: incremental search, repeat search, no-match behavior, word-under-cursor search.
  - Replace workflows: query replace and replace-all command policy.
  - Buffer/file/window workflows: switch buffer, buffer list, messages buffer, find file, save buffer, revert buffer, split/select window command wrappers.
  - Help/discovery workflows: describe-key, describe-function, apropos, command docs, M-x completion sources.
  - Dired workflows: open, refresh, mark, unmark, and directory navigation command wrappers.
- Narrow TypeScript modules in those areas toward primitives that T-Lisp composes.
- Preserve compatibility function names where existing tests or user config rely on them.
- Add Lisp-level tests for migrated command behavior.

### Step 16: Add Unit Tests
- Keep existing tests passing, including `test/unit/major-mode.test.ts`.
- Create `test/unit/mode-loader.test.ts`.
- Create `test/unit/major-mode-buffer-local.test.ts`.
- Create `test/unit/minor-mode-ops.test.ts`.
- Create `test/unit/key-resolution-modes.test.ts`.
- Create `test/unit/hook-ops-callable.test.ts`.
- Create `test/unit/lisp-owned-commands.test.ts`.
- Add a native T-Lisp test file, such as `test/tlisp/modes.test.tlisp`, for mode loading, generated mode commands, hook forms, and command registration where possible.
- Test extension normalization, eager built-in loading, truthful `load`/`provide`/`featurep`/`require`, buffer-local major modes, buffer-local minor modes, globalized minor modes, hook execution through the live interpreter, key precedence, lighters, serialization, migrated command definitions, and migrated command execution through T-Lisp.

### Step 17: Add UI Coverage
- Create `test/ui/tests/13_modes.py` if the Python harness can query the needed daemon state.
- Register `13_modes.py` in `test/ui/run_python_suite.py` or the relevant suite discovery path so the full UI suite runs it.
- Verify daemon startup exposes built-in major modes through `(major-mode-list)`.
- Verify `(featurep "python-mode")` and `(featurep "line-numbers-mode")` are true after startup without calling `require`.
- Verify `(require "python-mode")` is idempotent for an already loaded feature and does not create false positives for missing features.
- Verify opening two files with different extensions keeps buffer-local major modes.
- Verify enabling a minor mode updates daemon status and active lighters.
- Verify callable hook execution through `tmaxclient --eval`, not only through direct unit construction.
- Verify daemon-tmux status line shows major mode and minor-mode lighters.
- Verify at least one migrated Lisp-owned command from each migrated category can run through the daemon/client workflow.
- Keep daemon mode as the default and use daemon-tmux only for renderer status-line assertions.

### Step 18: Update Documentation
- Follow `.claude/skills/update-tmax-documentation/SKILL.md`.
- Read the implementation source of truth before editing docs: `src/editor/tlisp-api.ts`, `src/editor/api/*.ts`, `src/tlisp/stdlib.ts`, `src/tlisp/evaluator.ts`, `src/tlisp/types.ts`, `src/editor/editor.ts`, `src/server/server.ts`, `src/client/tui-client.ts`, and the new T-Lisp libraries under `src/tlisp/core/`.
- Create a structured documentation diff plan covering `docs/tmax/tmax.texinfo`, `docs/tmax/tlisp.texinfo`, `README.md`, `docs/srs.md`, and `docs/lisp-ownership-map.md`.
- Update `docs/tmax/tmax.texinfo` with major/minor mode behavior, loading model, daemon/client visibility, status-line display, key binding behavior, Lisp-first ownership, and migrated editor workflows.
- Update `docs/tmax/tlisp.texinfo` with all new T-Lisp APIs, signatures, mode helpers, hook behavior, load/provide/require behavior, auto-mode functions, minor-mode command argument semantics, and migrated Lisp-owned command libraries.
- Update `README.md` with major-mode loading, auto-detection, minor-mode APIs, globalized minor modes, hook examples, status-line examples, and the Lisp-first ownership model where the project overview or examples change.
- Update `docs/srs.md` with user stories and acceptance criteria that describe the final product standard for built-in mode loading, buffer-local major modes, minor modes, global minor modes, callable hooks, key resolution, daemon/renderer observability, Lisp-first ownership, and native T-Lisp tests.
- Update `rules/ui-testing.md` if `13_modes.py` is added.
- Link `docs/lisp-ownership-map.md` from relevant docs.
- Document the rule for future specs and features: add TypeScript primitives only when needed, then implement user-facing behavior in T-Lisp.
- Show hook examples using callable hooks if Step 4 supports them:
  ```lisp
  (add-hook "mode-python-activate-hook"
    (lambda () (minor-mode-set "auto-fill" t)))
  ```
- Also document the backwards-compatible string-function hook form:
  ```lisp
  (defun enable-python-fill () (minor-mode-set "auto-fill" t))
  (add-hook "mode-python-activate-hook" "enable-python-fill")
  ```
- Cross-check documented T-Lisp function names against `api.set()` calls and loaded T-Lisp definitions, and report any remaining functions in source but not docs or docs but not source.
- Rebuild generated manuals with `cd docs/tmax && make info`.
- Validate texinfo syntax with `cd docs/tmax && make validate`.

### Step 19: Run Validation Commands
- Run every command listed in the Validation Commands section.
- Fix all failures before marking the feature complete.

## Testing Strategy

### Unit Tests
- `test/unit/major-mode.test.ts` - Existing major-mode regression coverage must keep passing after any signature or state-injection changes.
- `test/unit/mode-loader.test.ts` - Deterministic built-in mode loading, load path behavior, feature tracking, `load`, `provide`, `featurep`, and `require`.
- `test/unit/major-mode-buffer-local.test.ts` - Buffer-local major-mode activation, auto-mode extension/regexp matching, and extension normalization.
- `test/unit/minor-mode-ops.test.ts` - Register, toggle, set, active-p, list-active, list-all, keymap, lighter, globalized activation, and hook execution.
- `test/unit/key-resolution-modes.test.ts` - Modal, minor, major, mode-specific, and global key precedence.
- `test/unit/hook-ops-callable.test.ts` - Callable hooks, lambda hooks, string hooks, append ordering, hook removal, and error isolation.
- `test/unit/lisp-owned-commands.test.ts` - Migrated T-Lisp command libraries are loaded, define expected command names, and execute through the interpreter/daemon primitives.
- `test/tlisp/modes.test.tlisp` - Native T-Lisp assertions for loaded features, generated minor-mode command semantics, hook forms, and Lisp-owned command metadata where supported.

### Integration Tests
- Verify daemon startup loads built-in major and minor mode definitions before `tmaxclient --eval` requests.
- Verify daemon readiness waits for built-in mode loading and reports mode-load failures instead of accepting eval against a partially initialized runtime.
- Verify direct editor startup and daemon startup register the same built-in modes.
- Verify `require` cannot mark a feature loaded unless the file evaluated and called `provide`.
- Verify missing features and broken mode files return structured errors.
- Verify opening files auto-detects major modes and runs mode hooks.
- Verify explicit auto-mode rules can be added from T-Lisp and affect later file opens.
- Verify callable hooks execute through `tmaxclient --eval` and produce observable state changes.
- Verify minor-mode status-line rendering via daemon-tmux.
- Verify active minor-mode key bindings override major-mode and global bindings in key dispatch.
- Verify multiple minor modes can be active simultaneously per buffer.
- Verify globalized minor modes apply to existing and future buffers and preserve explicit local disable/re-enable semantics.
- Verify daemon status, frame, render-state, and full-state JSON all include mode metadata.
- Verify migrated T-Lisp command libraries run through daemon eval and key dispatch without requiring direct TypeScript command calls.
- Verify `describe-key`, which-key, M-x discovery, or equivalent metadata can see migrated Lisp-owned commands.

### Edge Cases
- Toggle a minor mode that is not registered.
- Toggle an already active mode.
- Register a mode with the same name twice.
- Disable all minor modes.
- Enable a globalized minor mode, then disable it in one buffer.
- Two active minor modes bind the same key.
- A minor-mode keymap conflicts with a major-mode keymap.
- A mode hook throws an error.
- Hook append ordering runs hooks in the expected order.
- Mode files load in a deterministic order.
- `require` is called for a feature that is already loaded.
- `require` is called for a missing feature with no file hint.
- `require` is called for a mode file that evaluates but does not provide the requested feature.
- `load-path` contains duplicate directories.
- A mode file calls `(provide)` twice.
- A mode file has a syntax error.
- A filename has no extension.
- An extension is registered with and without a leading dot.
- An auto-mode regexp rule conflicts with an extension rule.
- A generated minor-mode command is called with no arg, `t`, `nil`, positive number, `0`, and negative number.
- Switching buffers restores each buffer's major and minor mode state.
- Status line has more active minor modes than fit the terminal width.
- A migrated T-Lisp command fails because a required primitive is missing.
- A migrated T-Lisp command has the same public name as an existing TypeScript builtin.
- A user init file overrides a migrated T-Lisp command.
- A migrated T-Lisp command is used by a key binding before user init files run.

## Acceptance Criteria
- Built-in mode files are loaded through shared editor initialization before user init files and before daemon eval requests.
- Built-in mode-file load failures are not silently ignored; startup diagnostics, daemon readiness, and tests expose syntax/runtime failures.
- `docs/lisp-ownership-map.md` exists and classifies TypeScript editor modules as substrate, primitive API, transitional policy, or Lisp-owned target.
- The ownership map includes the current TypeScript/T-Lisp runtime source ratio using all runtime `src/**/*.ts`, `src/**/*.tsx`, and T-Lisp files, and explains that the target is user-facing behavior ownership, not artificial LOC growth.
- The ownership map marks incomplete work honestly; callable hooks, minor modes, mode loading, and Lisp-owned command libraries are not marked done until runtime tests pass and required files exist.
- `(major-mode-list)` includes `fundamental`, `python`, `typescript`, `lisp`, and `go` immediately after daemon startup.
- Existing major-mode tests pass, including `test/unit/major-mode.test.ts`.
- Opening files with `.py`, `.ts`, `.tlisp`, and `.go` activates the expected buffer-local major mode.
- Two open buffers can have different current major modes.
- `(load)`, `(load-path-add)`, `(load-path-list)`, `(provide)`, `(featurep)`, and `(require)` work for built-in mode features.
- `(require FEATURE)` only succeeds when the feature was already provided or a loaded file evaluates and calls `(provide FEATURE)`.
- `(require "missing-feature")` returns a structured error and does not make `(featurep "missing-feature")` true.
- Auto-mode extension and regexp rules can be registered, listed, and used during file open.
- `(minor-mode-register "test" "A test mode" "Test")` succeeds.
- `(minor-mode-toggle "test")` activates and deactivates the mode for the current buffer.
- `(minor-mode-active-p "test")` returns the correct state for the current buffer.
- `(minor-mode-list-active)` returns only the current buffer's active minor modes.
- Generated mode commands follow Emacs-style argument semantics for no argument, `t`, `nil`, positive number, `0`, and negative number.
- `(global-minor-mode-set "test" t)` applies the minor mode to all existing buffers and future buffers.
- Buffer-local explicit disable/re-enable semantics are preserved when a global minor mode is enabled and later disabled.
- Active minor-mode keymaps participate in central key resolution with Emacs-style precedence over major-mode and global bindings.
- `describe-key`, `key-binding`, and which-key show bindings from active minor modes.
- Major-mode and minor-mode hooks execute real hook functions, including lambdas and backwards-compatible string function names, with prepend and append ordering.
- Callable hook execution is proven through the live editor/daemon eval path, not only by constructing hook ops directly in a unit test.
- `hook-list` returns inspectable entries for function names, symbols, and callable/lambda hooks; it never serializes live hooks as `"[object Object]"`.
- Status lines show the current major mode and active minor-mode lighters.
- Daemon status, frame serialization, render-state responses, and full-state responses expose current major mode, active minor modes, and active minor-mode lighters.
- Built-in `line-numbers` and `auto-fill` minor modes are registered at startup.
- Built-in `line-numbers` and `auto-fill` minor modes change real buffer/editor config state on activation and restore previous buffer-local state on deactivation.
- Normal, insert, visual, command, and M-x binding policy is loaded from T-Lisp files.
- T-Lisp command metadata registration exists for Lisp-owned commands if existing metadata primitives cannot represent them.
- At least one representative command workflow in each migrated category is owned by T-Lisp and validated by tests: editing operator, search, replace, buffer/file/window, help/discovery, and dired.
- TypeScript modules touched by this spec are narrowed toward primitives where a T-Lisp library now owns the user-facing behavior.
- New user-facing editor commands added by this spec are implemented in T-Lisp unless they require a new primitive.
- Native T-Lisp tests cover the Lisp-owned parts of modes, hooks, generated mode commands, and command metadata where the current T-Lisp test framework can express them.
- `test/ui/tests/13_modes.py` is included in the full Python UI suite and defaults to daemon/client assertions; daemon-tmux is used only for renderer/status-line assertions.
- `docs/tmax/tmax.texinfo` documents the implemented editor-facing mode system, Lisp-first ownership model, status-line behavior, keymaps, daemon/client behavior, and migrated workflows.
- `docs/tmax/tlisp.texinfo` documents every new T-Lisp API and helper added by this spec with accurate signatures.
- `docs/srs.md` contains product-level user stories and acceptance criteria for the mode system end state so future harnesses can implement toward the same standard.
- `docs/tmax/tmax.info` and `docs/tmax/tlisp.info` are regenerated after texinfo edits.
- Documentation has been cross-checked against source functions, with remaining source/docs gaps fixed or explicitly reported.
- Documentation contains no stale Deno runtime references in `docs/tmax/tmax.texinfo` or `docs/tmax/tlisp.texinfo`.
- All new unit tests pass.
- The full Python UI suite passes with zero regressions.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/mode-loader.test.ts` - Run mode loader tests.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/major-mode.test.ts` - Run existing major-mode regression tests.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/major-mode-buffer-local.test.ts` - Run major-mode buffer-local tests.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/minor-mode-ops.test.ts` - Run minor-mode API tests.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/key-resolution-modes.test.ts` - Run key resolution precedence tests.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/hook-ops-callable.test.ts` - Run hook execution tests.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/lisp-owned-commands.test.ts` - Run Lisp-owned command migration tests.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/test-tlisp-testing-framework.test.ts` - Verify the T-Lisp testing framework still passes.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/server-observability.test.ts` - Verify server observability still passes.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'set -euo pipefail; bin/tmax --stop 2>/dev/null || true; bin/tmax --daemon >/tmp/tmax-spec003.log 2>&1 & trap "bin/tmax --stop 2>/dev/null || true" EXIT; for i in $(seq 1 100); do bin/tmaxclient --ping >/dev/null 2>&1 && break; sleep 0.1; done; bin/tmaxclient --ping >/dev/null; bin/tmaxclient --eval "(major-mode-list)"; bin/tmaxclient --eval "(featurep \"python-mode\")"; bin/tmaxclient --eval "(featurep \"line-numbers-mode\")"; bin/tmaxclient --eval "(require \"python-mode\")"; ! bin/tmaxclient --eval "(require \"missing-feature\")"; bin/tmaxclient --eval "(featurep \"missing-feature\")" | grep -E "nil|false"; bin/tmaxclient --eval "(auto-mode-list)"; bin/tmaxclient --eval "(minor-mode-list-all)"; bin/tmaxclient --eval "(minor-mode-register \"test\" \"test mode\" \"Test\")"; bin/tmaxclient --eval "(minor-mode-toggle \"test\")"; bin/tmaxclient --eval "(minor-mode-active-p \"test\")"; bin/tmaxclient --eval "(minor-mode-list-active)"; bin/tmaxclient --json --status | rg "\"currentMajorMode\"|\"activeMinorModes\"|\"activeMinorModeLighters\""'` - End-to-end daemon validation with readiness polling and truthful feature/status checks.
- `cd /Users/mekael/Documents/programming/typescript/tmax && bash -lc 'set -euo pipefail; bin/tmax --stop 2>/dev/null || true; bin/tmax --daemon >/tmp/tmax-spec003-tlisp-tests.log 2>&1 & trap "bin/tmax --stop 2>/dev/null || true" EXIT; for i in $(seq 1 100); do bin/tmaxclient --ping >/dev/null 2>&1 && break; sleep 0.1; done; bin/tmaxclient --ping >/dev/null; bin/tmaxclient --eval "(load \"test/tlisp/modes.test.tlisp\")"; bin/tmaxclient --eval "(test-run-all)"'` - Load and run native T-Lisp mode tests through the daemon.
- `cd /Users/mekael/Documents/programming/typescript/tmax/test/ui && uv run python tests/13_modes.py` - Run mode-system daemon UI test if added.
- `cd /Users/mekael/Documents/programming/typescript/tmax/test/ui && TMAX_UI_TEST_MODE=daemon-tmux uv run python tests/13_modes.py` - Run renderer status-line mode test if `13_modes.py` includes daemon-tmux assertions.
- `cd /Users/mekael/Documents/programming/typescript/tmax/test/ui && uv run python run_python_suite.py` - Run the full Python UI suite.
- `cd /Users/mekael/Documents/programming/typescript/tmax/docs/tmax && make validate` - Validate texinfo syntax.
- `cd /Users/mekael/Documents/programming/typescript/tmax/docs/tmax && make info` - Rebuild generated Info manuals.
- `cd /Users/mekael/Documents/programming/typescript/tmax && ! grep -rn "Deno\\|deno" docs/tmax/tmax.texinfo docs/tmax/tlisp.texinfo` - Verify tmax manuals do not contain stale Deno runtime references.
- `cd /Users/mekael/Documents/programming/typescript/tmax && test -f docs/tmax/tmax.info && test -f docs/tmax/tlisp.info` - Verify generated documentation artifacts exist.

## Notes
This feature is intentionally larger than a standalone minor-mode implementation. The mode system is the foundation for making tmax Lisp-first: TypeScript should become the substrate and primitive provider, while T-Lisp becomes the primary editor implementation language.

Do not chase an Emacs-like C/Elisp ratio by adding low-value Lisp code. The useful target is ownership: user-facing editor behavior should be authored, loaded, customized, tested, and overridden as T-Lisp.

When moving behavior from TypeScript to T-Lisp, preserve a thin TypeScript primitive if the behavior needs access to runtime, filesystem, terminal, daemon, renderer, or buffer internals. Put command policy, composition, key binding, and interactive behavior in T-Lisp.

The first migration slice in this spec should be representative rather than exhaustive. It must establish the pattern across modes, keymaps, command metadata, editing workflows, search/replace, buffer/file/window workflows, help/discovery, and dired. Remaining TypeScript policy modules should be tracked in `docs/lisp-ownership-map.md`.

This spec intentionally fixes major-mode loading and buffer-local major-mode state as part of the minor-mode work. Minor modes depend on a correct major-mode foundation, and implementing them on top of a global major-mode state would not match Emacs.

The implementation should use eager built-in loading for now. Full Emacs-style autoload generation is not required, but the new `load-path`, `load`, `provide`, and `require` groundwork should make later on-demand loading straightforward.

The first auto-mode implementation should support extension and regexp rules. Shebang matching, magic-mode content matching, file-local variables, and dir-local variables are intentionally deferred so the current feature can land with a clear boundary.

Generated minor-mode and globalized minor-mode functions should follow Emacs-style argument semantics even if tmax does not yet have interactive prefix-argument UI parity.

Hook implementation should support prepend and append ordering now. Numeric depth and buffer-local hook variables may be added later, but the internal representation should not assume hooks are only a flat string list.

Hook examples should use the current hook naming convention consistently: `mode-{major}-activate-hook`, `minor-mode-{name}-activate-hook`, and `minor-mode-{name}-deactivate-hook`.

No new external dependencies are needed.
