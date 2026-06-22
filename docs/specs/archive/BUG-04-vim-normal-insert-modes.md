# Bug: Vim normal and insert modes broken when daemon starts from wrong directory

## Bug Description
When the tmax daemon is started from a directory other than the tmax project root (e.g. from `~/Documents/programming/typescript/competition-click`), all T-Lisp key binding files fail to load. The editor starts with minimal fallback bindings only. Vim commands like `o` (open line), `dd` (delete line), `w` (word forward), and `Escape` (return to normal) are unbound. The status line shows "Unbound key in normal mode" for most keys.

## Problem Statement
`loadCoreBindings()` in `src/editor/editor.ts:1547` uses hardcoded relative paths (`"src/tlisp/core/bindings/normal.tlisp"`) to locate T-Lisp binding files. These resolve relative to the process's current working directory (CWD), not relative to the project source. When the daemon is launched from outside the project root, all four binding files fail to load and the editor falls back to minimal bindings that lack vim editing commands.

## Solution Statement
Resolve binding file paths relative to the editor source file's directory (using `import.meta.dir`) rather than relative to CWD. This makes the daemon independent of the working directory it was started from.

## Steps to Reproduce
1. Open a terminal and `cd` to a directory that is NOT the tmax project root
2. Run `tmax --daemon` (or start the daemon from a tmux session in another project directory)
3. Connect with a TUI client: `bun src/client/tui-client.ts`
4. Try pressing `o` in normal mode — shows "Unbound key in normal mode"
5. Try pressing `Escape` — shows "Unbound key in normal mode: Escape"
6. The mode line never changes from NORMAL; vim editing is broken

## Root Cause Analysis
The root cause is in `src/editor/editor.ts:1548-1552`:

```typescript
const requiredBindingFiles = [
  "src/tlisp/core/bindings/normal.tlisp",
  "src/tlisp/core/bindings/insert.tlisp",
  "src/tlisp/core/bindings/visual.tlisp",
  "src/tlisp/core/bindings/command.tlisp",
];
```

These paths are relative. `loadBindingsFromFile` (line 1498) first tries `this.filesystem.readFile(path)` which fails, then at line 1523 tries `Bun.file(path)` — but `Bun.file()` also resolves relative to CWD. Both fail when CWD is not the tmax project root.

The `bin/tmax` launcher already does `cd "$PROJECT_DIR"` before starting the daemon, so the common path works. But `tmax --daemon` run manually from another directory, or a tmux session whose CWD is a different project, will break.

**Fix:** Compute binding paths relative to `import.meta.dir` (which always resolves to the directory of `editor.ts` itself) so they work regardless of CWD.

## Relevant Files
Use these files to fix the bug:

- `src/editor/editor.ts:1547-1564` — `loadCoreBindings()` where the hardcoded relative paths are defined
- `src/editor/editor.ts:1498-1541` — `loadBindingsFromFile()` which reads the files
- `bin/tmax` — launcher script (already has the `cd "$PROJECT_DIR"` fix for the common case)

### New Files
None needed.

## Step by Step Tasks

### Fix binding file paths to be project-relative

**User Story**: As a tmax user, I want the daemon to load key bindings correctly regardless of which directory I start it from, so that vim editing always works.

- In `src/editor/editor.ts`, compute binding file paths relative to the source file directory using `import.meta.dir`
- The editor source is at `src/editor/editor.ts`, so `import.meta.dir` gives `src/editor/`. The bindings are at `src/tlisp/core/bindings/`, which is `../tlisp/core/bindings/` relative to the editor source.
- Build the absolute paths in `loadCoreBindings()` using `path.resolve(import.meta.dir, '..', 'tlisp', 'core', 'bindings', 'normal.tlisp')` etc.

**Acceptance Criteria**:
- [ ] Daemon started from any directory loads all four binding files successfully
- [ ] `o` key opens a new line and enters insert mode
- [ ] `Escape` key returns to normal mode from insert
- [ ] `dd` deletes a line in normal mode
- [ ] `w` moves forward by word in normal mode

### Add regression test for cross-directory daemon start

**User Story**: As a developer, I want a test that verifies the daemon loads bindings correctly regardless of CWD, so this bug doesn't regress.

- Add a unit test that creates an Editor with a filesystem mock, verifies that binding paths are resolved independently of `process.cwd()`

**Acceptance Criteria**:
- [ ] Test passes when CWD is not the project root
- [ ] Test verifies all four binding files are loaded

### Validate fix

**User Story**: As a developer, I want to verify the fix works end-to-end.

- Run typecheck
- Run unit tests
- Run UI tests

**Acceptance Criteria**:
- [ ] `bun run typecheck` passes
- [ ] `bun test test/unit/` passes (no new failures)
- [ ] `cd test/ui && uv run pytest tests/14_vim_input.py -v` passes
- [ ] Manual test: start daemon from `/tmp`, connect TUI, verify `o` and `Escape` work

## Validation Commands
- `bun run typecheck` — typecheck all source
- `bun run typecheck:src` — typecheck source only
- `bun test test/unit/` — run unit test suite (expect ≤3 pre-existing failures)
- `cd test/ui && uv run pytest tests/14_vim_input.py -v` — vim input UI test
- Manual reproduction: `cd /tmp && bun /path/to/tmax/src/server/server.ts` — verify no binding load errors in console output

## Notes
- The `bin/tmax` launcher already works around this with `cd "$PROJECT_DIR"`, but `tmax --daemon` run manually from another directory is still broken. The fix should be in the source code, not the launcher.
- The `loadBindingsFromFile` fallback at line 1521 uses `Bun.file(path)` which also resolves relative to CWD — that fallback needs the same fix.
- The `loadPaths` property on the editor (`src/tlisp/core`) may also be affected by CWD issues — consider fixing that too if it's used for file resolution.
