/**
 * @file window-direction.test.ts
 * @description Directional window navigation (issue #261): C-w h/j/k/l move
 * focus by computeLayout cell geometry, C-w W reverse-cycles, C-w o keeps
 * only the focused pane, C-w r swaps panes. All focus changes route through
 * the #262 context rebind.
 */

import { describe, test, expect } from "bun:test";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";

describe("Directional window navigation (issue #261)", () => {
  const setup = async (lines = 60): Promise<EditorFixture> => {
    const content = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n");
    return createEditorFixture({ initialContent: content, bufferName: "one" });
  };

  test("windmove right/left across a vertical split (with buffer rebind)", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "vertical")');
      interpreter.execute('(buffer-create "two")');
      interpreter.execute('(buffer-insert "RIGHT-PANE")');
      interpreter.execute('(buffer-switch "two")'); // focused (left) pane → "two"

      interpreter.execute("(window-move-focus \"right\")");
      let state = fixture.editor.getState();
      expect(state.currentWindowIndex).toBe(1);
      // #262 rebind: the model edits the right pane's buffer ("one").
      const name = interpreter.execute("(buffer-current)");
      expect(name._tag).toBe("Right");
      if (name._tag === "Right") {
        expect(name.right.value).toBe("one");
      }

      // At the right edge: no-op, focus unchanged.
      const none = interpreter.execute("(window-move-focus \"right\")");
      expect(none._tag).toBe("Right");
      expect(fixture.editor.getState().currentWindowIndex).toBe(1);

      interpreter.execute("(window-move-focus \"left\")");
      state = fixture.editor.getState();
      expect(state.currentWindowIndex).toBe(0);
      const backName = interpreter.execute("(buffer-current)");
      expect(backName._tag).toBe("Right");
      if (backName._tag === "Right") {
        expect(backName.right.value).toBe("two");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("windmove down/up through three stacked panes", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(split-window "horizontal")'); // 3 stacked panes

      interpreter.execute("(window-move-focus \"down\")");
      expect(fixture.editor.getState().currentWindowIndex).toBe(1);
      interpreter.execute("(window-move-focus \"down\")");
      expect(fixture.editor.getState().currentWindowIndex).toBe(2);
      // Vertical directions don't jump sideways in a stacked layout.
      interpreter.execute("(window-move-focus \"right\")");
      expect(fixture.editor.getState().currentWindowIndex).toBe(2);
      interpreter.execute("(window-move-focus \"up\")");
      expect(fixture.editor.getState().currentWindowIndex).toBe(1);
    } finally {
      fixture.dispose();
    }
  });

  test("window-prev reverse-cycles (C-w W)", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(window-next)");
      interpreter.execute("(window-prev)");
      expect(fixture.editor.getState().currentWindowIndex).toBe(0);
    } finally {
      fixture.dispose();
    }
  });

  test("window-rotate swaps pane contents and keeps focus on the slot (C-w r)", async () => {
    const fixture = await setup();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute('(buffer-create "two")');
      interpreter.execute('(buffer-switch "two")'); // slot 0 → "two", slot 1 → "one"

      interpreter.execute("(window-rotate)");
      const state = fixture.editor.getState();
      // Slot 0 now holds the "one" record; slot 1 holds "two".
      expect(state.windows?.[0]?.bufferName).toBe("one");
      expect(state.windows?.[1]?.bufferName).toBe("two");
      // Focus stays on slot 0 — and the model rebound to its new occupant.
      expect(state.currentWindowIndex).toBe(0);
      const name = interpreter.execute("(buffer-current)");
      expect(name._tag).toBe("Right");
      if (name._tag === "Right") {
        expect(name.right.value).toBe("one");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("the C-w chord set is bound in normal mode", async () => {
    const fixture = await setup();
    try {
      const mappings = fixture.editor.getKeyMappings();
      const chords = ["C-w h", "C-w j", "C-w k", "C-w l", "C-w W", "C-w o", "C-w r", "C-w s", "C-w ="];
      for (const chord of chords) {
        const bound = mappings.get(chord)?.some((m) => m.mode === "normal");
        expect(bound, `expected ${chord} bound in normal mode`).toBe(true);
      }
    } finally {
      fixture.dispose();
    }
  });
});
