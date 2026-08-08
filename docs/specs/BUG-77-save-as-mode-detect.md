# Bug: `:w <file>` does not switch major mode to match the new filename

## Bug Description

When saving the current buffer to a new file with `:w <file>` (save-as), the
major mode is not re-detected from the new filename. The buffer stays in
whatever mode it had (e.g. `*scratch*`'s `fundamental-mode`), so `:w 2026-08-08.md`
leaves the buffer in `fundamental-mode` instead of `markdown-mode`.

**Expected:** `:w notes.md` activates `markdown-mode` (the mode corresponding to
the `.md` extension), mirroring Emacs `write-file`, which runs `normal-mode`.

**Actual:** The buffer stays in `fundamental-mode` after save-as.

## Problem Statement

Major-mode auto-detection (`activateMajorModeForFile`) is wired into the file
**open** paths (daemon `open` RPC at `editing.ts:125`, embedded `openOrCreateFile`/
`main.ts:246`) but into NO save path. `:w <file>` routes through
`editor-execute-command-line` (bindings-ops.ts) → `Editor.saveFile(filename)`,
which wrote the file and conditionally set `currentFilename` but never ran mode
detection. So save-as never changed the mode.

A second, related gap: `Editor.saveFile` set `model.currentFilename` but not
`bufferMetadata.filename`. Since `buffer-insert` re-derives `currentFilename`
from `bufferMetadata` on every keystroke (the BUG-58 invariant), the filename
set by save-as was silently wiped on the first edit after `:w <file>` — so even
if the mode had been detected, it would have reset to `fundamental-mode` on the
first keystroke.

## Solution Statement

In `Editor.saveFile` (`src/editor/editor.ts`), when a `filename` argument is
provided (save-as), after the save succeeds:

1. Call `this.activateMajorModeForFile(filename)` — sets `currentFilename` and
   runs `(major-mode-auto-detect)`, activating the mode matching the extension
   (e.g. `.md` → markdown).
2. Call `this.associateBufferFilename(filename)` — persists the filename in
   `bufferMetadata` so `buffer-insert` does not wipe it (BUG-58 fix for the save
   path). Without this the detected mode would reset on the first keystroke.

Plain `:w` (no filename argument) is unchanged — it keeps the mode set when the
file was opened.

## Steps to Reproduce

1. `tmax` (no file) — `*scratch*` is `fundamental-mode`.
2. Type some text.
3. `:w 2026-08-08.md` RET.
4. The status line / mode indicator stays `fundamental-mode` (expected `markdown-mode`).
5. (Before the BUG-58 part of the fix:) type another character — any mode set
   would reset because the filename was wiped on insert.

## Root Cause Analysis

- `Editor.saveFile` (editor.ts:2427) is the destination of `:w <file>`
  (via `editor-execute-command-line` → `ops.saveFile`).
- It saved and conditionally ran `SetCurrentFilename` (only when no prior
  filename existed) but never called `activateMajorModeForFile` / `(major-mode-auto-detect)`.
- It also never called `associateBufferFilename`, so `bufferMetadata.filename`
  was unset → `buffer-insert` re-derivation wiped `currentFilename`.
- Auto-detection itself works correctly (filename→mode via `auto-mode` rules);
  it just was never triggered by save-as.

## Relevant Files

- `src/editor/editor.ts` — `Editor.saveFile` (the fix: activateMajorModeForFile +
  associateBufferFilename on save-as) and `activateMajorModeForFile` (existing).
- `src/editor/api/bindings-ops.ts:79` — `:w <file>` parsing → `ops.saveFile(filename)`.
- `src/editor/api/major-mode-ops.ts` — `major-mode-auto-detect` (reads currentFilename).
- `src/tlisp/core/modes/markdown-mode.tlisp` — registers `.md`/`.markdown`/`.mdx` → markdown.
- `test/unit/save-as-mode-detect.test.ts` — pins the fix.

### Note: T-Lisp save path (write-file / save-file)

`save-buffer` in `src/tlisp/core/commands/save.tlisp` (used by `write-file` /
`save-file` / SPC f w) has the same gaps (its `set-buffer-filename` primitive
sets `model.currentFilename` but not `bufferMetadata`, and no mode detection).
This was NOT fixed here because persisting metadata from the
`set-buffer-filename` primitive requires threading a closure through the
CHORE-44 `EditorAPIContext` surface (active work). Shipping mode detection there
without the metadata fix would make the mode flicker (markdown→fundamental on
the first keystroke). Follow-up: extend `set-buffer-filename` to also update
`bufferMetadata` once the EditorAPIContext wiring is stable.

## Validation Commands

- `bun run typecheck` — clean.
- `bun run build` — succeeds.
- `bun test test/unit/save-as-mode-detect.test.ts` — 3/3 pass:
  save-as `.md` → markdown; filename survives `buffer-insert` (mode stays);
  plain save does not re-detect.

## Notes

- Emacs mode-detection mechanisms (for reference): `auto-mode-alist`
  (filename regexp → mode; covers extensions AND patterns like `Dockerfile`),
  file-local `mode:` variable (`-*- mode: foo; -*-` / `Local Variables:` block),
  magic-mode detection (`magic-mode-alist` + `magic-fallback-alist` — regexp on
  buffer content, e.g. shebangs/`<?xml`), and `default-major-mode` fallback.
  tmax currently implements only the `auto-mode-alist` equivalent (extension +
  regexp rules); the others are future work.
