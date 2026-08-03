# ADR-0167 — Editor-owned mutations via EditorAPIContext callbacks (#81 / #94)

## Status

Accepted

## Context

`src/editor/CLAUDE.md` fixes the layering: TypeScript in `src/editor/api/*.ts`
provides **primitives only**; editor **logic** lives in T-Lisp. Several Emacs-M×
gap commands (SPEC-071 `kill-buffer`, SPEC-084 `rename-buffer` / `bury-buffer`)
need a T-Lisp-callable primitive that mutates **Editor-private state** — the
`bufferMetadata` Map, buffer recency, and active-workspace capture — which is
not reachable from `createBufferOps`'s closure (the buffers Map is passed in,
but `bufferMetadata` / `updateBufferMetadata` / `touchBuffer` /
`getBufferDetails` / `captureActiveWorkspace` live on the `Editor` class).

The existing API already has the seed of a pattern: `createBufferOps` accepts
**optional callbacks** (`setCurrentFilename?`, `setBufferModified?`,
`readonlyBuffers?`) for the few facts only the Editor knows. The RPC
`kill-buffer` handler (`src/server/rpc/handlers/editing.ts`) already does the
kill correctly — re-implementing that in T-Lisp is impossible (private state)
and duplicating it in a second TS site would be the exact "two paths drift"
trap ADR-0166 closed for file-open.

## Decision

Extend the existing optional-callback pattern rather than invent a new channel.
`EditorAPIContext` carries three new optional Editor-owned callbacks —
`killBuffer?`, `renameBuffer?`, `buryBuffer?` — wired on the `Editor` (public
methods that own `bufferMetadata` / recency / workspace capture, with a
`pickKillSurvivor` helper for recency-correct survivor selection) and threaded
to `createBufferOps`. The T-Lisp-facing primitives (`buffer-kill`,
`buffer-rename`, `buffer-bury`) validate args, then **delegate to the callback
when present** and fall back to a local buffers-Map-only behavior when absent
(so the primitive stays unit-testable in isolation, like the existing
buffer-ops unit tests that drive `createBufferOps` without an `Editor`).

This keeps the architecture rule intact: the TS file is still "primitives only"
(arg validation + delegate); the Editor owns the mutation; T-Lisp owns the
command logic (the `kill-buffer` save-on-kill gate, the `rename-buffer` /
`bury-buffer` semantics).

## Consequences

- **Easier:** any future T-Lisp command that must mutate Editor-private state
  follows one established pattern — add an optional callback to
  `EditorAPIContext`, implement the Editor-owned method, delegate from the
  primitive. No second mutation site; no new IPC/event channel.
- **Easier:** the primitive is still pure-ish (callback-injected), so it keeps
  direct unit testability without an `Editor` fixture.
- **Harder:** `EditorAPIContext` grows a callback per Editor-owned mutation;
  the contract surface (frozen by CHORE-44 Step 0 as `editor-methods.txt`) must
  be re-baselined whenever an Editor method is added (done here: 93 → 101).
- The RPC `kill-buffer` case and the T-Lisp `kill-buffer` now share semantics
  by construction (both funnel through the Editor-owned `killBuffer`); a future
  refactor can have the RPC delegate to `(buffer-kill name)` so the two paths
  are literally one (not done in this change — out of scope).
