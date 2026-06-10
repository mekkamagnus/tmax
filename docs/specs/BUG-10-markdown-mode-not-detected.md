# Bug: Markdown files show [fundamental] instead of [markdown]

## Bug Description
When opening a markdown file (`.md`, `.markdown`, `.mdx`) in tmax, the status line displays `[fundamental]` instead of `[markdown]`. The major mode auto-detection fails because mode registration hasn't happened by the time the file is opened.

## Problem Statement
Major modes (including markdown) are registered via T-Lisp `require-module` calls in `normal.tlisp`, which is loaded lazily during `ensureCoreBindingsLoaded()`. However, in `main.tsx`, the file is loaded in Phase 4 by directly setting editor state — before core bindings are loaded in Phase 5. After core bindings load, there is no call to `activateMajorModeForFile()` to retroactively detect and activate the correct major mode for the already-open file.

## Solution Statement
After `server.startEditor()` completes in Phase 5 of `main.tsx` (which loads core bindings and registers all major modes), call `activateMajorModeForFile(filename)` if a file was loaded in Phase 4. This ensures mode auto-detection runs after the mode registry is populated.

## Steps to Reproduce
1. Start tmax with a markdown file: `bun run start README.md`
2. Observe the status line mode indicator
3. Expected: `[markdown]` — Actual: `[fundamental]`

## Root Cause Analysis
In `src/main.tsx`:
- Phase 4 (~line 200): File is loaded directly via `filesystem.readFile()` and state is set via `editor.setEditorState(initialState)` — no mode detection runs
- Phase 5 (~line 317): `server.startEditor()` loads core bindings which triggers `normal.tlisp` → `require-module editor/modes/markdown` → registers markdown mode in the registry
- But no code calls `activateMajorModeForFile()` after modes are registered

The `editor.openFile()` method (which calls `activateMajorModeForFile()`) is never invoked in the `main.tsx` startup path. The daemon path works correctly because `startEditor()` runs before any client opens files.

## Relevant Files
Use these files to fix the bug:

- `src/main.tsx` — File loading in Phase 4 and core binding initialization in Phase 5; needs a deferred `activateMajorModeForFile` call after Phase 5
- `src/editor/editor.ts` — Contains `activateMajorModeForFile()` method that runs `(major-mode-auto-detect)`
- `src/editor/api/major-mode-ops.ts` — Major mode registry and auto-detection logic; no changes needed
- `src/tlisp/core/modes/markdown-mode.tlisp` — Markdown mode registration; no changes needed
- `src/tlisp/core/commands/find-file.tlisp` — `find-file-open` creates/switches buffers without triggering mode detection; needs `(major-mode-auto-detect)` call

## Step by Step Tasks

### Add deferred major mode activation after core bindings load

**User Story**: As a user opening a markdown file, I want the correct major mode to be activated automatically so that mode-specific features (syntax highlighting, key bindings) work immediately.

- In `src/main.tsx`, after `await server.startEditor()` on line 317, add a call to `editor.activateMajorModeForFile(filename)` if `filename` is defined
- In `src/tlisp/core/commands/find-file.tlisp`, add `(major-mode-auto-detect)` after `set-buffer-filename` in both branches of `find-file-open` (existing file and new file)

**Acceptance Criteria**:
- [ ] Opening a `.md` file shows `[markdown]` in the status line
- [ ] Opening a `.ts` file shows `[typescript]` in the status line
- [ ] Opening a `.py` file shows `[python]` in the status line
- [ ] Opening a file with no registered mode shows `[fundamental]`
- [ ] Opening tmax without a file still starts correctly

### Run validation

**User Story**: As a developer, I want automated checks to confirm the fix works with zero regressions.

- Run type checks
- Run unit tests
- Run daemon tests

**Acceptance Criteria**:
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes
- [ ] Manual verification: `bun run start README.md` shows `[markdown]` mode

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run typecheck` — Type check the entire project
- `bun test` — Run all unit tests
- `bun run start README.md` — Manually verify markdown mode activates (expect `[markdown]` in status line)

## Notes
- The daemon/client path is unaffected — `startEditor()` runs before client file-open requests
- This fix is a single line addition — no architectural changes needed
