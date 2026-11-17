# ADR-0278: Focus Switch Rebinds the Model's Full Editing Context

## Status

Accepted

## Context

Issue #262 (priority:high, data-loss-adjacent): after `C-w s` + switching one pane to another buffer, focusing a pane never rebound anything — `window-next`/`window-prev` only patched `currentWindowIndex`. Buffer/cursor sync was strictly one-way model → window record (`setCurrentBuffer` context method, `setCursorLine`/`setCursorColumn`, `switchBufferSilent` all mutate the *focused* record); nothing restored window → model. The model kept the *previous* pane's buffer, so keystrokes edited the unfocused pane's buffer while the focused pane (rendering `state.currentBuffer`) displayed the typed text live — the user's text could end up visible nowhere.

Same root as #258 (two sources of truth, half-synced). ADR-0277 landed `Editor.switchWindow` as the focus-switch seam and named it the insertion point for this fix.

## Decision

`switchWindow` is now a **full context rebind**, not just a viewport sync:

1. **Persist on leave** — the leaving window's record receives the model's editing context: `buffer` + `bufferName` (`findBufferName`), `cursorLine`/`cursorColumn` from `model.cursorPosition`, alongside ADR-0277's viewport persist. This heals the partially-synced records too (`cursor-move` writes the model cursor without touching records; the leave-save overwrites the record from the model at every switch, and unfocused panes never read their record cursor for rendering).
2. **Restore on entry** — the model receives the target window's record: `SetCurrentBuffer(target.buffer)`, `SetCurrentFilename` from `bufferMetadata`, `SetCursorPosition`, focus, then the #258 viewport restores. Buffer semantics deliberately match `buffer-switch` (buffer + filename metadata; no major-mode re-derivation, no recency touch — `switchBufferSilent` skips both too), except the cursor is **restored from the window record** (per-window cursor memory, emacs `window-point` style) instead of `buffer-switch`'s (0,0) reset.
3. **Defensive clamp** — the restored line is clamped to the target buffer's line count (the #127 out-of-bounds-insert class). No current primitive can make a record stale against its own buffer (records only rebind while focused, and `buffer-switch` resets the cursor), so the clamp guards future paths (e.g. workspace restore, #264) rather than a live bug.
4. **Buffer-aware no-op + close rebind** (verify-gate round 1): the #258 same-index no-op is refined — a same-index call no-ops only when the model already edits the target window's buffer, so `window-close` (which now unconditionally routes the surviving window's index through the switch port) rebinds even when the survivor occupies the closed pane's slot. The leave-save is likewise conditioned on the leaving record's buffer matching the model's, so a survivor sliding into the leaving index keeps its own record context. Closing a focused non-last window previously left the model editing the *closed* window's buffer — the same #262 class.
5. **The record-sync invariant is now explicit** (verify-gate round 2): per-window rebind is only correct if *every* model-buffer mutation rebinds the focused window record. The `setCurrentBuffer` context method and `switchBufferSilent` always did; the tab-switch `switchToBuffer` callback now does too (a tab switch previously left the focused record stale, and the next focus round-trip silently undid it), and `delete-other-windows` absorbs the model's live cursor/viewport into the surviving record before the switch port restores from it (the collapse previously snapped the model cursor back to the record's last-saved position).

Deliberately out of scope: per-buffer major-mode activation on switch (matches existing `buffer-switch`), buffer-name display vs full-path lookup (issue "bonus"), #259 (stored dimensions), #260 (layout tree), #261 (directional navigation), #264 (workspace restore rebind).

## Consequences

- Typing while a pane is focused always edits the buffer that pane displays; the status line's buffer name and Ln/Col follow the focused pane.
- Each pane remembers its buffer, cursor, and viewport across focus round-trips (the "shared editing context with drifting bindings" model is gone at the switch seam).
- `window-close`/`delete-other-windows` now also rebind: after closing the focused window, the model adopts the surviving window's context instead of silently keeping the closed window's buffer — strictly more correct.
- `switchWindow` remains the single insertion point for future focus-switch concerns (directional navigation #261 can route through it).
- ADR-0277's caveat about the saved viewport using the stored height still applies (approximation until #259).

## Related

- [SPEC-252](../specs/SPEC-252-window-focus-rebind.md), issue #262
- [ADR-0277](ADR-0277-window-viewport-model-authoritative.md) (#258 — the seam this extends), #259, #260, #261, #264
