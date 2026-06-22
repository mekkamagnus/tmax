# Bug: Markdown files show `[fundamental]` instead of `[markdown]` when launched via `bun run start`

## Bug Description
When opening a markdown file (`.md`, `.markdown`, `.mdx`) using `bun run start README.md` (or `bun run dev README.md`), the status line displays `[fundamental]` instead of `[markdown]`. Major-mode auto-detection silently fails because the T-Lisp core binding files (including `markdown-mode.tlisp`) never load.

Symptoms observed when running `bun run start README.md`:
```
Failed to load bindings from undefined/../tlisp/core/keymaps.tlisp: Bun is not defined
Failed to load bindings from undefined/../tlisp/core/bindings/normal.tlisp: Bun is not defined
Failed to load bindings from undefined/../tlisp/core/bindings/insert.tlisp: Bun is not defined
Failed to load bindings from undefined/../tlisp/core/bindings/visual.tlisp: Bun is not defined
Failed to load bindings from undefined/../tlisp/core/bindings/command.tlisp: Bun is not defined
Failed to load some core bindings. Last error: Failed to load from undefined/../tlisp/core/bindings/command.tlisp
Loading minimal fallback key bindings...
```
Status line shows `[fundamental]` instead of `[markdown]`.

Expected: `[markdown]` shown for `.md` files.
Actual: `[fundamental]` shown for `.md` files when launched via the npm script.

## Problem Statement
`package.json` scripts `start` and `dev` invoke the editor via `node --import tsx src/main.tsx`. The editor's bindings loader constructs core paths using `import.meta.dir` (a Bun-specific API that returns `undefined` under node+tsx) and falls back to `Bun.file` when the filesystem read fails (Bun is not defined under node+tsx). The combined effect is that NO core T-Lisp files load — including `markdown-mode.tlisp` — so the markdown major mode is never registered and auto-detection returns the default `fundamental` mode.

This is a regression in the node+tsx launch path. The daemon path (`bun src/server/server.ts` and `tmax file.md`) works correctly and is covered by existing tests.

## Solution Statement
Make the editor launch path agnostic to whether it runs under Bun or node+tsx:
1. Resolve the core T-Lisp directory using `import.meta.url` (works in both runtimes) instead of `import.meta.dir`.
2. Replace the `Bun.file` fallback in `loadBindingsFromFile` with `node:fs` `readFileSync`/`promises.readFile` (works in both runtimes).
3. Add a regression test that asserts `[markdown]` is displayed when launching the editor with a `.md` file via the same code path used by `bun run start`.

## Steps to Reproduce
1. From project root: `bun run start README.md`
2. Wait for the TUI to render.
3. Read the status line at the bottom of the screen.
4. Expected: `[markdown]`. Actual: `[fundamental]`.

Alternate confirmation (no TUI):
```bash
bun run start README.md >/tmp/out 2>&1 &
START_PID=$!
sleep 2
pkill -TSINT -f 'tsx src/main.tsx'
grep -E 'Failed to load bindings|Bun is not defined' /tmp/out
```
If any line matches, the bug is reproduced.

## Root Cause Analysis
Two Bun-specific dependencies conspire to break the node+tsx launch path:

**1. `import.meta.dir` returns `undefined` under node+tsx.**
`src/editor/editor.ts:109` and `:190` and `:1634` and `:1637` use:
```ts
`${import.meta.dir}/../tlisp/core`
```
Under Bun, `import.meta.dir` returns the directory of the current module. Under node+tsx, `import.meta.dir` is `undefined`, so the constructed path becomes `undefined/../tlisp/core/...` — visible in the error output above. The first `filesystem.readFile` call fails because that path does not exist.

**2. `Bun.file` fallback throws `ReferenceError: Bun is not defined`.**
`src/editor/editor.ts:1608` falls back to:
```ts
const realFile = Bun.file(path);
if (await realFile.exists()) { ... }
```
Under node+tsx, `Bun` is not a defined global, so this throws. The `catch (realError)` branch logs the failure and returns `false`, so `loadBindingsFromFile` reports a load failure.

The combined effect: `ensureCoreBindingsLoaded()` loads zero core files. `markdown-mode.tlisp` never runs `(major-mode-register "markdown" ...)`. When `activateMajorModeForFile("README.md")` later calls `(major-mode-auto-detect)`, the mode registry has only `fundamental` registered, so detection returns `fundamental`.

**Why tests miss this:** All unit tests and daemon-tmux tests run under `bun test` or `bun src/server/server.ts`. The bug only manifests under the node+tsx launch path used by `bun run start` / `bun run dev`, which has no test coverage.

**Scope of breakage:** The bug is NOT specific to markdown — ALL major modes (typescript, python, go, lisp) fail to register under node+tsx. Markdown is just the most user-visible because users open `.md` files first. The status line shows `[fundamental]` for every file type when launched via `bun run start`.

## Relevant Files
Use these files to fix the bug:

- `package.json` — Defines the broken `start` and `dev` scripts that use `node --import tsx`. Either change them to `bun src/main.tsx` (simplest fix) or keep node+tsx support by fixing the runtime-agnostic issues below.
- `src/editor/editor.ts` — Contains the broken `import.meta.dir` path construction (lines 109, 190, 1634, 1637) and the `Bun.file` fallback in `loadBindingsFromFile` (line 1608). Fix path resolution and replace `Bun.file` with a runtime-agnostic read.
- `src/editor/filesystem.ts` (or equivalent filesystem abstraction) — May already have a runtime-agnostic `readFile`; verify the path it receives is valid.
- `src/main.tsx` — Entry point; verify how it constructs paths to core bindings.

### New Files
- `test/unit/bindings-loader.test.ts` — New regression test that loads the editor under both `bun` and `node --import tsx` (or simulates the node environment) and asserts that all core binding files (`keymaps.tlisp`, `normal.tlisp`, `markdown-mode.tlisp`, etc.) load successfully. Verify by checking `(module-loaded? "editor/modes/markdown")` returns `true` and `(major-mode-list)` includes `"markdown"`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Task 1: Confirm reproduction and root cause

**User Story**: As a developer fixing this bug, I want to confirm the failure mode and root cause before writing a fix, so that I know my fix actually addresses the issue.

- Run `bun run start README.md` and capture stderr/stdout; verify the `Failed to load bindings from undefined/...` and `Bun is not defined` messages appear.
- Run `bun src/main.tsx README.md` (bypassing the broken npm script) and verify the status line shows `[markdown]` — confirming the bug is specific to the node+tsx launch path, not the editor logic.
- Document the captured output in the bug's investigation notes.

**Acceptance Criteria**:
- [ ] `bun run start README.md` output contains `Failed to load bindings from undefined/`
- [ ] `bun run start README.md` output contains `Bun is not defined`
- [ ] `bun src/main.tsx README.md` shows `[markdown]` in the status line
- [ ] Notes recorded in the bug plan or commit message

### Task 2: Choose fix strategy

**User Story**: As a developer, I want to pick the simplest fix that addresses the regression, so that I don't over-engineer the solution.

Decide between two options:
- **Option A (simplest):** Change `start` and `dev` in `package.json` from `node --import tsx src/main.tsx` to `bun src/main.tsx`. The project already declares Bun as the runtime in `CLAUDE.md` and `README.md`. This is a one-line fix per script.
- **Option B (broader):** Keep node+tsx support by making the bindings loader runtime-agnostic. This is more work but preserves the ability to run under node.

Recommendation: **Option A** unless there is a documented reason to support node+tsx.

**Acceptance Criteria**:
- [ ] Decision recorded in commit message
- [ ] If Option A: package.json updated, no other files touched
- [ ] If Option B: Tasks 3 and 4 below completed

### Task 3 (Option B only): Make path resolution runtime-agnostic

**User Story**: As a developer, I want the bindings loader to find core T-Lisp files regardless of runtime, so that mode detection works under both Bun and node+tsx.

- In `src/editor/editor.ts`, replace `${import.meta.dir}/../tlisp/core` with a helper that uses `import.meta.url` (works in both Bun and node ESM):
  ```ts
  import { fileURLToPath } from "node:url";
  import { dirname, resolve } from "node:path";

  const here = dirname(fileURLToPath(import.meta.url));
  const corePath = resolve(here, "..", "tlisp", "core");
  ```
- Update all four sites (lines 109, 190, 1634, 1637) to use the resolved path.
- Remove the `Bun.file` fallback in `loadBindingsFromFile` (line 1608); the `filesystem.readFile` call already uses Node-compatible APIs and will succeed once the path is valid.

**Acceptance Criteria**:
- [ ] No remaining `import.meta.dir` usages in `src/editor/editor.ts`
- [ ] No remaining `Bun.file` usages in `src/editor/editor.ts`
- [ ] `bun src/main.tsx README.md` still shows `[markdown]`
- [ ] `node --import tsx src/main.tsx README.md` now shows `[markdown]`

### Task 4: Add regression test

**User Story**: As a developer maintaining this codebase, I want an automated test that catches this regression, so it doesn't recur.

- Create `test/unit/bindings-loader.test.ts` that:
  - Constructs an `Editor` instance.
  - Awaits `ensureCoreBindingsLoaded()`.
  - Asserts `(module-loaded? "editor/modes/markdown")` returns `true`.
  - Asserts `(major-mode-list)` includes `"markdown"`.
  - Asserts `(auto-mode-detect "test.md")` returns `"markdown"`.
- Run the test under both `bun test` and (if Option B was chosen) `node --import tsx`.

**Acceptance Criteria**:
- [ ] Test file exists at `test/unit/bindings-loader.test.ts`
- [ ] Test passes under `bun test`
- [ ] Test would have failed before the fix (verify by temporarily reverting the fix)

### Task 5: Run validation

**User Story**: As a developer, I want automated checks to confirm the fix works with zero regressions.

- Run type checks
- Run unit tests
- Run daemon tests
- Manually verify the fix end-to-end

**Acceptance Criteria**:
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes (all 2342+ tests, 0 failures)
- [ ] `cd test/ui && uv run python run_python_suite.py daemon` passes
- [ ] Manual: `bun run start README.md` shows `[markdown]` in status line

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

**Reproduce before fix (must fail):**
- `bun run start README.md` — Status line must show `[fundamental]`; stderr must contain `Failed to load bindings from undefined/` and `Bun is not defined`.

**Verify after fix (must pass):**
- `bun run start README.md` — Status line must show `[markdown]`; stderr must NOT contain `Failed to load bindings` or `Bun is not defined`.
- `bun src/main.tsx README.md` — Status line must show `[markdown]` (regression check for the working path).
- `bun run typecheck` — Type check passes for the entire project.
- `bun test` — All unit tests pass (2342+ tests, 0 failures).
- `cd test/ui && uv run python run_python_suite.py daemon` — All daemon tests pass.
- `cd test/ui && uv run python run_python_suite.py daemon-tmux` — All daemon-tmux tests pass (covers TUI rendering of mode line).
- `bun src/tlisp/cli.ts -e '(require-module editor/modes/markdown) (module-loaded? "editor/modes/markdown")'` — Returns `true`.

## Notes
- The bug is NOT caused by the SPEC-039 review fixes (keybinding format changes, shell injection fix, etc.). Those changes are verified working via the daemon path. The bug is in the `bun run start` npm script using `node --import tsx`, which fails because `import.meta.dir` and `Bun.file` are Bun-specific.
- All bug-fix claims above (`bun src/main.tsx README.md` shows `[markdown]`, daemon path returns `markdown`, all 2342 tests pass) were verified during investigation on the current branch.
- The `node --import tsx` launch path was likely working at some earlier point when the project supported both runtimes, but the bindings loader was later refactored to use Bun-specific APIs without updating the npm scripts. This is the regression.
- Per project memory: the daemon must be restarted after TypeScript source changes; ensure no stale daemon is running during validation (`bin/tmax --stop`).
