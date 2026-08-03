# Bug: `replace-ops` primitives mutate the buffer without marking it modified

## Goals

- After any replace primitive changes buffer text, `(buffer-modified-p)` reports `true` — consistent with `buffer-ops` insert/delete.
- Remove the T-Lisp-level workaround currently required in `(replace-string)` (SPEC-085).

## Completion Criteria (Definition of Done)

- [ ] `replace-apply-all` and `replace-apply-current` (and any other replace mutator) set the buffer-modified flag after mutating, mirroring `buffer-ops.ts`.
- [ ] The `(set-buffer-modified-p t)` workaround in `src/tlisp/core/commands/replace.tlisp` (added for SPEC-085) is removed once the primitive is fixed, and `eval-36-replace-string.yaml` still passes.
- [ ] A unit or e2e assertion that `(buffer-modified-p)` is `true` after `replace-apply-all`, **with no T-Lisp workaround**.
- [ ] `bun run typecheck:src` + `bun run test:unit` + `bun run test:tmax-use` pass.

## Bug Description

`src/editor/api/replace-ops.ts` primitives mutate the buffer (via `setCurrentBuffer`) but never set the modified flag — `grep setBufferModified src/editor/api/replace-ops.ts` is empty. `buffer-ops.ts` insert/delete **do** set it. So after a programmatic replace, the buffer text has changed but `(buffer-modified-p)` reports `false`, meaning a subsequent `save-buffer` may skip and an `editor-quit` would silently discard the change (data-loss class).

This was discovered implementing SPEC-085 (`replace-string`): the DoD criterion "(buffer-modified-p) is true after the replace" failed until an explicit `(set-buffer-modified-p t)` was added to the T-Lisp command. Per the architecture rule (`src/editor/CLAUDE.md`: "TypeScript provides primitives ONLY … T-Lisp owns logic"), the primitive that owns the mutation should own the modified flag — the T-Lisp workaround is a smell, not the fix.

## Problem Statement

Inconsistent modified-flag bookkeeping between `buffer-ops` (sets it) and `replace-ops` (doesn't). Any future T-Lisp command composing `replace-apply-*` will silently produce an un-saved buffer unless it independently remembers to flip the flag.

## Solution Statement

In `replace-ops.ts`, set the buffer-modified flag in every mutator (`replace-apply-all`, `replace-apply-current`, and any sibling) the same way `buffer-ops.ts` does after insert/delete. Then delete the `(set-buffer-modified-p t)` line from `replace.tlisp` and confirm `eval-36` stays green.

## Relevant Files

- `src/editor/api/replace-ops.ts` — `replace-apply-all` (≈:460), `replace-apply-current`, `replace-state-init`; add the modified-flag set.
- `src/editor/api/buffer-ops.ts` — the `setBufferModified(true)` pattern to mirror.
- `src/tlisp/core/commands/replace.tlisp` — SPEC-085 workaround line to remove after the fix.
- `tmax-use/playbooks/eval-36-replace-string.yaml` — regression.

## Severity / Notes

- **Priority:** medium. Silent data-loss vector (replace then quit discards). T-Lisp workaround exists, so not blocking, but the primitive inconsistency is the real defect.
