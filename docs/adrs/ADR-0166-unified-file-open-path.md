# ADR-0166 — One Editor-owned file-open path (#80)

## Status

Accepted

## Context

BUG-58's deepest cause (per ADR-0163 / CHORE-69) was that there were **two
file-open bootstrap paths that drifted**: `src/main.ts` (CLI) and
`Editor.openFile()` (daemon `open` RPC). `openFile` recorded the filename in
`bufferMetadata`; `main.ts` did not — so the first `buffer-insert` wiped
`currentFilename` and `:w` saved nothing. Even after BUG-58's point fix
(`associateBufferFilename` in main.ts), the two paths remained separate copies
of the same logic, free to diverge again.

## Decision

Collapse the shared part into ONE Editor-owned primitive so the
filename→buffer association has a single definition:

- **`Editor.attachFileBuffer(filename, content)`** (private) — the single
  post-read setup: `createBuffer` + `SetCurrentFilename` +
  `associateBufferFilename` (which writes `bufferMetadata`). Does NOT activate
  the major mode (callers do that once core bindings are loaded).
- **`Editor.openOrCreateFile(filename)`** — the CLI-friendly primitive
  (`tmax file.md`): reads the file; on success loads its content, on ENOENT
  creates an empty "new file" buffer. Either way it routes through
  `attachFileBuffer`. A missing file is NOT an error here (CLI semantics).
- **`Editor.openFile()`** (daemon RPC) — refactored to call `attachFileBuffer`
  for its buffer/metadata setup, but KEEPS its distinct read-failure semantics
  (a failed read leaves the previous buffer intact; it does not create a
  new-file buffer) plus its LSP/diagnostics work.

`src/main.ts` now calls `openOrCreateFile` instead of doing its own
`createBuffer` + `SetCurrentFilename` + `associateBufferFilename`.

The key distinction (codex): the CLI must *create* a buffer for a missing file,
while the daemon RPC must *not* clobber the current buffer on a failed open —
so we did NOT blindly route main.ts through `openFile`. Both share only the
buffer/metadata setup, which is the part that drifted.

## Consequences

- One definition of "attach a file to a buffer" (`attachFileBuffer`); the CLI
  and daemon paths can no longer drift on filename metadata.
- `test/unit/editor-open-file.test.ts` pins the invariant at the shared
  primitive: `currentFilename` survives `buffer-insert` for both existing and
  new files, and both save correctly.
- The #77 embedded e2e (the black-box net over `main.ts`) stays green after
  the refactor; all daemon save tests stay green (`openFile` behavior
  preserved).
- No src behavior change for end users — pure consolidation.

Spec: [CHORE-69](../specs/CHORE-69-reliable-test-harness.md) (Issue B). Issue: #80.
