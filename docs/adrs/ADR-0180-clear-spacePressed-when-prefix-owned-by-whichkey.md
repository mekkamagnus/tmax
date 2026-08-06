# ADR-0180 — Clear `spacePressed` once the SPC prefix is owned by `whichKeyPrefix` (#125)

## Status

Accepted

## Context

After completing an `SPC`-prefix command (e.g. `SPC x s` → `quick-save`), the
which-key popup **re-appeared ~1 s later** showing `SPC — leader`. (Latent until
ADR-0179 / #124 made the popup render in the default `tmax` launch.)

Root cause (confirmed by a fixture probe + the deterministic gate): `editor-handle-space`
(bound to `SPC`) sets the transient `editor.spacePressed = true`, and
`normal-handler.ts:239-240` then calls `schedulePrefixPopup("SPC")`, which sets
`whichKeyPrefix = "SPC"`. On the *next* key, `:172` (`if (currentPrefix)`) takes
precedence over the `else if (spaceActive)` branch (`:174-176`) — and the
`spaceActive` branch is the only place `spacePressed` is reset (`:176`). So once
`whichKeyPrefix` is set, **`spacePressed` is never cleared for the rest of the
SPC sequence.** When the sequence completes (`SPC x s` resolves at `:224-243`),
`clearWhichKey` (`:227`) clears the which-key state but not `spacePressed`; then
`:239` `if (editor.spacePressed === true)` is still true (stale remnant of the
original SPC press), so `:240` re-fires `schedulePrefixPopup("SPC")` → a new SPC
popup timer fires ~1 s later → the stale popup.

`:239-240`'s intent is legitimate — re-show the SPC popup when a command *itself*
activates the SPC leader (e.g. `editor-handle-space`). The defect is that the
stale `spacePressed` from the original press is indistinguishable from a fresh
activation once the prefix has been consumed.

## Decision

Clear the transient SPC leader as soon as the prefix is being tracked by
`whichKeyPrefix`. In `normal-handler.ts:172-173` (the `if (currentPrefix)`
branch), set `editor.spacePressed = false` (mirroring `:176`). Once
`whichKeyPrefix` owns the SPC prefix, `spacePressed` is a stale remnant and must
not survive to the `:239` completion check.

The legitimate `:239-240` path is preserved: when a command freshly sets
`spacePressed = true` (the bare-`SPC` case), that command runs at `:236` *before*
`whichKeyPrefix` is set for that press, so `:239` still sees the fresh flag and
schedules the popup. The fix only clears the flag on subsequent keys of an
already-in-progress prefix sequence.

## Consequences

- Completing an `SPC`-prefix command (`SPC x s`, `SPC x f`, `SPC ;`, …) no longer
  flashes a stale `SPC — leader` popup — verified by the deterministic gate
  (`test/unit/which-key-popup.test.ts` `#125` cases: RED before the fix,
  GREEN after) and by a live tmux run (no overlay markers after `SPC x s` + a
  >timeout wait).
- The bare-`SPC` popup still appears after the timeout (positive-control gate
  case green; eval-24's `SPC x n/p` cycling green).
- The fix is one line in the key-dispatch path; broad editor regression
  (count-prefix, vim-dispatch) and the full which-key suite (32/32) are green.
