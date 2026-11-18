/**
 * @file window-tree.test.ts
 * @description Issue #260: the binary split tree — mixed-axis splits nest
 * (a vertical split divides the FOCUSED pane's frame, not the whole
 * screen), closes collapse siblings into the freed frame, ratios persist
 * across workspace save/load, and resize/balance operate on tree ratios.
 */

import { describe, test, expect } from "bun:test";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";
import { renderBufferLines } from "../../src/frontend/render/buffer-lines.ts";
import { computeLayout } from "../../src/core/window-layout.ts";
import { WorkspaceManager } from "../../src/core/workspace.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const setup = async (): Promise<EditorFixture> => {
  const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
  return createEditorFixture({ initialContent: content, bufferName: "one" });
};

describe("Window layout tree (issue #260)", () => {
  test("the live repro: C-w s then C-w v nests inside the focused pane", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")'); // stacked [top, bottom]
      interpreter.execute('(split-window "vertical")'); // split the FOCUSED (top) pane

      const state = fixture.editor.getState();
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      // Top frame (rows 0-10, height 11) divides into two side-by-side
      // columns; the bottom pane keeps the FULL width below the row
      // separator. Pre-#260 this re-flowed every pane into 3 columns.
      expect(cells.length).toBe(3);
      const top1 = cells.find((c) => c.windowId === "window-main")!;
      const top2 = cells.find((c) => c.windowId === "window-2")!;
      const bottom = cells.find((c) => c.windowId === "window-1")!;
      expect(top1.y).toBe(0);
      expect(top2.y).toBe(0);
      expect(top1.height).toBe(top2.height);
      expect(top1.x + top1.width + 1).toBe(top2.x); // column separator between them
      expect(bottom.y).toBe(top1.height + 1);
      expect(bottom.width).toBe(80); // the un-split sibling keeps full width
      expect(bottom.height).toBe(12);
    } finally {
      fixture.dispose();
    }
  });

  test("rendered: the bottom pane spans the full width under two columns", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(split-window "vertical")');
      const screen = renderBufferLines(fixture.editor.getState(), 80, 24).map(stripAnsi);
      // Row separator under the top frame (after the top frame's height).
      const rowSep = screen.findIndex((r) => r.includes("─"));
      expect(rowSep).toBe(11);
      // The bottom pane renders full-width: the top frame's column
      // separator does NOT reach it (skip each pane's own gutter bar at
      // column 3 when locating the separator column).
      const columnSep = screen[0]!.indexOf("│", 4);
      expect(columnSep).toBeGreaterThan(4);
      expect(screen[23]![columnSep]).not.toBe("│");
      expect(screen[23]!.includes("line")).toBe(true);
    } finally {
      fixture.dispose();
    }
  });

  test("closing a pane collapses its sibling into the freed frame", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(split-window "vertical")'); // top frame: [main | w1]
      interpreter.execute("(window-next)"); // focus w1 (the second column)
      interpreter.execute("(window-close)");

      const state = fixture.editor.getState();
      expect(state.windows?.length).toBe(2);
      // window-main re-expands to the full top frame (the split collapsed).
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      const main = cells.find((c) => c.windowId === "window-main")!;
      expect(main.width).toBe(80);
      expect(main.height).toBe(11);
    } finally {
      fixture.dispose();
    }
  });

  test("resize and balance operate on tree ratios", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(split-window "vertical")'); // nested top columns

      // Resize the focused top pane's WIDTH (its enclosing vertical split).
      interpreter.execute("(window-resize-width 10)");
      let state = fixture.editor.getState();
      let cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      const main = cells.find((c) => c.windowId === "window-main")!;
      // Top frame content width 79: ratio 0.5 + 10/79 → floor(79*0.6266) = 49.
      expect(main.width).toBe(49);

      // Balance resets every split ratio: columns even again.
      interpreter.execute("(window-balance)");
      state = fixture.editor.getState();
      cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      const mainAfter = cells.find((c) => c.windowId === "window-main")!;
      expect(mainAfter.width).toBe(39); // floor(79/2)
    } finally {
      fixture.dispose();
    }
  });

  test("the tree persists across a workspace save/load round-trip", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(split-window "vertical")');
      interpreter.execute("(window-resize-width 10)"); // non-default ratio
      const saved = fixture.editor.exportWorkspace();

      const { mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const manager = new WorkspaceManager(mkdtempSync(join(tmpdir(), "tmax-ws-260-")));
      await manager.save(saved).run();
      const loaded = await manager.load(saved.metadata.name).run();
      expect(loaded._tag).toBe("Right");
      if (loaded._tag !== "Right") return;

      const restored = fixture.editor.getState();
      fixture.editor.applyWorkspace(loaded.right);
      // The restored tree preserves structure AND the resized ratio.
      const state = fixture.editor.getState();
      expect(state.windowLayout).toBeDefined();
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      const main = cells.find((c) => c.windowId === (restored.windows?.[0]?.id || "window-main"))!;
      expect(main.width).toBe(49);
    } finally {
      fixture.dispose();
    }
  });

  test("directional navigation crosses the nested frames", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(split-window "vertical")'); // focus top-left
      // right → top-right; down → bottom (full-width pane below).
      interpreter.execute('(window-move-focus "right")');
      expect(fixture.editor.getState().currentWindowIndex).toBe(1);
      interpreter.execute('(window-move-focus "down")');
      const state = fixture.editor.getState();
      expect(state.currentWindowIndex).toBe(2);
      const cells = computeLayout(state.windows!, 80, 24, state.windowLayout);
      const focused = cells.find((c) => c.windowId === state.windows![2]!.id)!;
      expect(focused.width).toBe(80);
    } finally {
      fixture.dispose();
    }
  });
});
