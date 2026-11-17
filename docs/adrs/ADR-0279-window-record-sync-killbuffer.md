# ADR-0279: killBuffer Rebinds the Focused Window Record

## Status

Accepted

## Context

Issue #265 (filed from the #262 verify-gate audits): the per-window focus rebind (ADR-0278) is only correct if every model-buffer mutation rebinds the focused window record. `Editor.killBuffer` switched the model to the kill survivor without touching the record — so a focus round-trip restored the **dead** buffer into the model (`(buffer-current)` → nil, killed buffer resurrected). A regression vs pre-#262 base. The audit also flagged `createBuffer`; empirically that path was already compliant (its else-branch syncs the record in place) — the audit over-reported, and a regression test now pins it.

## Decision

1. `Editor.rebindFocusedWindowRecord(buffer, bufferName)` extracts the focused-record rebind shape (introduced inline by #262's tab callback). `killBuffer`'s survivor branch calls it; the tab-switch `switchToBuffer` callback is deduplicated onto it.
2. The remaining compliant paths — the `setCurrentBuffer` context method, `switchBufferSilent`, `createBuffer`'s else-branch — keep their own pre-existing, equivalent sync (in-place mutation with extra cursor/viewport/tab side effects specific to each; not worth churning).
3. Documented not fixed (pre-existing, outside the invariant): killing a buffer displayed by an *unfocused* window leaves that pane's record pointing at the dead buffer.

## Consequences

- Kills stick across focus round-trips; `(buffer-current)` always names a live buffer after a kill+switch sequence.
- The record-sync invariant now has a named helper for future model-buffer mutation sites; new sites should call it.
- Unfocused-pane kill liveness remains open (would need per-window buffer checks on kill or on render).

## Related

- [SPEC-253](../specs/SPEC-253-window-record-sync-kill.md), issue #265
- [ADR-0278](ADR-0278-window-focus-context-rebind.md) (#262 — the invariant), #264, #259
