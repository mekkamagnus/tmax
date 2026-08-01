# Bug: save-buffer / quick-save / save-file chain broken; SPC x s undefined

## Bug Description
The T-Lisp save commands were dead landmines:
- `save-buffer` errored on `(set-buffer-modified-p nil)` — `set-buffer-modified-p`
  rejected `nil` (type "nil") as not-a-boolean, though nil is the Emacs false.
- `quick-save` (bound to **SPC x s**) was an undefined symbol.
- `save-file` was referenced in `documentation.ts` and RFC-002 but undefined.

The primary `:w` path (TS `file-save`) worked, but the T-Lisp save commands and
SPC x s threw. (The underlying `when`/`unless`/`return-from`/`write-file-content`
were fixed by #42/#45; this issue wires the save chain together.)

## Problem Statement
`save-buffer`/`quick-save`/`save-file` must save the buffer, and SPC x s must work.

## Solution Statement
1. **`set-buffer-modified-p`** accepts `nil` as the false boolean (Emacs convention)
   — `save-buffer` does `(set-buffer-modified-p nil)`.
2. **`quick-save`** and **`save-file`** added to `save.tlisp` as thin wrappers over
   `save-buffer` (and exported). `SPC x s` → `(quick-save)` now resolves.
3. `documentation.ts`'s `save-file` examples are now valid (the symbol exists).

Codex APPROVE-WITH-CONCERNS honored: thin quick-save/save-file wrappers around
save-buffer; async-written-bytes/filename assertions; the no-argument case uses
the associated filename. RFC-002's save command is already `save-buffer`, so no
RFC churn.

## Steps to Reproduce
```bash
tmax -e '(save-buffer "/tmp/x")'   # today: set-buffer-modified-p error
tmax -e '(quick-save)'             # today: Undefined symbol: quick-save
# normal mode: SPC x s            # today: Undefined symbol: quick-save
```

## Root Cause Analysis
`set-buffer-modified-p` used `validateArgType(arg, "boolean")` which rejects nil
(type "nil"); `quick-save`/`save-file` were never defined.

## Relevant Files
- `src/editor/api/buffer-ops.ts` — `set-buffer-modified-p` accepts nil.
- `src/tlisp/core/commands/save.tlisp` — `quick-save`/`save-file` wrappers + export.
- `test/integration/save-chain.test.ts` — round-trip: insert → save-buffer → file on disk.

## Step by Step Tasks
### Task 1 — set-buffer-modified-p accepts nil
**AC**: `(set-buffer-modified-p nil)` succeeds (was: "requires a boolean").
### Task 2 — quick-save / save-file wrappers
**AC**: `(quick-save)` and `(save-file path)` resolve + save the buffer; SPC x s no longer throws Undefined symbol.
### Task 3 — round-trip test
**AC**: insert text → `(save-buffer path)` → the file on disk contains the text.
### Task 4 — Validate
typecheck clean + tests green + verify-gate PASS.

## Validation Commands
- `bun run typecheck:src`
- daemon: `(save-buffer "/tmp/x")` writes the file; `(quick-save)`/`(save-file path)` work.
- `bun test test/integration/save-chain.test.ts`

## Notes
- Depends on #42 (when/unless/return-from) + #45 (write-file-content) — both landed.
- `save-file`'s existence also validates the `documentation.ts:234,258` examples (no doc edit needed).
