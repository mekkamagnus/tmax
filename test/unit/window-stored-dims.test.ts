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
      // Stored: origin 11 (22-11), new 11 — summing to the pre-split size.
      expect(state.windows?.[0]?.height).toBe(11);
      expect(state.windows?.[1]?.height).toBe(11);
      // Rendered: even split of 23 available rows (11 + sep + 12).
      const cells = computeLayout(state.windows!, 80, 24);
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

      interpreter.execute("(window-resize-height 10)"); // stored 11 → 21
      const after = separatorRow(renderBufferLines(fixture.editor.getState(), 80, 24));
      // Stored [21, 11] scales into 23 rows: floor(23*21/32)=15 → sep at 15.
      expect(after).toBe(15);
      const state = fixture.editor.getState();
      const cells = computeLayout(state.windows!, 80, 24);
      expect(cells.map((c) => c.height)).toEqual([15, 8]);
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
      const cells = computeLayout(state.windows!, 80, 24);
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
      interpreter.execute("(window-resize-height -100)"); // clamps at MIN 3
      const state = fixture.editor.getState();
      expect(state.windows?.[0]?.height).toBe(3);
      const cells = computeLayout(state.windows!, 80, 24);
      // Stored [3, 11] → proportional fit keeps every pane ≥ MIN 3 and the
      // small pane visibly small.
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
      interpreter.execute("(window-resize-width -20)"); // stored 20
      const state = fixture.editor.getState();
      const cells = computeLayout(state.windows!, 80, 24);
      // Available 79 columns: [20, 40] → floor(79*20/60)=26?? — proportional
      // to stored: 26 and 52, +1 remainder to last → [26, 53].
      expect(cells[0]!.width).toBe(26);
      expect(cells[1]!.x).toBe(cells[0]!.width + 1);
      expect(cells[0]!.width + cells[1]!.width).toBe(79);
    } finally {
      fixture.dispose();
    }
  });
});
