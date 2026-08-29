/**
 * @file flash-region.test.ts
 * @description SPEC-231 (#231): vim-goggles flash feedback.
 * Covers: the flash-region primitive (set + TTL clear + supersede + arg
 * validation), the state field flowing to the render contract, the
 * capture-frame render merge, and the T-Lisp hooks (yank/delete/paste paths).
 */

import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
  bufferText,
  createStartedEditor,
  executeTlisp,
} from "../helpers/editor-fixture.ts";
import { captureFrame } from "../../src/render/capture-frame.ts";
import { editorStateToJson, jsonToEditorState } from "../../src/server/serialize.ts";
import { mergeFlashSpans } from "../../src/client/tui-client.ts";
import type { HighlightSpan } from "../../src/core/contracts/editor.ts";

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

const flashOf = (editor: Editor): unknown => editor.getState().flashSpans;

describe("SPEC-231: flash-region primitive", () => {
  test("sets flashSpans for the region and clears after the TTL", async () => {
    const editor = await createStartedEditor("hello world");
    executeTlisp(editor, `(flash-region 0 0 0 4 30)`);
    const spans = flashOf(editor) as { start: number; end: number }[][];
    expect(spans).toBeDefined();
    expect(spans[0]![0]!.start).toBe(0);
    expect(spans[0]![0]!.end).toBe(5);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(flashOf(editor)).toBeUndefined();
  });

  test("a new flash supersedes an in-flight one", async () => {
    const editor = await createStartedEditor("hello world\nsecond");
    executeTlisp(editor, `(flash-region 0 0 0 1 500)`);
    executeTlisp(editor, `(flash-region 1 0 1 3 500)`);
    const spans = flashOf(editor) as unknown[][];
    expect(spans.length).toBe(2);       // absolute: padded to line 1
    expect(spans[0]!.length).toBe(0);   // first flash gone
    expect(spans[1]!.length).toBe(1);   // only the second flash is live
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(flashOf(editor)).toBeDefined(); // still the second flash
    await new Promise((resolve) => setTimeout(resolve, 520));
    expect(flashOf(editor)).toBeUndefined();
  });

  test("rejects wrong arity and non-number args", async () => {
    const editor = await createStartedEditor("x");
    expect(() => executeTlisp(editor, `(flash-region 0 0)`)).toThrow();
    expect(() => executeTlisp(editor, `(flash-region 0 "a" 0 1)`)).toThrow();
  });

  test("capture-frame renders the flash (merge over syntax spans)", async () => {
    const editor = await createStartedEditor("hello world");
    executeTlisp(editor, `(flash-region 0 0 0 4 500)`);
    const plain = captureFrame({ ...editor.getState(), flashSpans: undefined }, 40, 5);
    const flashed = captureFrame(editor.getState(), 40, 5);
    expect(flashed[0]).not.toBe(plain[0]); // ANSI codes differ on the flashed line
  });

  test("spans are indexed ABSOLUTELY by buffer line (verify-gate A)", async () => {
    const editor = await createStartedEditor("aaa\nbbb\nccc");
    executeTlisp(editor, `(flash-region 2 0 2 2 500)`);
    const spans = flashOf(editor) as { start: number }[][];
    expect(spans.length).toBe(3);       // padded: lines 0 and 1 empty
    expect(spans[0]!.length).toBe(0);
    expect(spans[1]!.length).toBe(0);
    expect(spans[2]![0]!.start).toBe(0);
    // The RENDERED gray block is on the "ccc" row, not on line 0.
    const plain = captureFrame({ ...editor.getState(), flashSpans: undefined }, 20, 6);
    const flashed = captureFrame(editor.getState(), 20, 6);
    expect(flashed[0]).toBe(plain[0]);  // line 0 untouched
    const diffIdx = flashed.findIndex((l, i) => l !== plain[i]);
    expect(diffIdx).toBeGreaterThan(0);
    expect(plain[diffIdx]).toContain("ccc");
   });

  test("flashSpans survives the serialize → client round-trip (verify-gate B)", async () => {
    const editor = await createStartedEditor("hello");
    executeTlisp(editor, `(flash-region 0 0 0 3 500)`);
    const json = editorStateToJson(editor.getState());
    const round = jsonToEditorState(JSON.parse(JSON.stringify(json)));
    expect(round.flashSpans).toBeDefined();
    expect(round.flashSpans![0]![0]!.start).toBe(0);
  });

  test("the TUI client's span merge (mergeFlashSpans) composes base + flash", () => {
    const base: HighlightSpan[][] = [[{ start: 0, end: 2, style: { bold: true } }], []];
    const flash: HighlightSpan[][] = [[], [{ start: 0, end: 1, style: { bg: "#555555" } }]];
    const merged = mergeFlashSpans(base, flash);
    expect(merged).toBeDefined();
    expect(merged![0]).toHaveLength(1); // syntax span preserved
    expect(merged![1]).toHaveLength(1); // flash appended on line 1
    expect(merged![1]![0]!.style.bg).toBe("#555555");
    expect(mergeFlashSpans(base, undefined)).toBe(base); // no flash → base
  });

  test("merge does NOT truncate base spans below the flash (gate retry 3)", () => {
    const base: HighlightSpan[][] = [
      [],
      [],
      [{ start: 0, end: 3, style: { bold: true } }], // syntax BELOW the flash
    ];
    const flash: HighlightSpan[][] = [[{ start: 0, end: 1, style: { bg: "#555555" } }]];
    const merged = mergeFlashSpans(base, flash)!;
    expect(merged.length).toBe(3);       // max(base, flash) — not 1
    expect(merged[2]).toHaveLength(1);   // line-2 syntax span survives
  });

  test("yy flashes the yanked line extent (tail-applied path)", async () => {
    const editor = await createStartedEditor("alpha\nbeta");
    executeTlisp(editor, `(cursor-move 1 0)`);
    await press(editor, "yy");
    const spans = flashOf(editor) as { start: number; end: number }[][];
    expect(spans).toBeDefined();
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(spans[1]![0]!.start).toBe(0);
    expect(spans[1]![0]!.end).toBe(4);   // "beta" (absolute line index)
  });

  test("a hook's flash clears after the TTL with no keypress (yank path)", async () => {
    const editor = await createStartedEditor("hello world");
    executeTlisp(editor, `(cursor-move 0 0)`);
    await press(editor, "yiw"); // text-object yank hook (default 300 ms TTL)
    expect(flashOf(editor)).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 380));
    expect(flashOf(editor)).toBeUndefined();
  });

  test("unsupported operator combos flash NOTHING (verify-gate retry 2)", async () => {
    const editor = await createStartedEditor("hello world");
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(vim-begin-operator "d")`);
    await press(editor, "z"); // dz — unsupported; must not flash a phantom cut
    expect(flashOf(editor)).toBeUndefined();
    expect(bufferText(editor)).toBe("hello world");
  });
});

describe("SPEC-231: operator hooks", () => {
  test("yiw flashes the yanked word", async () => {
    const editor = await createStartedEditor("hello world");
    executeTlisp(editor, `(cursor-move 0 1)`);
    await press(editor, "yiw");
    const spans = flashOf(editor) as { start: number; end: number }[][];
    expect(spans).toBeDefined();
    expect(spans[0]![0]!.start).toBe(0); // cursor sat at the word start
    expect(spans[0]![0]!.end).toBe(5);   // "hello" length
    expect(bufferText(editor)).toBe("hello world"); // yank did not mutate
  });

  test("diw flashes the cut site", async () => {
    const editor = await createStartedEditor("hello world");
    executeTlisp(editor, `(cursor-move 0 1)`);
    await press(editor, "diw");
    expect(bufferText(editor)).toBe(" world");
    const spans = flashOf(editor) as { start: number; end: number }[][];
    expect(spans).toBeDefined();
    expect(spans[0]![0]!.start).toBe(0);
  });

  test("x flashes the cut site", async () => {
    const editor = await createStartedEditor("hello");
    await press(editor, "x");
    expect(bufferText(editor)).toBe("ello");
    expect(flashOf(editor)).toBeDefined();
  });

  test("vi\"y flashes the selection via the visual binding", async () => {
    const editor = await createStartedEditor('say "hello" there');
    executeTlisp(editor, `(cursor-move 0 5)`);
    await press(editor, 'vi"');
    await press(editor, "y");
    const spans = flashOf(editor) as { start: number; end: number }[][];
    expect(spans).toBeDefined();
    expect(spans[0]![0]!.start).toBe(5);
    expect(spans[0]![0]!.end).toBe(10); // "hello"
  });

  test("visual d flashes the cut site", async () => {
    const editor = await createStartedEditor('say "hello" there');
    executeTlisp(editor, `(cursor-move 0 5)`);
    await press(editor, 'vi"');
    await press(editor, "d");
    expect(bufferText(editor)).toBe('say "" there');
    expect(flashOf(editor)).toBeDefined();
  });

  test("p flashes the pasted extent", async () => {
    const editor = await createStartedEditor("one two");
    executeTlisp(editor, `(cursor-move 0 0)`);
    await press(editor, "yiw");
    executeTlisp(editor, `(cursor-move 0 4)`);
    await press(editor, "p");
    // pasted "one" after col 4: flash spans the inserted word
    const spans = flashOf(editor) as { start: number; end: number }[][];
    expect(spans).toBeDefined();
    expect(spans[0]![0]!.end).toBeGreaterThan(spans[0]![0]!.start);
  });

  test("vi\"p flashes the inserted range (#230 + #231 integration)", async () => {
    const editor = await createStartedEditor('say "hello" out\nsecond');
    executeTlisp(editor, `(cursor-move 1 0)`);
    await press(editor, "yiw");
    executeTlisp(editor, `(cursor-move 0 5)`);
    await press(editor, 'vi"');
    await press(editor, "p");
    expect(bufferText(editor)).toBe('say "second" out\nsecond');
    const spans = flashOf(editor) as { start: number; end: number }[][];
    expect(spans).toBeDefined();
  });
});
describe("SPEC-231: count-paste flash", () => {
  test("3p flashes exactly three copies of the register", async () => {
    const editor = await createStartedEditor("ab--");
    executeTlisp(editor, `(cursor-move 0 0)`);
    await press(editor, "yiw");            // "ab"
    executeTlisp(editor, `(cursor-move 0 2)`);
    executeTlisp(editor, `(vim-paste-after 3)`); // inserts at col 3
    const spans = flashOf(editor) as { start: number; end: number }[][];
    expect(spans).toBeDefined();
    const s = spans[0]![0]!;
    expect(s.end - s.start).toBe(6);       // 3 copies of "ab"
  });
});
