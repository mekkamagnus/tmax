# ADR-0156 — save-buffer / quick-save / save-file chain repaired (#49)
## Status: Accepted
## Context
The T-Lisp save commands were dead landmines: `save-buffer` errored on
`(set-buffer-modified-p nil)` (nil is type "nil", rejected by the boolean
validator); `quick-save` (bound to **SPC x s**) and `save-file` (referenced in
`documentation.ts`) were undefined. The primary `:w` path worked, but the T-Lisp
save commands and SPC x s threw. The underlying `when`/`unless`/`return-from`/
`write-file-content` were fixed by #42/#45; this issue wires the chain together.

## Decision
1. **`set-buffer-modified-p`** (`buffer-ops.ts`) accepts `nil` as the false
   boolean (Emacs convention) — skips the boolean `validateArgType` when the arg
   is type "nil" and sets the flag to `false`. Non-nil args still require type
   "boolean".
2. **`quick-save`** and **`save-file`** added to `save.tlisp` as thin exported
   wrappers over `save-buffer` (no-arg uses the buffer's associated filename).
   `SPC x s` → `(quick-save)` now resolves.
3. Defining `save-file` validates the `documentation.ts:234,258` examples (no doc
   edit needed).

## Consequences
- `save-buffer`/`save-file` write real bytes to disk; `quick-save` saves to the
  associated file; SPC x s works; `(set-buffer-modified-p nil)` succeeds; the
  modified flag flips false after save (verify-gate confirmed via a live test).
- Integration test `test/integration/save-chain.test.ts` (3/3): insert marker →
  save-buffer → file contains it; quick-save/save-file resolve; nil accepted.
- Unblocks #51 (Emacs symbol aliases) via AUTO-UNBLOCK.

Spec: [BUG-43](../specs/BUG-43-save-chain-repair.md). Issue: #49.
Verify-gate: PASS.
