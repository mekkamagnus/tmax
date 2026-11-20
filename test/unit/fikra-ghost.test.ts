import { describe, expect, test } from "bun:test";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";

// RFC-029 §8.8 (round 1): the ghost — dim inline completion at the cursor,
// TAB accept / C-n partial / Esc dismiss, pluggable source.

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (editor: Editor, expr: string) => executeTlisp(editor, expr);

describe("#8.8 ghost text", () => {
  test("active-p reflects set/dismiss; the state carries the text", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
    e(editor, '(fikra/ghost/fikra-ghost-set " world")');
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("active");
    const state = editor.getEditorState() as { ghostText?: string };
    expect(state.ghostText).toBe(" world");
    e(editor, "(fikra/ghost/fikra-ghost-dismiss)");
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
    expect((editor.getEditorState() as { ghostText?: string }).ghostText).toBeUndefined();
  });

  test("accept inserts the ghost at the cursor and dismisses", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "hello")');
    e(editor, '(fikra/ghost/fikra-ghost-set " world")');
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-accept)").value)).toBe("true");
    expect(String(e(editor, "(buffer-text)").value)).toBe("hello world");
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
  });

  test("accept-word inserts only through the first space", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "hello")');
    e(editor, '(fikra/ghost/fikra-ghost-set " brave new world")');
    e(editor, "(fikra/ghost/fikra-ghost-accept-word)");
    expect(String(e(editor, "(buffer-text)").value)).toBe("hello brave ");
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
  });

  test("the local source completes from a matching longer line elsewhere in the buffer", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(fikra/ghost/fikra-ghost-set-source "fikra/ghost/fikra-ghost-source-local")');
    e(editor, "(buffer-insert \"const totalWidth = computeWidth(items)\\n\")");
    e(editor, "(cursor-move 1 0)");
    e(editor, "(buffer-insert \"const total\")");
    // Cursor at end of "const total" — the trigger should offer the rest.
    e(editor, "(fikra/ghost/fikra-ghost-maybe-trigger)");
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-text)").value)).toBe("Width = computeWidth(items)");
  });

  test("trigger with too-short prefix dismisses (no noise)", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(fikra/ghost/fikra-ghost-set-source "fikra/ghost/fikra-ghost-source-local")');
    e(editor, '(buffer-insert "ab")');
    e(editor, "(fikra/ghost/fikra-ghost-maybe-trigger)");
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
  });

  test("Escape-reentry cannot accept an invisible ghost (r38)", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "hello")');
    e(editor, '(fikra/ghost/fikra-ghost-set " world")');
    // The handler's Escape path (dismiss through the module):
    e(editor, "(fikra/ghost/fikra-ghost-dismiss)");
    // Re-enter insert; TAB must NOT insert anything.
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-accept) "accepted" "refused")').value)).toBe("refused");
    expect(String(e(editor, "(buffer-text)").value)).toBe("hello");
  });

  test("a moved cursor makes the ghost stale: accept refuses and clears", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "hello")');
    e(editor, '(fikra/ghost/fikra-ghost-set " world")');
    (editor as unknown as { applyUpdate: (u: unknown) => void }).applyUpdate({ type: "SetCursorPosition", position: { line: 0, column: 2 } });
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-accept) "accepted" "refused")').value)).toBe("refused");
    expect(String(e(editor, "(buffer-text)").value)).toBe("hello");
  });

  test("a multiline source sets the FIRST LINE for both display and acceptance", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "hello")');
    e(editor, '(fikra/ghost/fikra-ghost-set " first\nsecond")');
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-text)").value)).toBe(" first");
    e(editor, "(fikra/ghost/fikra-ghost-accept)");
    expect(String(e(editor, "(buffer-text)").value)).toBe("hello first");
  });

  test("the default source is none: triggers are silent no-ops", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "const totalWidth = 12")');
    e(editor, "(fikra/ghost/fikra-ghost-maybe-trigger)");
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
  });
});
