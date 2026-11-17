# Bug Fix: killBuffer Leaves the Focused Window Record Stale — Focus Round-Trip Resurrects the Killed Buffer (#265)

## Goal

Every model-buffer mutation must rebind the focused window record (the #262 record-sync invariant, ADR-0278). Killing the current buffer must stick across focus round-trips.

GitHub issue: #265 (window-management, bug — filed from the #262 verify-gate audits)

## Problem Statement

`Editor.killBuffer` switches the model to the recency-correct survivor (`SetCurrentBuffer` + filename) but never rebinds the focused window record. The record keeps pointing at the killed buffer, so after a `window-next`/`window-prev` round-trip the switchWindow restore rebinds the model to the **dead** buffer object: `(buffer-current)` returns nil and the killed buffer is effectively resurrected in the model. Regression vs pre-#262 base (base never rebound on focus switch, so the kill stuck). Verified empirically by a red test before the fix.

The same audit flagged `Editor.createBuffer` as a hole; empirically it is **not** one — its else-branch already syncs the focused record in place (the gate over-reported; a regression test now pins the invariant for the create path regardless).

## Solution

1. Extract `Editor.rebindFocusedWindowRecord(buffer, bufferName)` — the focused-record rebind shape introduced inline by #262's tab callback — and call it from `killBuffer`'s survivor branch and the tab-switch `switchToBuffer` callback (deduplicated). The other compliant paths (`setCurrentBuffer` context method, `switchBufferSilent`, `createBuffer`'s else-branch) keep their own pre-existing, equivalent sync.
2. Known remaining edge, documented not fixed (pre-existing, outside the invariant): killing a buffer still displayed by an *unfocused* window leaves that record pointing at the dead buffer.

Out of scope: per-window buffer liveness on kill (unfocused windows), #259, #260, #261, #264.

## Completion Criteria

1. After killing the focused pane's buffer and round-tripping focus (`window-next` + `window-prev`), the model still edits the survivor: `(buffer-current)` names the survivor and the killed name is absent from `(buffer-list)` — verified by `test/unit/window-record-sync.test.ts` ("killing the current buffer survives a focus round-trip"; red before the fix, green after).
2. `Editor.createBuffer` (the model-switching create path — T-Lisp `buffer-create` only registers) keeps the focused record in sync: a create-then-round-trip leaves the model on the created buffer — verified by `test/unit/window-record-sync.test.ts` ("creating a buffer survives a focus round-trip").
3. No regressions: `test/unit/window-focus-rebind.test.ts` (8, incl. the tab round-trip now routed through the extracted helper), `test/unit/window-viewport.test.ts` (7, #258), `window-splitting`, `window-resizing`, and the full unit gate pass; `bun run typecheck:src` + `typecheck:test` are clean.
