# ADR-0283: Window Hygiene — Monotonic IDs, Refuse-to-Split Minimums, Symmetric Introspection

## Status

Accepted

## Context

Issue #263: six static-review cleanups in the window-management layer, landed with the #258–#262 window arc they support. Two of the review's findings (delete-other-windows duplication, C-w chord split) were already dispositioned by #261.

## Decision

1. **Window IDs are an Editor-owned monotonic sequence** (minted via a callback into `createWindowOps`), replacing `window-${Date.now()}` — same-millisecond splits no longer collide, and the render path's ID-keyed pane lookup stays unambiguous. **Restore-safe by construction** (verify-gate round 1): `applyWorkspace` advances the sequence past the max numeric suffix among restored IDs — deterministic IDs made a cross-session collision vector possible (restore imports persisted `window-N` IDs into the live editor; a fresh counter would re-mint them) where `Date.now()` could not collide across sessions. The Editor owns the sequence precisely so the restore path can bump it.
2. **Split enforces the pane minimum by refusing**: `split-window` throws when the divided dimension < 2 × MIN (3 rows / 10 cols). Vim semantics — clamping instead would create two over-subscribed half-panes whose stored sizes sum past the parent (the exact anomaly #259 removed). The guard makes the previous post-split origin clamps redundant (both halves ≥ MIN by construction), so they are gone.
3. **Introspection is symmetric and debugging-grade**: `window-width` mirrors `window-height`; `window-list` rows widened to `(window id bufferName cursorLine cursorColumn height width)` — the fields the #258/#259 layout triage actually needed.
4. **Cosmetic**: the `split-window` docstring documents the Emacs-inherited horizontal/vertical inversion (stacked vs side-by-side) and points at the unambiguous aliases; unfocused panes pass through their stored `cursorColumn` instead of a hardcoded 0 (render output unchanged — unfocused cursors never draw).

## Consequences

- Scripted/macro splits can no longer produce duplicate pane IDs (render-path keying was the collision blast radius).
- Splitting a too-small pane now errors instead of silently degrading layout; callers scripting dense splits see a clean message.
- `window-list` consumers see 7-field rows (was 4) — the shape is additive; existing consumers reading by position beyond field 4 do not exist (the op was debugging-only).
- IDs are per-editor-instance sequence values, not globally unique — but uniqueness holds across everything living in one editor, including IDs imported by workspace restore (the sequence bumps past them).

## Related

- [SPEC-257](../specs/SPEC-257-window-hygiene-batch.md), issue #263
- [ADR-0280](ADR-0280-window-stored-dimension-layout.md) (#259 — the conserving split this tightens), [ADR-0282](ADR-0282-window-directional-navigation.md) (#261 — the dedup/consolidation disposessions), #260
