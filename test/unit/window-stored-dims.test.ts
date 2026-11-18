/**
 * @file window-stored-dims.test.ts
 * @description Stored-dimension layout (issue #259): window-resize-height/
 * -width and balance-windows must change the RENDERED geometry — panes tile
 * the terminal honoring relative stored sizes, with #258 separator gaps.
 */

import { describe, test, expect } from "bun:test";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";
import { computeLayout } from "../../src/frontend/render/window-layout.ts";
import { renderBufferLines } from "../../src/frontend/render/buffer-lines.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Row index of the first horizontal separator in a rendered screen. */
function separatorRow(screen: string[]): number {
  for (let y = 0; y < screen.length; y++) {
    if (stripAnsi(screen[y]!).includes("─")) return y;
  }
  return -1;
}

describe("Stored-dimension layout (issue #259)", () => {
  const setup = async (): Promise<EditorFixture> => {
    const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    return createEditorFixture({ initialContent: content, bufferName: "one" });
  };

  test("a fresh split renders even panes (origin dimension halves too)", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      const state = fixture.editor.getState();
      // #260 tree semantics: a fresh split divides the frame's 23 content
      // rows at ratio 0.5 (floor-first) — cells 11 + separator + 12.
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      expect(cells.map((c) => c.height)).toEqual([11, 12]);
      expect(cells[1]!.y).toBe(12);
    } finally {
      fixture.dispose();
    }
  });

  test("window-resize-height moves the rendered separator (the live repro)", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      const before = separatorRow(renderBufferLines(fixture.editor.getState(), 80, 24));
      expect(before).toBe(11);

      interpreter.execute("(window-resize-height 10)"); // ratio 0.5 → ~0.93, min-clamped
      const after = separatorRow(renderBufferLines(fixture.editor.getState(), 80, 24));
      // #260: ratio clamps so the sibling keeps its 3-row minimum:
      // floor(23 * (1 - 3/23)) = 20 → cells [20, 3], separator at row 20.
      expect(after).toBe(20);
      const state = fixture.editor.getState();
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      expect(cells.map((c) => c.height)).toEqual([20, 3]);
      expect(cells[0]!.height + cells[1]!.height).toBe(23); // tiles exactly
    } finally {
      fixture.dispose();
    }
  });

  test("balance-windows returns the rendered layout to even", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(window-resize-height 10)");
      interpreter.execute("(window-balance)");
      const state = fixture.editor.getState();
      // #260: balance resets tree ratios to 0.5 — even cells again.
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      expect(cells.map((c) => c.height)).toEqual([11, 12]);
    } finally {
      fixture.dispose();
    }
  });

  test("resize respects the pane minimum in the rendered layout", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(window-resize-height -100)"); // ratio clamps at the MIN guard
      const state = fixture.editor.getState();
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      // #260: the ratio clamps so the resized pane keeps its 3-row minimum.
      expect(cells[0]!.height).toBeGreaterThanOrEqual(3);
      expect(cells[0]!.height).toBeLessThan(cells[1]!.height);
      expect(cells[0]!.height + cells[1]!.height).toBe(23);
    } finally {
      fixture.dispose();
    }
  });

  test("vertical splits honor stored widths", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "vertical")');
      // First window stored width 80 → origin 40, new 40.
      interpreter.execute("(window-resize-width -20)"); // ratio 0.5 → 0.5 - 20/79
      const state = fixture.editor.getState();
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      // #260: floor(79 * (0.5 - 20/79)) = floor(19.5) = 19 → [19, 60].
      expect(cells[0]!.width).toBe(19);
      expect(cells[1]!.x).toBe(cells[0]!.width + 1);
      expect(cells[0]!.width + cells[1]!.width).toBe(79);
    } finally {
      fixture.dispose();
    }
  });
});
