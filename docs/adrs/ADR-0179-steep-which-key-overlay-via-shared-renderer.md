# ADR-0179 — Steep renders which-key via the shared `captureFrame` renderer (#124 / BUG-24)

## Status

Accepted

## Context

The which-key popup never appeared in the default `tmax` launch (the embedded
Steep frontend), even though the popup **state + data were correct** for every
prefix (`SPC`/`g`/`z`/`C-w`) and the daemon TUI + capture renderers painted it.
Two compounding defects (investigated by Codex, filed in #124):

1. **Missing overlay.** `src/steep/assam.ts`'s `render()` closure duplicated the
   daemon capture frame logic (tab + buffer + command/minibuffer + status) but
   **omitted the `renderWhichKeyOverlay` block** that `src/render/capture-frame.ts`
   and `src/client/tui-client.ts` include. A DRY violation — Steep and capture
   drifted apart, and Steep silently dropped the overlay.
2. **Untestable render.** `render()` was a private closure inside `run()`, so
   **no unit test exercised Steep's render path**. The only which-key tests
   covered the shared overlay renderer or the daemon-capture path — which is why
   this stayed hidden as a **false green** (`tmax-use/playbooks/which-key.yaml`
   passes via headless daemon-capture, never exercising Steep).

This is [BUG-24](../specs/BUG-24-which-key-normal-launch.md)'s exact defect —
whose claimed fix commit `ad62108` is not a valid git object; the implementation
never landed on `main`.

## Decision

Fix both layers: make Steep's frame **testable** and make it **delegate** to the
single shared renderer.

1. **Extract** Steep's frame content into a pure, exported
   `renderSteepFrame(state, width, height): string[]` (`src/steep/render-frame.ts`).
   `SteepFrontend.run()`'s `render()` now calls it, writes the rows to `Screen`,
   and positions the cursor separately. The frame content is now unit-testable
   with no terminal/tmux/daemon/timing.
2. **Delegate** `renderSteepFrame` to the existing shared `captureFrame`
   (`src/render/capture-frame.ts`), which already renders the identical layout
   **including the which-key overlay**. Steep's frame layout is provably identical
   to the capture frame (tab → buffer → command/minibuffer → status at `height-1`,
   overlay at the bottom of the buffer area), so delegation is behavior-preserving
   and inherits the overlay. This collapses the DRY violation to a single source
   of truth — Steep can no longer diverge from the daemon renderers.

The **deterministic verification gate** is `test/unit/steep-which-key.test.ts`: a
pure-function test that drives `renderSteepFrame` with `whichKeyActive: true` +
populated `whichKeyPopup` fixtures (`SPC`/`g`/`C-w`) and asserts the popup header
+ a binding appear in the output, plus a negative (`whichKeyActive: false` → no
overlay). It exercises the exact render path that was broken, not a substitute
renderer. It was **RED on the pre-fix `renderSteepFrame`** (no overlay block) and
**GREEN after delegation** — proving it is not a false green.

Also fixed two stale `C-w` unit assertions (`test/unit/which-key-popup.test.ts`,
8 → 9 bindings: `C-w =` balance-windows was added by SPEC-084).

## Consequences

- `tmax` (Steep) now paints the which-key popup for `SPC`/`g`/`z`/`C-w`/…,
  matching the daemon/TUI. The shared `captureFrame` is the single source of
  truth for the frame, so a future Steep/capture divergence cannot silently drop
  an element.
- Steep's render is now directly unit-testable (`renderSteepFrame`); the
  `steep-which-key` gate locks the overlay behavior. The "works in TUI, broken in
  Steep" class of false green is closed for this path.
- **Out of scope (follow-ups from #124):** the `launch: normal` tmax-use harness +
  `which-key-normal-launch.yaml` (real-TUI regression), the source-current
  `scripts/link.sh` (`bin/tmax` not `dist/tmax`), and the broader "which-key.yaml
  falls back to daemon-capture" false-green in the harness. These remain open in
  #124 as follow-ups; the deterministic gate is the load-bearing protection.
