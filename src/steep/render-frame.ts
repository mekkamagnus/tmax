/**
 * @file render-frame.ts
 * @description Pure frame renderer for the Steep frontend — a thin, named seam
 *   over the shared `captureFrame` renderer so that:
 *   (1) `SteepFrontend.run()`'s `render()` closure no longer duplicates frame
 *       logic inline (the DRY violation that let it silently drop the which-key
 *       overlay — BUG-24 / issue #124);
 *   (2) Steep's frame has a stable, unit-testable entry point
 *       (`test/unit/steep-which-key.test.ts` exercises this directly — not the
 *       daemon-capture false green that hid the bug).
 *
 *   Steep's frame layout (tab + buffer + command/minibuffer + status, with the
 *   which-key overlay at the bottom of the buffer area) is identical to the
 *   daemon capture frame, so this delegates to `captureFrame` — one source of
 *   truth, no Steep/capture divergence.
 */

import type { EditorState } from "../core/contracts/editor.ts";
import { captureFrame } from "../render/capture-frame.ts";

/**
 * Render the Steep frame content into an array of ANSI-encoded lines (one per
 * screen row). Pure: no terminal, no I/O. `SteepFrontend.run()` writes these
 * rows to its `Screen` and then positions the cursor separately. Includes the
 * which-key popup overlay when `state.whichKeyActive && state.whichKeyPopup`.
 */
export function renderSteepFrame(state: EditorState, width: number, height: number): string[] {
  return captureFrame(state, width, height);
}
