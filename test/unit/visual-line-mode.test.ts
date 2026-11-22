/**
 * @file visual-line-mode.test.ts
 * @description #334 — display-only word wrapping (Emacs visual-line-mode
 *   parity). The mode drives the existing config.wordWrap render path via
 *   the minor-mode-ops config bridge: buffer text is NEVER modified, one
 *   buffer line may occupy several screen rows, and the cursor maps
 *   buffer (line, col) → display (row, col). Mutually exclusive with
 *   truncate-lines (opposite settings of the same render flag).
 */

import { describe, expect, test } from "bun:test";
import { captureFrame } from "../../src/render/capture-frame.ts";
import {
  getWrappedCursorColumn,
  getWrappedCursorRow,
} from "../../src/frontend/render/buffer-lines.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import type { EditorState } from "../../src/core/types.ts";
import type { Editor } from "../../src/editor/editor.ts";
import { executeTlisp, setupMdEditor } from "../helpers/editor-fixture.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function makeState(content: string, opts: { wrap?: boolean; cursor?: { line: number; column: number } } = {}): EditorState {
  const buf = TextBufferImpl.create(content);
  return {
    currentBuffer: buf as any,
    cursorPosition: opts.cursor ?? { line: 0, column: 0 },
    mode: "normal",
    statusMessage: "",
    viewportTop: 0,
    config: { theme: "dark", tabSize: 2, autoSave: false, keyBindings: {}, maxUndoLevels: 100, showLineNumbers: false, relativeLineNumbers: false, wordWrap: opts.wrap === true },
    commandLine: "",
    mxCommand: "",
    currentFilename: "note.md",
    currentMajorMode: "markdown",
    activeMinorModes: opts.wrap === true ? ["wiki-link-display", "visual-line"] : ["wiki-link-display"],
  };
}

/** Content rows of a captured frame (gutter off, ANSI stripped). */
function rows(state: EditorState, width: number, height: number): string[] {
  return captureFrame(state, width, height).map(stripAnsi);
}

async function setup(content: string): Promise<Editor> {
  const editor = await setupMdEditor(content, "note.md");
  executeTlisp(editor, "(require-module editor/modes/visual-line)");
  executeTlisp(editor, "(require-module editor/modes/truncate-lines)");
  return editor;
}

function wrapOn(editor: Editor): boolean {
  // #334 audit: wrapping is the per-buffer visual-line mode — the shared
  // config flag is no longer consulted by the render layer.
  return executeTlisp(editor, '(minor-mode-active-p "visual-line")').value === true;
}

function active(editor: Editor, name: string): boolean {
  return executeTlisp(editor, `(minor-mode-active-p "${name}")`).value === true;
}

describe("#334 — visual-line-mode toggle", () => {
  test("M-x visual-line-mode enables the minor mode and wordWrap; buffer text unchanged", async () => {
    const editor = await setup("aaaa bbbb cccc dddd\nshort");
    const before = executeTlisp(editor, "(buffer-text)");
    executeTlisp(editor, "(visual-line-mode)");
    expect(active(editor, "visual-line")).toBe(true);
    expect(wrapOn(editor)).toBe(true);
    executeTlisp(editor, "(visual-line-mode 0)");
    expect(active(editor, "visual-line")).toBe(false);
    expect(wrapOn(editor)).toBe(false);
    expect(executeTlisp(editor, "(buffer-text)")).toEqual(before);
  });

  test("SPC v toggles wrapping on and off", async () => {
    const editor = await setup("some long enough line of text here\n");
    await editor.handleKey(" ");
    await editor.handleKey("v");
    expect(active(editor, "visual-line")).toBe(true);
    expect(wrapOn(editor)).toBe(true);
    await editor.handleKey(" ");
    await editor.handleKey("v");
    expect(active(editor, "visual-line")).toBe(false);
    expect(wrapOn(editor)).toBe(false);
  });

  test("mutually exclusive with truncate-lines (both directions)", async () => {
    const editor = await setup("line\n");
    executeTlisp(editor, "(truncate-lines-mode 1)");
    expect(active(editor, "truncate-lines")).toBe(true);
    expect(wrapOn(editor)).toBe(false);
    // visual-line wins: truncate deactivates, wrap turns on.
    executeTlisp(editor, "(visual-line-mode 1)");
    expect(active(editor, "visual-line")).toBe(true);
    expect(active(editor, "truncate-lines")).toBe(false);
    expect(wrapOn(editor)).toBe(true);
    // truncate wins back: visual deactivates, wrap turns off.
    executeTlisp(editor, "(truncate-lines-mode 1)");
    expect(active(editor, "truncate-lines")).toBe(true);
    expect(active(editor, "visual-line")).toBe(false);
    expect(wrapOn(editor)).toBe(false);
  });

  test("audit: enabling visual-line in ONE buffer does not wrap OTHER buffers", async () => {
    const editor = await setup("a ".repeat(40) + "\n"); // ~80 chars, wraps at 40
    editor.createBuffer("other.md", "b ".repeat(40) + "\n");
    executeTlisp(editor, "(visual-line-mode)");
    expect(wrapOn(editor)).toBe(true);
    // The wrapped buffer renders multiple rows for its long line.
    const wrappedRows = captureFrame(editor.getEditorState(), 40, 8).map(stripAnsi);
    expect(wrappedRows[1]!.trimEnd()).not.toBe("");
    // Switch to the OTHER buffer: it must NOT wrap (clip instead).
    executeTlisp(editor, '(switch-to-buffer "other.md")');
    expect(wrapOn(editor)).toBe(false);
    const plainRows = captureFrame(editor.getEditorState(), 40, 8).map(stripAnsi);
    expect(plainRows[0]!.endsWith("...")).toBe(true);
    // Row 1 is the (gutter-only) second buffer line — no wrapped content.
    expect(plainRows[1]!.startsWith("b")).toBe(false);
    // Switch back: still wrapped.
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    expect(wrapOn(editor)).toBe(true);
  });

  test("audit: a GLOBAL truncate-lines cannot re-merge over a LOCAL visual-line", async () => {
    const editor = await setup("line\n");
    executeTlisp(editor, "(global-truncate-lines-mode 1)");
    expect(executeTlisp(editor, '(global-minor-mode-active-p "truncate-lines")').value).toBe(true);
    // Local visual-line activation must locally suppress the global truncate
    // (a "disabled" override — not just a one-time list removal).
    executeTlisp(editor, "(visual-line-mode 1)");
    expect(active(editor, "visual-line")).toBe(true);
    expect(active(editor, "truncate-lines")).toBe(false);
    // Re-read the merged state (a fresh getCurrentModeState): still off.
    expect(active(editor, "truncate-lines")).toBe(false);
  });

  test("audit: global toggles are mutually exclusive in both directions", async () => {
    const editor = await setup("line\n");
    executeTlisp(editor, "(global-visual-line-mode 1)");
    expect(executeTlisp(editor, '(global-minor-mode-active-p "visual-line")').value).toBe(true);
    expect(executeTlisp(editor, '(global-minor-mode-active-p "truncate-lines")').value).toBe(false);
    executeTlisp(editor, "(global-truncate-lines-mode 1)");
    expect(executeTlisp(editor, '(global-minor-mode-active-p "truncate-lines")').value).toBe(true);
    expect(executeTlisp(editor, '(global-minor-mode-active-p "visual-line")').value).toBe(false);
  });

  test("audit r2: a SPLIT PANE wraps according to the buffer IT displays", async () => {
    const long = "word ".repeat(30) + "\n"; // 150 chars
    const editor = await setup(long);
    executeTlisp(editor, "(require-module editor/commands/windows)");
    // note.md wraps; the other buffer does not.
    executeTlisp(editor, "(visual-line-mode)");
    // createBuffer switches the current buffer — switch back before splitting
    // so the TOP pane keeps note.md.
    editor.createBuffer("other.md", long);
    executeTlisp(editor, '(switch-to-buffer "note.md")');
    executeTlisp(editor, "(split-window-below)");
    executeTlisp(editor, '(window-move-focus "down")');
    executeTlisp(editor, '(switch-to-buffer "other.md")');
    // windowWrap: per-window derivation — the note.md pane true, other.md false.
    const wrap = editor.getEditorState().windowWrap ?? {};
    const entries = Object.entries(wrap);
    expect(entries.length).toBe(2);
    expect(new Set(entries.map(([, v]) => v)).size).toBe(2); // one true, one false
    // The rendered frame: the wrapping pane has no clip ellipsis; the
    // clipping pane does.
    const rowsAll = captureFrame(editor.getEditorState(), 60, 24).map(stripAnsi);
    const topHalf = rowsAll.slice(0, 11).filter((r) => r.trim().length > 0);
    const bottomHalf = rowsAll.slice(12).filter((r) => r.trim().length > 0);
    expect(topHalf.some((r) => r.includes("..."))).toBe(false);
    expect(bottomHalf.some((r) => r.includes("..."))).toBe(true);
  });

  test("audit r2: auto-fill buffers keep their wrap (Fikra chat regression)", async () => {
    const state = makeState("word ".repeat(30), { wrap: false });
    state.activeMinorModes = ["auto-fill"];
    const r = rows(state, 40, 8);
    expect(r[0]!.includes("...")).toBe(false); // wrapped, not clipped
    expect(r[1]!.trimEnd()).not.toBe(""); // continuation row
  });

  test("audit r3: two FILENAME-LESS buffers keep independent wrap state in split panes", async () => {
    const long = "word ".repeat(30) + "\n";
    const editor = await setup(long);
    executeTlisp(editor, "(require-module editor/commands/windows)");
    // Two special buffers with no filename — mode state keys by NAME.
    editor.createBuffer("*Chat-A*", long);
    editor.createBuffer("*Chat-B*", long);
    executeTlisp(editor, '(switch-to-buffer "*Chat-A*")');
    executeTlisp(editor, "(visual-line-mode)");
    executeTlisp(editor, "(split-window-below)");
    executeTlisp(editor, '(window-move-focus "down")');
    executeTlisp(editor, '(switch-to-buffer "*Chat-B*")');
    // Per-buffer identity: A wraps, B does not — no shared *scratch* state.
    const wrap = editor.getEditorState().windowWrap ?? {};
    const values = Object.values(wrap).sort();
    expect(values).toEqual([false, true]);
    // And the mode really is per-buffer, not just per-window.
    expect(active(editor, "visual-line")).toBe(false); // Chat-B current
    executeTlisp(editor, '(switch-to-buffer "*Chat-A*")');
    expect(active(editor, "visual-line")).toBe(true);
  });

  test("audit r3: killing a FILE buffer clears the stale filename for the filename-less survivor", async () => {
    const editor = await setup("line\n"); // note.md current, no wrap
    executeTlisp(editor, "(visual-line-mode)");
    expect(active(editor, "visual-line")).toBe(true); // note.md's state
    // Kill note.md — the survivor (*scratch*, filename-less) must NOT keep
    // reading note.md's mode state through a stale currentFilename.
    executeTlisp(editor, '(buffer-kill "note.md")');
    expect(executeTlisp(editor, "(buffer-current)").value).toBe("*scratch*");
    expect(active(editor, "visual-line")).toBe(false);
  });

  test("audit r3: renaming a filename-less buffer keeps its mode state", async () => {
    const editor = await setup("line\n");
    editor.createBuffer("*Chat-A*", "x\n");
    executeTlisp(editor, '(switch-to-buffer "*Chat-A*")');
    executeTlisp(editor, "(visual-line-mode)");
    executeTlisp(editor, '(buffer-rename "*Chat-B*")');
    expect(executeTlisp(editor, "(buffer-current)").value).toBe("*Chat-B*");
    expect(active(editor, "visual-line")).toBe(true);
  });

  test("audit r3: saving a special buffer under a filename migrates its mode state", async () => {
    const editor = await setup("line\n");
    editor.createBuffer("*Chat-A*", "x\n");
    executeTlisp(editor, '(switch-to-buffer "*Chat-A*")');
    executeTlisp(editor, "(visual-line-mode)");
    executeTlisp(editor, '(set-buffer-filename "/tmp/saved-chat.md")');
    expect(active(editor, "visual-line")).toBe(true);
    // The key is now the filename: switching away and back keeps the mode.
    executeTlisp(editor, '(switch-to-buffer "*scratch*")');
    expect(active(editor, "visual-line")).toBe(false);
    executeTlisp(editor, '(switch-to-buffer "*Chat-A*")');
    expect(active(editor, "visual-line")).toBe(true);
  });

  test("audit r3: a wide char in a one-column pane terminates wrapping", () => {
    // Would loop forever before the progress guarantee — a timeout here is
    // the failure signal.
    const state = makeState("漢字", { wrap: true });
    const r = rows(state, 1, 6);
    expect(r.length).toBeGreaterThan(0);
  });
});

describe("#334 — wrapping render (word boundaries, long words, CJK, empty lines)", () => {
  test("wraps at the last word boundary before the edge; content preserved", () => {
    const r = rows(makeState("aaaa bbbb cccc", { wrap: true }), 12, 6);
    expect(r[0]!.trimEnd()).toBe("aaaa bbbb");
    expect(r[1]!.trimEnd()).toBe("cccc");
  });

  test("a word longer than the width hard-splits at the width", () => {
    const r = rows(makeState("aaaaaaaabbbb", { wrap: true }), 8, 6);
    expect(r[0]!.trimEnd()).toBe("aaaaaaaa");
    expect(r[1]!.trimEnd()).toBe("bbbb");
  });

  test("CJK double-width chars wrap on visual width, never splitting a char", () => {
    // 汉字 = 2 cols each; width 5 admits at most 4 CJK cols per row.
    const r = rows(makeState("汉字汉字abc", { wrap: true }), 5, 6);
    expect(r.slice(0, 3).map((x) => x.trimEnd()).join("")).toBe("汉字汉字abc");
    expect(r[0]!.trimEnd()).toBe("汉字"); // 4 visual cols — a 3rd char would exceed 5
  });

  test("empty lines render one row each and survive wrapping", () => {
    const r = rows(makeState("a\n\nb", { wrap: true }), 10, 6);
    expect(r[0]!.trimEnd()).toBe("a");
    expect(r[1]!.trimEnd()).toBe("");
    expect(r[2]!.trimEnd()).toBe("b");
  });

  test("wrap OFF (default): long lines clip at the edge, no wrapped rows", () => {
    const r = rows(makeState("aaaa bbbb cccc dddd", { wrap: false }), 12, 6);
    expect(r[0]!.trimEnd()).toBe("aaaa bbbb...");
    expect(r[1]!.trimEnd()).not.toBe("cccc dddd");
  });
});

describe("#334 — cursor mapping over wrapped rows", () => {
  const LINE = "aaaa bbbb cccc";

  test("cursor on the second display row maps to row 1, column 0 (gutter off)", () => {
    const state = makeState(LINE, { wrap: true, cursor: { line: 0, column: 10 } }); // first "c"
    expect(getWrappedCursorRow(state, 6, 12)).toBe(1);
    expect(getWrappedCursorColumn(state, 12)).toBe(0);
  });

  test("cursor on the first display row maps to row 0", () => {
    const state = makeState(LINE, { wrap: true, cursor: { line: 0, column: 3 } }); // last "a"
    expect(getWrappedCursorRow(state, 6, 12)).toBe(0);
    expect(getWrappedCursorColumn(state, 12)).toBe(3);
  });

  test("composes with wiki-link-display: buffer col maps through the transform then the wrap", () => {
    // "see [[goals]] now", width 9: display text "see goals now" wraps at the
    // word boundary after "see ". Buffer col 6 ("g", first visible char) is
    // display col 4 — the first cell of wrapped row 1.
    const state = makeState("see [[goals]] now", { wrap: true, cursor: { line: 0, column: 6 } });
    expect(getWrappedCursorColumn(state, 9)).toBe(0);
    expect(getWrappedCursorRow(state, 6, 9)).toBe(1);
  });

  test("h/l step every buffer column across the wrap boundary — no skips", async () => {
    const editor = await setup("aaaa bbbb cccc");
    executeTlisp(editor, "(visual-line-mode)");
    executeTlisp(editor, "(cursor-move 0 8)"); // last "b", end of row 0 content
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      await editor.handleKey("l");
      seen.push(executeTlisp(editor, "(cursor-column)").value as number);
    }
    expect(seen).toEqual([9, 10, 11, 12, 13, 14]); // one per press; 14 = one-past-end clamp
  });
});
