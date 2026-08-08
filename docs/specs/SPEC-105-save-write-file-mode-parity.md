# Feature: Save-as mode detection + filename persistence in the T-Lisp save path

## Feature Description

Bring the T-Lisp save path (`save-buffer` / `save-file` / `write-file`, reached
by `:w` via the T-Lisp dispatcher, `SPC f w`, and `M-x write-file`) to parity
with the TS path (`Editor.saveFile`, fixed in BUG-77 for `:w <file>`).

Today the T-Lisp path has two gaps:
1. **No mode detection on save-as** — `save-buffer` calls `set-buffer-filename`
   but never `major-mode-auto-detect`, so `write-file notes.md` from a
   `*scratch*` buffer leaves it in `fundamental-mode`.
2. **No metadata persistence** — `set-buffer-filename` sets `model.currentFilename`
   but NOT `bufferMetadata.filename`, so `buffer-insert` (which re-derives the
   filename on every keystroke — the BUG-58 invariant) wipes it on the first edit,
   resetting the mode.

## Goals

- `M-x write-file notes.md` (and `(save-file "notes.md")`, `(save-buffer "notes.md")`)
  activates `markdown-mode`, exactly like `:w notes.md` (BUG-77).
- The detected mode SURVIVES edits: after `write-file notes.md` + typing, the
  buffer stays in `markdown-mode` (no flicker, no reset to fundamental).
- `set-buffer-filename` becomes the one correct filename-association primitive:
  it sets BOTH `model.currentFilename` AND `bufferMetadata.filename`.

## User Story

As a user, I want every save-as entry point to behave the same: `:w f.md`,
`SPC f w f.md`, and `M-x write-file f.md` all switch to the right mode and keep
it while I keep editing.

## Problem Statement

BUG-77 fixed `Editor.saveFile` (the `:w <file>` path) but explicitly deferred
the T-Lisp path because persisting metadata from the `set-buffer-filename`
primitive requires threading a closure through the CHORE-44 `EditorAPIContext`
surface (active work at the time). Until that's done, the T-Lisp save-as path is
inconsistent: it either doesn't detect the mode, or (if detection is added
without metadata) the mode flickers to fundamental on the first keystroke.

## Solution Statement

1. **Persist metadata in `set-buffer-filename`** — thread an
   `associateBufferFilename?: (filename: string) => void` closure through
   `createBufferOps` (`src/editor/api/buffer-ops.ts`) and wire it at the call
   site (`src/editor/tlisp-api.ts`) to `editor.associateBufferFilename`. The
   primitive calls it after `setCurrentFilename`. This makes the filename
   survive `buffer-insert` (BUG-58 invariant) for ALL `set-buffer-filename`
   callers.
2. **Detect mode on save-as in `save-buffer`** — add `(when filename
   (major-mode-auto-detect))` after `set-buffer-filename` in
   `src/tlisp/core/commands/save.tlisp`. Combined with (1), the detected mode
   persists across edits.
3. **Parity test** — extend `test/unit/save-as-mode-detect.test.ts` to cover the
   T-Lisp path, including an edit after save-as.

## Relevant Files

- `src/editor/api/buffer-ops.ts` — `set-buffer-filename` primitive (call the new
  closure) + `createBufferOps` signature (add the optional param).
- `src/editor/tlisp-api.ts` — `createBufferOps` call site (wire
   `editor.associateBufferFilename`).
- `src/editor/runtime/editor-api-context.ts` — add `associateBufferFilename` to
  the context (the CHORE-44 surface; coordinate with that work).
- `src/editor/editor.ts` — `associateBufferFilename` (existing method; no change).
- `src/tlisp/core/commands/save.tlisp` — `save-buffer` (add mode detection on
  save-as).
- `test/unit/save-as-mode-detect.test.ts` — add T-Lisp-path coverage.

### New Files
- None (extends existing files + the BUG-77 test).

## Implementation Plan

### Phase 1: Thread the metadata closure
Add `associateBufferFilename?: (filename: string) => void` to `createBufferOps`.
In `set-buffer-filename`, call it after `setCurrentFilename(path)`. Wire it from
`tlisp-api.ts` (via `EditorAPIContext`) to `editor.associateBufferFilename`.

### Phase 2: Mode detection in save-buffer
Add `(when filename (major-mode-auto-detect))` after `(set-buffer-filename path)`
in `save-buffer`. Now that the primitive persists metadata, the mode survives edits.

### Phase 3: Parity tests
Extend `save-as-mode-detect.test.ts`: `(save-buffer "x.md")` → markdown; then
`(buffer-insert "z")` → still markdown; `currentFilename` still `x.md`.

## Step by Step Tasks

### Task 1: set-buffer-filename persists metadata
**User Story**: As a developer, the filename primitive should be the one correct
association point.
- Add the closure param to `createBufferOps`; call it in `set-buffer-filename`.
- Wire `editor.associateBufferFilename` via `EditorAPIContext`.

**Acceptance Criteria**:
- [ ] After `(set-buffer-filename "x.md")` + `(buffer-insert "z")`,
      `(buffer-filename)` is still `"x.md"` (BUG-58 invariant holds).
- [ ] Existing `set-buffer-filename` callers behave unchanged when the closure
      is absent (optional param).

### Task 2: save-buffer detects mode on save-as
**User Story**: As a user, `write-file` / `save-file` switch mode like `:w`.
- Add `(when filename (major-mode-auto-detect))` to `save-buffer`.

**Acceptance Criteria**:
- [ ] `(save-buffer "x.md")` → `markdown-mode`
- [ ] After `(buffer-insert "z")`, mode is STILL `markdown-mode` (no flicker)
- [ ] Plain `(save-buffer)` (no filename) does NOT re-detect (unchanged)

### Task 3: Validation
- `bun run typecheck`, `bun run build`
- `bun test test/unit/save-as-mode-detect.test.ts` (now covers both paths)
- `bun test test/unit/server-start-editor.test.ts` (EditorAPIContext wiring sanity)

## Testing Strategy

### Unit Tests
Extend `save-as-mode-detect.test.ts`:
- `(save-buffer "x.md")` → markdown (T-Lisp path parity with BUG-77).
- `(save-buffer "x.md")` + `(buffer-insert "z")` → still markdown + filename intact.
- Plain `(save-buffer)` keeps the current mode.

### Edge Cases
- save-as onto a buffer that ALREADY has a filename (rename) — re-associates
  and re-detects for the new name.
- save-as with an extension that maps to no mode → falls to default-major-mode
  (SPEC-104) / fundamental, no error.

## Acceptance Criteria (Completion)
- [ ] `set-buffer-filename` persists `bufferMetadata.filename` (filename survives
      `buffer-insert`).
- [ ] `save-buffer`/`save-file`/`write-file` with a filename re-detect the mode.
- [ ] The detected mode survives subsequent edits (no reset to fundamental).
- [ ] `:w <file>` (BUG-77 TS path) and `write-file` (T-Lisp path) behave identically.
- [ ] CHORE-44 `EditorAPIContext` / `createEditorAPI` baseline stays consistent.

## Validation Commands
- `bun run typecheck`
- `bun run build`
- `bun test test/unit/save-as-mode-detect.test.ts`
- `bun run test:unit --dots 2>/dev/null | tail -5` (no new regressions)
- Manual: `tmax`, `SPC f w note.md`, type — buffer stays in `markdown-mode`.

## Notes
- This is the documented follow-up from BUG-77 (`docs/specs/BUG-77-save-as-mode-detect.md`).
- The only non-trivial part is the `EditorAPIContext` wiring, which must stay in
  sync with the CHORE-44 baseline (frozen `createEditorAPI` count). Adding a
  field to `EditorAPIContext` does not change the API function count.
- After this lands, `set-buffer-filename` becomes the correct single chokepoint
  for filename association across the T-Lisp layer, matching how the TS path
  uses `associateBufferFilename` + `activateMajorModeForFile` in `Editor.saveFile`.
