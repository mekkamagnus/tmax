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

describe("#8.8 ghost — real key dispatch + renderer (r39)", () => {
  test("Escape → re-enter insert → Tab does NOT accept (real handler keys)", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "hello")');
    const ed = editor as unknown as { handleKey: (k: string) => Promise<unknown> };
    await ed.handleKey("i");             // the Escape path lives in the INSERT handler
    e(editor, '(fikra/ghost/fikra-ghost-set " world")');
    await ed.handleKey("Escape");        // leaves insert, dismisses through the module
    await ed.handleKey("i");             // re-enter insert
    await ed.handleKey("Tab");           // must NOT insert the dismissed ghost
    // (Tab falls through to insert-tab — a literal tab is acceptable; the
    // GHOST text must not appear.)
    expect(String(e(editor, "(buffer-text)").value)).not.toContain("world");
    const state = editor.getEditorState() as { ghostText?: string };
    expect(state.ghostText).toBeUndefined();
  });

  test("a PREFIX edit invalidates even back at the exact anchor (content check, isolated)", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "hello world")');
    const upd0 = (editor as unknown as { applyUpdate: (u: unknown) => void }).applyUpdate.bind(editor);
    upd0({ type: "SetCursorPosition", position: { line: 0, column: 5 } });
    e(editor, '(fikra/ghost/fikra-ghost-set "!!!")');   // anchors at column 5, prefix "hello"
    // Same-length PREFIX edit (hello -> hellO): returning to column 5
    // keeps COORDINATES valid; only the content differs.
    const upd = (editor as unknown as { applyUpdate: (u: unknown) => void }).applyUpdate.bind(editor);
    upd({ type: "SetCursorPosition", position: { line: 0, column: 4 } });
    e(editor, '(buffer-insert "O")');
    e(editor, '(buffer-delete 1)');
    upd({ type: "SetCursorPosition", position: { line: 0, column: 5 } });
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-accept) "accepted" "refused")').value)).toBe("refused");
  });

  test("a SUFFIX edit does NOT invalidate (the stated product boundary)", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, '(buffer-insert "hello world")');
    const upd = (editor as unknown as { applyUpdate: (u: unknown) => void }).applyUpdate.bind(editor);
    upd({ type: "SetCursorPosition", position: { line: 0, column: 5 } });
    e(editor, '(fikra/ghost/fikra-ghost-set "!!!")');
    upd({ type: "SetCursorPosition", position: { line: 0, column: 11 } });
    e(editor, '(buffer-insert "X")');
    upd({ type: "SetCursorPosition", position: { line: 0, column: 5 } });
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-accept) "accepted" "refused")').value)).toBe("accepted");
    expect(String(e(editor, "(buffer-text)").value)).toBe("hello!!! worldX");
  });

  test("the renderer draws the ghost ONLY at its anchor, keeping the suffix", async () => {
    const { renderBufferLines } = await import("../../src/frontend/render/buffer-lines.ts");
    const buf = {
      getLine: (n: number) => ({ _tag: "Right", right: n === 0 ? "hello world" : "" }),
      getLineCount: () => ({ _tag: "Right", right: 3 }),
      getContent: () => ({ _tag: "Right", right: "hello world" }),
    };
    const base = {
      currentBuffer: buf, viewportTop: 0, viewportLeft: 0,
      config: { wordWrap: false }, activeMinorModes: [], windows: undefined,
    };
    const anchored = renderBufferLines(
      { ...base, cursorPosition: { line: 0, column: 5 }, ghostText: " WIDE", ghostAnchor: { line: 0, column: 5 } } as never,
      60, 5) as unknown as string[];
    expect(anchored[0]).toContain("hello");
    expect(anchored[0]).toContain("WIDE");
    expect(anchored[0]).toContain("world"); // mid-line suffix preserved
    // Moved cursor (column 2): the ghost does NOT render.
    const moved = renderBufferLines(
      { ...base, cursorPosition: { line: 0, column: 2 }, ghostText: " WIDE", ghostAnchor: { line: 0, column: 5 } } as never,
      60, 5) as unknown as string[];
    // The cursor cell's ANSI breaks contiguous "hello" — assert on the
    // ghost's absence and the suffix's presence.
    expect(moved[0]).toContain("world");
    expect(moved[0]).not.toContain("WIDE");
  });
});

describe("#8.8 ghost - pre-1.4 width fallback (r41)", () => {
  test("the fallback keeps ANSI sequences whole and never exceeds the width", async () => {
    const { _fallbackCells } = await import("../../src/frontend/render/width.ts");
    const E = "\u001b";
    const styled = E + "[31mabc" + E + "[0m";
    const s1 = _fallbackCells.sliceCells(styled, 0, 1);
    expect(s1).not.toContain("[");
    expect(_fallbackCells.cellWidth(s1)).toBeLessThanOrEqual(1);
    expect(_fallbackCells.sliceCells("\u4e2da", 0, 1)).toBe("");
    expect(_fallbackCells.sliceCells("a\u4e2d", 0, 2)).toBe("a");
    expect(_fallbackCells.sliceCells("a" + E + "[31mb" + E + "[0mc", 1, 2)).toContain(E + "[31m");
  });
});

describe("#8.8 ghost — the ollama source (r89)", () => {
  const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");
  const LINE = "const total = items.";

  async function armed(editor: Editor, prefix = LINE): Promise<void> {
    e(editor, '(require-module "fikra/ghost")');
    e(editor, `(buffer-insert "${prefix}")`);
    e(editor, `(fikra/ghost/fikra-ghost-ollama-seed 7 "${prefix}" "http://127.0.0.1:1")`);
  }

  test("the landed response sets the ghost (echo-stripped) + the latency footer", async () => {
    const editor = await createStartedEditor("");
    await armed(editor);
    // The full body arrives as one hex chunk; completion follows.
    e(editor, `(fikra/ghost/fikra-ghost-http-filter 7 "${hex(JSON.stringify({ response: LINE + ".reduce((a,b)=>a+b, 0)" }))}")`);
    e(editor, `(fikra-http-complete 7 200 "${hex("{}")}")`);
    // The ghost is the REMAINDER (the prefix echo stripped), anchored here.
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-text)").value)).toBe(".reduce((a,b)=>a+b, 0)");
    expect(String(e(editor, "(editor-status)").value)).toContain("ollama (local,");
    expect(String(e(editor, "(editor-status)").value)).toContain("ms)");
  });

  test("a non-echoing response passes through whole", async () => {
    const editor = await createStartedEditor("");
    await armed(editor);
    e(editor, `(fikra/ghost/fikra-ghost-http-filter 7 "${hex(JSON.stringify({ response: " reduce" }))}")`);
    e(editor, `(fikra-http-complete 7 200 "${hex("{}")}")`);
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-text)").value)).toBe(" reduce");
  });

  test("the cursor moved off the prefix: the late landing DISCARDS (no stale ghost)", async () => {
    const editor = await createStartedEditor("");
    await armed(editor);
    e(editor, "(cursor-move 0 0)"); // away from the end-of-line anchor
    e(editor, `(fikra/ghost/fikra-ghost-http-filter 7 "${hex(JSON.stringify({ response: ".reduce(x)" }))}")`);
    e(editor, `(fikra-http-complete 7 200 "${hex("{}")}")`);
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
  });

  test("a dead server reports honestly in the footer", async () => {
    const editor = await createStartedEditor("");
    await armed(editor, "x.");
    e(editor, `(fikra-http-complete 7 0 "${hex("connect refused")}")`);
    expect(String(e(editor, "(editor-status)").value)).toContain("ollama (unavailable");
    expect(String(e(editor, '(if (fikra/ghost/fikra-ghost-active-p) "active" "inactive")').value)).toBe("inactive");
  });

  test("the tags reply adopts the first model (the /api/tags default)", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, `(fikra/ghost/fikra-ghost-ollama-seed 8 "items." "http://127.0.0.1:1")`);
    e(editor, `(fikra/ghost/fikra-ghost-http-filter 8 "${hex(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "gemma3:12b" }] }))}")`);
    e(editor, `(fikra-http-complete 8 200 "${hex("{}")}")`);
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-ollama-model-get)").value)).toBe("qwen3:8b");
  });

  test("SPC a o cycles the source and the binding is registered", async () => {
    const editor = await createStartedEditor("");
    e(editor, '(require-module "fikra/ghost")');
    e(editor, "(require-module fikra/mode)");
    expect(JSON.stringify(e(editor, '(key-binding "SPC a o" "normal")').value)).toContain("fikra-ghost-cycle-source");
    // none -> local -> ollama -> none (the fn returns the source name;
    // the STATUS carries the human label).
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-cycle-source)").value)).toContain("local");
    expect(String(e(editor, "(editor-status)").value)).toContain("Fikra ghost: local");
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-cycle-source)").value)).toContain("ollama");
    expect(String(e(editor, "(fikra/ghost/fikra-ghost-cycle-source)").value)).toContain("none");
    expect(String(e(editor, "(editor-status)").value)).toContain("Fikra ghost: off");
  });
});
