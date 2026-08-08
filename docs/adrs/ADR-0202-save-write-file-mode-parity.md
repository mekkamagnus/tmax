# ADR-0202 — Save/write-file mode detection + filename persistence (`#172` / SPEC-105)

## Status

Accepted

## Context

BUG-77 fixed the TS `:w <file>` path (`Editor.saveFile`) to re-detect the major
mode from the new filename and persist it in `bufferMetadata`. The T-Lisp save
path (`save-buffer` / `save-file` / `write-file` — `SPC f w`, `M-x write-file`)
was deferred because its `set-buffer-filename` primitive sets only
`model.currentFilename`, not `bufferMetadata`, and `bufferMetadata` is private
to the Editor (not reachable from `createBufferOps`'s closure). So save-as via
`write-file` neither detected the mode nor survived the first edit (`buffer-insert`
re-derives `currentFilename` from `bufferMetadata` each keystroke — BUG-58).

## Decision

Brought the T-Lisp save path to parity with the TS path, using the established
**optional threaded-callback** pattern (same as `killBuffer`/`renameBuffer`/
`buryBuffer`):

1. **`EditorAPIContext.associateBufferFilename?`** — a new optional field. The
   Editor wires it to `editor.associateBufferFilename` (which calls
   `updateBufferMetadata({ filename })`).
2. **`set-buffer-filename`** — `createBufferOps` takes the new closure and
   `set-buffer-filename` calls `associateBufferFilename?.(path)` right after
   `setCurrentFilename(path)`. Absent closure → unchanged (local-only). Wired at
   the `tlisp-api.ts` call site via `ctx.associateBufferFilename`.
3. **`save-buffer`** — added `(when filename (major-mode-auto-detect))` after
   `set-buffer-filename`, so save-as re-detects the mode. `save-file` /
   `write-file` are thin wrappers, so all three inherit it.

### Why this is safe for the CHORE-44 baseline

The CHORE-44 baseline freezes the **`createEditorAPI` method inventory** (the
API map's keys). Adding a field to `EditorAPIContext` is purely additive — it
adds no API method/key, so the inventory is unchanged. (A pre-existing, unrelated
static-vs-live drift in that baseline test is not affected by this change —
confirmed identical on clean main.)

## Consequences

- `(write-file "x.md")` / `(save-file "x.md")` / `(save-buffer "x.md")` activate
  `markdown-mode`, exactly like `:w x.md`.
- The filename (and detected mode) survive the first `buffer-insert` after
  save-as (BUG-58 metadata invariant now holds for the T-Lisp path).
- Plain `(save-buffer)` (no filename) does NOT re-detect — bulk-save callers
  (`quick-save`, `save-some`, `save-all`) pass no filename and are unaffected.
- `set-buffer-filename` is now the single correct filename-association primitive
  across the T-Lisp layer (mirrors the TS path's `associateBufferFilename` +
  `activateMajorModeForFile` in `Editor.saveFile`).

## Verification

`bun run typecheck` clean; `bun run build` succeeds;
`bun test test/unit/save-as-mode-detect.test.ts` → 5/5 pass (TS + T-Lisp paths +
filename-survives-insert); `test/unit/server-start-editor.test.ts` → 3/3
(EditorAPIContext wiring sanity).
Verify-gate (adversarial, 2-agent) verdict: **PASS**.
