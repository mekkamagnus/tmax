/**
 * @file window-hygiene.test.ts
 * @description Issue #263 hygiene batch: unique monotonic window IDs, the
 * window-balance arity message, window-width + enriched window-list
 * introspection, and split minimum enforcement.
 */

import { describe, test, expect } from "bun:test";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";

const setup = async (): Promise<EditorFixture> => {
  const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
  return createEditorFixture({ initialContent: content, bufferName: "one" });
};

describe("Window hygiene (issue #263)", () => {
  test("rapid splits produce unique window IDs (no Date.now collisions)", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      // Same-millisecond splits (scripted): all four IDs must be distinct.
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(split-window "vertical")');
      interpreter.execute('(split-window "horizontal")');
      const ids = fixture.editor.getState().windows?.map((w) => w.id) ?? [];
      expect(ids.length).toBe(5);
      expect(new Set(ids).size).toBe(5);
    } finally {
      fixture.dispose();
    }
  });

  test("window-balance arity error names the primitive, not the alias", async () => {
    const fixture = await setup();
    try {
      const result = fixture.editor.getInterpreter().execute("(window-balance 1)");
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        const message = String((result.left as { message?: unknown }).message ?? result.left);
        expect(message).toContain("window-balance takes no arguments");
        expect(message).not.toContain("balance-windows");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("window-width reads a window's stored width", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "vertical")'); // [40, 40] on 80 cols
      const w0 = interpreter.execute("(window-width 0)");
      expect(w0._tag).toBe("Right");
      if (w0._tag === "Right") {
        expect(w0.right.value).toBe(40);
      }
      const missing = interpreter.execute("(window-width 9)");
      expect(missing._tag).toBe("Left");
    } finally {
      fixture.dispose();
    }
  });

  test("window-list exposes bufferName and dimensions", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      const listResult = interpreter.execute("(window-list)");
      expect(listResult._tag).toBe("Right");
      if (listResult._tag === "Right" && Array.isArray(listResult.right.value)) {
        const rows = listResult.right.value as { value: { value: unknown }[] }[];
        expect(rows.length).toBe(2);
        for (const row of rows) {
          const fields = row.value.map((v) => v.value);
          // (window id bufferName cursorLine cursorColumn height width)
          expect(fields[0]).toBe("window");
          expect(typeof fields[1]).toBe("string");
          expect(fields[2]).toBe("one");
          expect(typeof fields[5]).toBe("number"); // height
          expect(typeof fields[6]).toBe("number"); // width
        }
      }
    } finally {
      fixture.dispose();
    }
  });

  test("split-window refuses to halve below the pane minimum", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      // Shrink the focused pane to 4 rows (< 2 * MIN_HEIGHT 3), then split.
      interpreter.execute('(split-window "horizontal")'); // [11, 11] stored
      interpreter.execute("(window-resize-height -8)"); // focused pane → 3
      const refused = interpreter.execute('(split-window "horizontal")');
      expect(refused._tag).toBe("Left");
      if (refused._tag === "Left") {
        const message = String((refused.left as { message?: unknown }).message ?? refused.left);
        expect(message).toContain("too small to split");
      }
      expect(fixture.editor.getState().windows?.length).toBe(2);
    } finally {
      fixture.dispose();
    }
  });

  test("a post-restore split cannot mint a duplicate of a restored ID", async () => {
    // Gate round 1: deterministic window-N IDs + workspace restore re-creating
    // persisted IDs verbatim — a fresh editor (seq 0) restoring window-1/
    // window-2 and splitting would re-mint window-1, duplicating. The
    // restored IDs are deliberately LOW so the counter's first mints collide
    // without the applyWorkspace sequence bump (mutation-checked).
    const fixture = await setup();
    try {
      const { TextBufferImpl } = await import("../../src/core/buffer.ts");
      const scratch = TextBufferImpl.create("");
      const pane = (id: string) => ({
        id, buffer: scratch, bufferName: "one", cursorLine: 0, cursorColumn: 0,
        viewportTop: 0, viewportLeft: 0, height: 11, width: 80,
      });
      fixture.editor.applyWorkspace({
        metadata: { id: "ws-h", name: "hygiene", createdAt: "", lastAccessed: "", formatVersion: 1 },
        buffers: new Map([["one", fixture.editor.getState().currentBuffer!]]),
        bufferMetadata: new Map(),
        bufferModeStates: new Map(),
        windows: [pane("window-main"), pane("window-1"), pane("window-2")],
        tabs: [],
        cursorState: { line: 0, column: 0 },
        viewportState: { top: 0 },
        currentBufferName: "one",
      } as never);

      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      const ids = fixture.editor.getState().windows?.map((w) => w.id) ?? [];
      expect(ids.length).toBe(4);
      // With the bump, the split mints window-3; without it, window-1 — a
      // duplicate of the restored pane.
      expect(new Set(ids).size).toBe(4);
    } finally {
      fixture.dispose();
    }
  });
});
