import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStartedEditor, executeTlisp, bufferText } from "../helpers/editor-fixture.ts";

/**
 * @file span-api.test.ts
 * @description #296 — SPEC-289's API half: the persistent span/overlay
 * layer WITHOUT blame. CRUD + the end-exclusive boundary convention +
 * overlap precedence (registration order) + edit-invalidation (the lazy
 * shape identity) + kill-cleanup + the rendered face (through
 * captureFrame's ANSI output).
 */

type Editor = Awaited<ReturnType<typeof createStartedEditor>>;
const e = (ed: Editor, expr: string) => executeTlisp(ed, expr);

const dirs: string[] = [];
const originalCwd = process.cwd();
let editor: Editor;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "i296-"));
  dirs.push(dir);
  process.chdir(dir);
  editor = await createStartedEditor("");
  editor.setClientLaunchDir(dir);
});
afterAll(() => {
  process.chdir(originalCwd);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The current buffer's span grid (line → spans), from editor state. */
const gridOf = (ed: Editor, buf = "test") => {
  const entry = (ed as unknown as { model: { bufferSpans?: Map<string, { spans: { start: number; end: number }[][] }> } }).model.bufferSpans?.get(buf);
  // Compare on the coordinate pairs (styles are face-table constants).
  return entry?.spans.map((line) => line.map((s) => ({ start: s.start, end: s.end })));
};

/** Set the CURRENT-visible buffer content (the #286 idiom: clear by
 * delete-range, then append — there is no buffer-set-text op). */
const setText = (buf: string, text: string) => {
  const count = Number(String(e(editor, `(buffer-line-count)`).value));
  if (count > 1) e(editor, `(buffer-delete-range 0 0 ${count - 1} 0)`);
  const first = String(e(editor, "(buffer-line 0)").value);
  if (first.length > 0) e(editor, `(buffer-delete-range 0 0 0 ${first.length})`);
  e(editor, `(buffer-append ${JSON.stringify(text)})`);
};

describe("#296 — span API (SPEC-289, the API half)", () => {
  test("CRUD: span-make returns an id; span-remove drops the grid", () => {
    setText("test", "hello\\nworld\\n");
    const id = String(e(editor, '(span-make "test" 0 0 0 5 "region")').value);
    expect(Number(id)).toBeGreaterThan(0);
    const grid = gridOf(editor);
    expect(grid).toBeDefined();
    expect(grid![0]).toEqual([{ start: 0, end: 5 }]);
    e(editor, `(span-remove ${id})`);
    expect(gridOf(editor)).toBeUndefined();
  });

  test("BOUNDARY convention: a full line is (l,0)→(l,line-length), END-EXCLUSIVE", () => {
    setText("test", "abc\\ndef\\n");
    e(editor, '(span-make "test" 0 0 0 3 "blame")');
    const grid = gridOf(editor)!;
    // [0,3) over "abc" — 3 = the length, end-exclusive.
    expect(grid[0]).toEqual([{ start: 0, end: 3 }]);
    expect(grid[1] ?? []).toEqual([]); // line 1 untouched (the grid ends at maxLine)
  });

  test("multi-LINE spans cover each line: the start col applies only to the first", () => {
    setText("test", "abc\\ndef\\nghi\\n");
    e(editor, '(span-make "test" 0 2 2 1 "match")');
    const grid = gridOf(editor)!;
    expect(grid[0]).toEqual([{ start: 2, end: 1000000 }]); // first line: from col 2 to EOL
    expect(grid[1]).toEqual([{ start: 0, end: 1000000 }]); // middle: whole line
    expect(grid[2]).toEqual([{ start: 0, end: 1 }]); // last: [0,1)
  });

  test("OVERLAP precedence: the LATEST-REGISTERED span wins the overlapped cells (frame-asserted)", async () => {
    const { captureFrame } = await import("../../src/render/capture-frame.ts");
    setText("test", "abcdef\n");
    e(editor, '(span-make "test" 0 0 0 6 "region")'); // registered FIRST
    e(editor, '(span-make "test" 0 2 0 4 "match")'); // registered LATER → wins [2,4)
    const frame = captureFrame(editor.getEditorState() as never, 40, 8).join("\n");
    // The LATER match face is PRESENT and owns the overlapped cells;
    // region owns [0,2) and [4,6).
    expect(frame).toContain("48;2;90;58;90"); // #5a3a5a — the match
    expect(frame).toContain("48;2;38;79;120"); // #264f78 — the region
    // The grid holds CLIPPED, non-overlapping spans (earlier split
    // around the later) — the render never sees an intra-layer
    // overlap (gate r3: the shared renderer's start-sort + pos-clip
    // would otherwise INVERT precedence).
    const grid = gridOf(editor)!;
    const sorted = [...(grid[0] ?? [])].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.start >= sorted[i - 1]!.end).toBe(true); // no overlap
    }
  });

  test("UNKNOWN face + reversed range refuse with named errors", () => {
    setText("test", "abc\\n");
    expect(() => e(editor, '(span-make "test" 0 0 0 3 "nope")')).toThrow(/unknown face/);
    expect(() => e(editor, '(span-make "test" 0 3 0 1 "region")')).toThrow(/end must be after start/);
    expect(gridOf(editor)).toBeUndefined();
  });

  test("EDIT-INVALIDATION: a shape change drops the rendered layer (lazy identity)", async () => {
    setText("test", "hello\\nworld\\n");
    e(editor, '(span-make "test" 0 0 0 5 "region")');
    const { captureFrame } = await import("../../src/render/capture-frame.ts");
    const frame1 = captureFrame(editor.getEditorState() as never, 40, 8);
    const sgr = "48;2;38;79;120"; // #264f78 → rgb SGR
    expect(frame1.join("\n")).toContain(sgr);
    // A shape-changing edit (a new line) — the layer goes stale.
    e(editor, '(cursor-move 2 0)');
    e(editor, '(buffer-insert "NEW LINE\\n")');
    const frame2 = captureFrame(editor.getEditorState() as never, 40, 8);
    expect(frame2.join("\n")).not.toContain(sgr);
    // The registry record SURVIVES (re-apply refreshes the shape).
    const id2 = e(editor, '(span-make "test" 0 0 0 5 "region")');
    expect(Number(String(id2.value))).toBeGreaterThan(1); // ids continue
    const frame3 = captureFrame(editor.getEditorState() as never, 40, 8);
    expect(frame3.join("\n")).toContain(sgr);
  });

  test("KILL-CLEANUP: buffer-kill drops the registry entry silently", () => {
    e(editor, '(buffer-create "*tmp296*")');
    setText("*tmp296*", "x\\n");
    e(editor, '(span-make "*tmp296*" 0 0 0 1 "dim")');
    expect(gridOf(editor, "*tmp296*")).toBeDefined();
    e(editor, '(buffer-kill "*tmp296*")');
    expect(gridOf(editor, "*tmp296*")).toBeUndefined();
  });
});

describe("#296 — gate r1 fixes (the API half)", () => {
  test("a SAME-SHAPE edit invalidates (the whole-text checksum)", async () => {
    const { captureFrame } = await import("../../src/render/capture-frame.ts");
    setText("test", "hello\nworld\n");
    e(editor, '(span-make "test" 0 0 0 5 "region")');
    const f1 = captureFrame(editor.getEditorState() as never, 40, 8);
    expect(f1.join("\n")).toContain("48;2;38;79;120");
    // SAME-LENGTH substitution (the shape-only identity missed this).
    setText("test", "HELLO\nworld\n");
    const f2 = captureFrame(editor.getEditorState() as never, 40, 8);
    expect(f2.join("\n")).not.toContain("48;2;38;79;120");
  });

  test("KILL+RECREATE drops stale records (the buffer token)", () => {
    e(editor, '(buffer-create "*tok*")');
    e(editor, '(buffer-switch "*tok*")');
    setText("test", "x\n");
    e(editor, '(span-make "*tok*" 0 0 0 1 "dim")');
    e(editor, '(buffer-kill "*tok*")');
    e(editor, '(buffer-create "*tok*")'); // recreated: a NEW object
    e(editor, '(buffer-switch "*tok*")');
    setText("test", "x\n");
    // A fresh span re-publishes — the STALE record (old token) must
    // NOT merge back in.
    e(editor, '(span-make "*tok*" 0 0 0 1 "highlight")');
    const entry = (editor as unknown as { model: { bufferSpans?: Map<string, { spans: { style: { bg?: string } }[][] }> } }).model.bufferSpans?.get("*tok*");
    expect(entry?.spans.length).toBe(1); // ONE span — not two
    expect(entry?.spans[0]?.[0]?.style?.bg).toBe("#665c26"); // the NEW one
  });

  test("span-make REFUSES a nonexistent buffer and negative coordinates", () => {
    expect(() => e(editor, '(span-make "*nope*" 0 0 0 1 "region")')).toThrow(/no such buffer/);
    e(editor, '(buffer-set-read-only nil)');
    expect(() => e(editor, '(span-make "test" -1 0 0 1 "region")')).toThrow(/negative/);
  });
});

describe("#296 — gate r2 fixes", () => {
  test("an out-of-range END-LINE refuses (no million-entry grid)", () => {
    setText("test", "x\n");
    expect(() => e(editor, '(span-make "test" 0 0 999999 1 "region")')).toThrow(/beyond the buffer/);
  });

  test("the checksum folds CONTENT: a same-length substitution invalidates (real chars, not lengths)", async () => {
    const { captureFrame } = await import("../../src/render/capture-frame.ts");
    setText("test", "hello\nworld\n");
    e(editor, '(span-make "test" 0 0 0 5 "region")');
    // Substituting SAME-LENGTH content in the MIDDLE of the buffer.
    setText("test", "hello\nwXrld\n");
    const f = captureFrame(editor.getEditorState() as never, 40, 8);
    expect(f.join("\n")).not.toContain("48;2;38;79;120");
  });
});
