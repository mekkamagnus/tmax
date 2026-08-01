# ADR-0163 — Buffer→filename association is part of every file-open path (#76)

## Status

Accepted

## Context

`:w` in the embedded editor (`tmax file.md`) wrote nothing to disk. Investigation
(BUG-58) traced it to a structural property of how buffers carry their filename:

- A buffer's filename lives in `bufferMetadata[name].filename`, **not** on the
  buffer object and **not** solely in the model's `currentFilename` field.
- `buffer-insert` replaces the current buffer with a fresh immutable instance on
  every keystroke, then calls `setCurrentBuffer`, whose setter **re-derives**
  `currentFilename` from `bufferMetadata[currentBufferName]?.filename`
  (`editor.ts` ~351-354). So `currentFilename` is a *derived projection* of the
  buffer's metadata, refreshed on every mutation — it is not authoritative.
- `(buffer-filename)` and `save-buffer` read that derived field. If the metadata
  has no filename, the first keystroke nils `currentFilename` and `save-buffer`
  bails with "Buffer has no associated file".

`openFile` set the metadata (`updateBufferMetadata(name, { filename })`), so the
daemon/client path worked. But the `main.ts` bootstrap (CHORE-44 Change 10) and
`createBuffer` did not — they only seeded `{ modified, recency }`. The two paths
had silently diverged, and nothing enforced the invariant that *a buffer opened
from a file must record its filename in metadata*.

A second, independent defect compounded it: `server.ts startEditor()` ran
`(buffer-switch "*scratch*")` unconditionally on `cleanStart=true` (which
`main.ts` always passes for the embedded editor), discarding the opened file
before any keystroke.

## Decision

1. **Treat filename association as a required step of every file-open path.**
   Added `Editor.associateBufferFilename(filename)` as the single primitive that
   records the filename in `bufferMetadata` for the current buffer (mirroring what
   `openFile` already did inline). The `main.ts` bootstrap now calls it right
   after `createBuffer` + `SetCurrentFilename`, so both file-open paths converge
   on the same metadata state.

2. **`cleanStart` means "skip workspace restore", not "force `*scratch`".** The
   `--clean` `buffer-switch "*scratch*")` is now guarded by
   `!currentFilename` — it only fires when no file was opened (the bare `tmax`
   case). The embedded editor always uses `cleanStart=true` because it never
   restores a workspace; that must not clobber a file the user named on the CLI.

3. **`Editor.start()` is idempotent on `coreBindingsLoaded`.** The Steep frontend
   (`assam.ts:96`) calls `editor.start()` after `server.startEditor()` already
   loaded core bindings + init file + macros. Re-running `loadInitFile`/
   `loadSavedMacros` is wasted work and can have side effects; the second call now
   short-circuits to flipping `running = true`. First-call behavior is unchanged.

## Consequences

- `currentFilename` is now stable across edits in **both** the daemon/client and
  embedded paths; `:w` resolves the file in both.
- **Forward-looking rule:** any new code path that creates a buffer from a file
  MUST call `associateBufferFilename` (or route through `openFile`). A buffer
  whose metadata lacks a filename will silently lose its filename on the first
  `buffer-insert`. This is the durable trap; it is documented in BUG-58 and
  memory.
- Bare `tmax` still shows the splash and forces `*scratch` (the guard lets the
  switch through when `currentFilename` is unset).
- The model's `currentFilename` remains a derived projection; we did **not**
  change `setCurrentBuffer`'s re-derivation. Making `currentFilename`
  authoritative on the buffer would be a larger change deferred for later if more
  divergence appears.

Verified: typecheck clean; buffer-metadata/server-save-file/server-serialization/
editor/buffer unit tests pass; tmux e2e (`i`→type→`Esc`→`:w` writes the file) and
direct socket (`(buffer-filename)` survives insert, `(save-buffer)` ⇒ "Saved …").

Spec: [BUG-58](../specs/BUG-58-embedded-w-save-no-filename.md). Issue: #76.
