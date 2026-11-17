/**
 * @file window-focus-rebind.test.ts
 * @description Focus-switch context rebind (issue #262): switching pane
 * focus must rebind the model's buffer/cursor to the focused window's
 * record — edits land in the buffer the focused pane displays.
 */

import { describe, test, expect } from "bun:test";
import { createEditorFixture, type EditorFixture } from "../helpers/editor-fixture.ts";

/** Two stacked panes mirroring the issue repro: after split, focus moves to
 * the bottom pane, which is switched to buffer "two" with its cursor moved. */
const setupSplitOnTwo = async (): Promise<EditorFixture> => {
  const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
  const fixture = await createEditorFixture({ initialContent: content, bufferName: "one" });
  const interpreter = fixture.editor.getInterpreter();
  interpreter.execute('(split-window "horizontal")');
  interpreter.execute("(window-next)"); // focus → bottom pane
  interpreter.execute('(buffer-create "two")');
  interpreter.execute('(buffer-switch "two")');
  // "two" starts empty — seed content so cursor-move has a valid target.
  interpreter.execute('(buffer-insert "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\ntheta")');
  interpreter.execute("(cursor-move 5 3)");
  return fixture;
};

describe("Focus switch buffer/cursor rebind (issue #262)", () => {
  test("switching focus rebinds the model to the target window's buffer and cursor", async () => {
    const fixture = await setupSplitOnTwo();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute("(window-next)"); // focus → top pane (buffer "one")

      const state = fixture.editor.getState();
      const bufferText = state.currentBuffer!.getContent();
      expect(bufferText._tag).toBe("Right");
      if (bufferText._tag === "Right") {
        expect(bufferText.right).toContain("line 60"); // "one" content, not "two" (empty)
      }
      // The status-visible buffer name follows the focused pane.
      const name = interpreter.execute("(buffer-current)");
      expect(name._tag).toBe("Right");
      if (name._tag === "Right") {
        expect(name.right.value).toBe("one");
      }
      // Top window's record cursor was (0,0) when focus left it (split copies
      // the record, buffer-switch never moved the top pane's cursor).
      expect(state.cursorPosition).toEqual({ line: 0, column: 0 });
    } finally {
      fixture.dispose();
    }
  });

  test("edits land in the focused pane's buffer", async () => {
    const fixture = await setupSplitOnTwo();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute("(window-next)"); // focus top pane ("one")
      interpreter.execute('(buffer-insert "TYPED-IN-TOP-PANE")');

      const one = interpreter.execute('(buffer-text)');
      expect(one._tag).toBe("Right");
      if (one._tag === "Right") {
        expect(one.right.value).toContain("TYPED-IN-TOP-PANE");
      }
      // "two" (the unfocused pane's buffer) is untouched.
      interpreter.execute('(buffer-switch "two")');
      const two = interpreter.execute('(buffer-text)');
      expect(two._tag).toBe("Right");
      if (two._tag === "Right") {
        expect(two.right.value).not.toContain("TYPED-IN-TOP-PANE");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("the leaving window's buffer binding and cursor are persisted", async () => {
    const fixture = await setupSplitOnTwo();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute("(window-next)"); // leave the bottom pane ("two", cursor 5,3)

      const leaving = fixture.editor.getState().windows?.[1];
      expect(leaving?.bufferName).toBe("two");
      expect(leaving?.cursorLine).toBe(5);
      expect(leaving?.cursorColumn).toBe(3);
    } finally {
      fixture.dispose();
    }
  });

  test("switching back restores the target window's buffer and cursor", async () => {
    const fixture = await setupSplitOnTwo();
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute("(window-next)"); // → top ("one")
      interpreter.execute("(window-prev)"); // → bottom ("two")

      const state = fixture.editor.getState();
      expect(state.currentWindowIndex).toBe(1);
      expect(state.cursorPosition).toEqual({ line: 5, column: 3 });
      const bufferText = state.currentBuffer!.getContent();
      expect(bufferText._tag).toBe("Right");
      if (bufferText._tag === "Right") {
        expect(bufferText.right).not.toContain("line 60"); // "two" is empty
      }
    } finally {
      fixture.dispose();
    }
  });

  test("closing the focused pane rebinds the model to the survivor", async () => {
    // The verify-gate's window-close probe: closing a focused NON-last
    // window must rebind the model to the surviving window — not keep
    // editing the closed window's buffer.
    const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const fixture = await createEditorFixture({ initialContent: content, bufferName: "one" });
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")'); // [w0(one), w1(one)], focus 0
      interpreter.execute('(buffer-create "two")');
      interpreter.execute('(buffer-switch "two")'); // focused w0 → "two"
      interpreter.execute("(window-close)"); // closes focused w0; survivor w1 shows "one"

      const state = fixture.editor.getState();
      expect(state.windows?.length).toBe(1);
      expect(state.currentWindowIndex).toBe(0);
      const bufferText = state.currentBuffer!.getContent();
      expect(bufferText._tag).toBe("Right");
      if (bufferText._tag === "Right") {
        expect(bufferText.right).toContain("line 60"); // rebound to "one"
      }
      // Edits after the close land in the survivor's buffer.
      interpreter.execute('(buffer-insert "X")');
      const after = interpreter.execute('(buffer-text)');
      expect(after._tag).toBe("Right");
      if (after._tag === "Right") {
        expect(after.right.value).toContain("line 60");
        expect(after.right.value).toContain("X");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("delete-other-windows keeps the model cursor (kept record absorbed)", async () => {
    const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const fixture = await createEditorFixture({ initialContent: content, bufferName: "one" });
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(window-next)"); // focus bottom (index 1)
      interpreter.execute("(cursor-move 30 0)");
      interpreter.execute("(delete-other-windows)"); // bottom survives

      const state = fixture.editor.getState();
      expect(state.windows?.length).toBe(1);
      // The model cursor stays where the user is — the survivor's record
      // absorbed the live context instead of the restore snapping back.
      expect(state.cursorPosition).toEqual({ line: 30, column: 0 });
    } finally {
      fixture.dispose();
    }
  });

  test("a tab switch survives a focus round-trip", async () => {
    const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const fixture = await createEditorFixture({ initialContent: content, bufferName: "one" });
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute('(split-window "horizontal")');
      interpreter.execute("(window-next)"); // focus bottom
      interpreter.execute('(tab-new "notes")'); // model buffer → tab's "notes"
      interpreter.execute("(window-next)"); // round-trip away…
      interpreter.execute("(window-prev)"); // …and back

      // The tab's buffer must survive the focus round-trip (the focused
      // record was rebound by the tab switch, not left stale on "one").
      const name = interpreter.execute("(buffer-current)");
      expect(name._tag).toBe("Right");
      if (name._tag === "Right") {
        expect(name.right.value).toBe("notes");
      }
    } finally {
      fixture.dispose();
    }
  });

  test("restored cursor is clamped to the target buffer", async () => {
    // Boundary: a cursor saved on the buffer's LAST line must restore
    // exactly (not past the end), and the next insert must succeed.
    const content = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
    const fixture = await createEditorFixture({ initialContent: content, bufferName: "one" });
    try {
      const interpreter = fixture.editor.getInterpreter();
      interpreter.execute("(cursor-move 59 0)"); // last line of "one"
      interpreter.execute('(split-window "horizontal")'); // bottom record: cursor 59
      interpreter.execute("(window-next)"); // focus bottom (also "one", cursor 59)
      interpreter.execute('(buffer-create "two")');
      interpreter.execute('(buffer-switch "two")'); // bottom → "two", cursor reset
      interpreter.execute("(window-prev)"); // back to top: restores cursor 59 on "one"

      const state = fixture.editor.getState();
      const lineCount = state.currentBuffer!.getLineCount();
      expect(lineCount._tag).toBe("Right");
      if (lineCount._tag === "Right") {
        expect(state.cursorPosition.line).toBe(59);
        expect(state.cursorPosition.line).toBeLessThan(lineCount.right);
      }
      const inserted = interpreter.execute('(buffer-insert "X")');
      expect(inserted._tag).toBe("Right");
    } finally {
      fixture.dispose();
    }
  });
});
