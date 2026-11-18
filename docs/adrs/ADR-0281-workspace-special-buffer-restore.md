# ADR-0281: Workspace Restore Re-Creates Missing Referenced Buffers

## Status

Accepted

## Context

Issue #264: `serializeWorkspace` deliberately excludes `*Messages*` from the persisted buffer list (it is regenerated from the log) while serializing windows verbatim — so a session saved with a window parked on `*Messages*` persists a dangling reference. On load, `dataToWorkspace` warn-and-fell-back the window to `*scratch*` (console.warn + silent rebind), and `applyWorkspace`'s name-based re-resolution made the fallback sticky even though `reconcileWorkspace` unconditionally re-creates the live `*Messages*` buffer. Observed live as `window "window-main" references unknown buffer "*Messages*", falling back to *scratch*`.

## Decision

1. **Keep the binding, not the fallback.** In `dataToWorkspace`, a window/tab reference to a named buffer missing from the persisted registry re-creates an empty buffer under that name; the miss is recorded in the existing `restoreWarnings` channel (the server surfaces those as `*Messages*` log entries) instead of `console.warn`. For `*Messages*`, `reconcileWorkspace` immediately overwrites the placeholder content with the log render; `applyWorkspace` re-resolves the window to the final instance by name. References with no name still fall back to `*scratch*`.
2. **The serialize-side exclusion stays** (pinned by test): `*Messages*` is regenerable state, and persisting it would duplicate the log.
3. Documented divergence: the twin `dataToWorkspace` in `src/server/serialize.ts` (the wire-format editor-state library, not the daemon restore path) keeps its warn-and-fallback — changing it would alter a sync wire library without an observability channel; revisit only if it gains a restore role.

## Consequences

- A restored session shows the buffer each window was parked on — including `*Messages*` (with fresh log content) — instead of silently rebinding to `*scratch*`.
- Any future buffer deliberately excluded from persistence but still bindable by windows/tabs round-trips correctly by construction (missing-by-design names are re-created empty and refilled by reconcile).
- Corrupt data referencing truly unknown names now restores empty buffers under those names with a visible warning (more faithful than rebinding to `*scratch*`, and observable either way).
- `restoreWarnings` grows entries for these misses — the server already logs them to `*Messages*`.

## Related

- [SPEC-255](../specs/SPEC-255-workspace-special-buffer-restore.md), issue #264
- [ADR-0278](ADR-0278-window-focus-context-rebind.md) (#262 — the clamp/restore family this completes), #259, #260, #261, #263
