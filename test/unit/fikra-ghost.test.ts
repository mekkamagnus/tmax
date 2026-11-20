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

  test("the default source is none: triggers are silent no-ops", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "const totalWidth = 12")');
    e(editor, "(fikra/ghost/fikra-ghost-maybe-trigger)");
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
  });
});
