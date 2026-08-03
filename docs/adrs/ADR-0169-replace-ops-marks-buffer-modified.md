# ADR-0169 — `replace-ops` marks the buffer modified on mutation (#111 / BUG-62)

## Status

Accepted

## Context

`src/editor/api/replace-ops.ts` primitives (`replace-apply-all`, `replace-apply-current`)
mutated the buffer via `setCurrentBuffer(insertResult.right)` but **never set the
modified flag**, unlike `buffer-ops.ts` (which calls `setBufferModified?.(true)` after
every insert/delete). So after a programmatic replace, `(buffer-modified-p)` read
**clean** while the buffer text had changed — a subsequent `save-buffer` would skip and
an `editor-quit` would silently discard the change (data-loss class).

During SPEC-085 (`replace-string`) this was papered over with an explicit
`(set-buffer-modified-p t)` in the T-Lisp command — but the architecture rule
(`src/editor/CLAUDE.md`: "TypeScript provides primitives ONLY … T-Lisp owns logic")
puts the mutation in TS, so the modified flag is TS's responsibility, not the caller's.
The workaround also meant any future T-Lisp command composing `replace-apply-*` would
silently produce an un-saved buffer unless it independently remembered to flip the flag.

## Decision

Mirror the existing `buffer-ops` optional-callback pattern: `createReplaceOps` gains an
optional `setBufferModified?: (flag: boolean) => void` parameter (4th arg, optional so
existing callers/tests stay compatible), and **every mutation site calls
`setBufferModified?.(true)`** immediately after `setCurrentBuffer(insertResult.right)`
— at the single-replace op and at `replace-apply-current` (which `replace-apply-all`
loops over, so both paths are covered). Wired at the `tlisp-api.ts` call site with
`(modified) => ctx.setBufferModified?.(modified)`, identical to how `createBufferOps`
is wired.

The T-Lisp `(set-buffer-modified-p t)` workaround in `replace.tlisp` is **removed** —
the primitive now owns the flag. A unit regression
(`query-replace.test.ts`: "replace-apply-all marks the buffer modified (BUG-62/#111)")
drives `createReplaceOps` with a tracking callback and asserts `true` is recorded, so
the fix cannot silently regress.

## Consequences

- **Easier:** `(buffer-modified-p)` is truthful after any replace — consistent with
  `buffer-ops`. No data-loss-on-quit window for replaced buffers. Every future
  T-Lisp command composing `replace-apply-*` is correct by default.
- **Easier:** the awkward T-Lisp-level flag flip is gone; one place (the primitive)
  owns the side effect.
- **Harder:** `createReplaceOps` gains a parameter; the public-inventory baseline
  is unaffected (no new primitive name — the callback is a wiring detail). The
  contract surface (`editor-methods.txt`) is unchanged.
- The flag is set on the **first** mutation of an apply-all loop and re-set each
  iteration; harmless (idempotent `true`).
