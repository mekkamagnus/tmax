/**
 * @file markdown-table-align.test.ts
 * @description SPEC-229 (#229): org-table-style pipe table alignment in markdown-mode.
 * Covers: basic alignment, display-width padding (CJK), alignment markers,
 * delimiter stretch, idempotence, align-on-open (mode hook), TAB/RET triggers,
 * phantom-column fix, short-row padding, cursor mapping.
 */

import { describe, test, expect } from "bun:test";
import {
  executeTlisp,
  expectTlispString,
  setupMdEditor,
} from "../helpers/editor-fixture.ts";

const bufferLines = (editor: Awaited<ReturnType<typeof setupMdEditor>>, n: number): string => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(expectTlispString(executeTlisp(editor, `(buffer-get-line ${i})`)));
  }
  return out.join("\n");
};

const issueTable = [
  "| Command | Keys | Description |",
  "| --- | --- | --- |",
  "| save-buffer | :w | Write the buffer to its file |",
  "| quit | SPC q q | Quit editor and daemon |",
].join("\n");

const issueTableAligned = [
  "| Command     | Keys    | Description                  |",
  "| ----------- | ------- | ---------------------------- |",
  "| save-buffer | :w      | Write the buffer to its file |",
  "| quit        | SPC q q | Quit editor and daemon       |",
].join("\n");

const smallAligned = [
  "| a          | b |",
  "| ---------- | - |",
  "| muchlonger | x |",
].join("\n");

/** Corrupt line 2 of an aligned table with a wider cell so a realign has visible work to do. */
const corruptLine2 = (editor: Awaited<ReturnType<typeof setupMdEditor>>): void => {
  executeTlisp(editor, `(cursor-move 2 0)`);
  executeTlisp(editor, `(markdown-replace-line "| muchlonger | x |")`);
};

/** Left-pad a cell to a display width and frame it as "| cell " — builds expected rows without hand-counted literals. */
const mdRow = (cells: string[], widths: number[]): string =>
  "| " + cells.map((c, i) => c + " ".repeat(widths[i]! - c.length)).join(" | ") + " |";

describe("SPEC-229: table alignment", () => {
  test("aligns the issue example: pipes line up, delimiter stretched", async () => {
    const editor = await setupMdEditor(issueTable);
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-align-table)`);
    expect(bufferLines(editor, 4)).toBe(issueTableAligned);
  });

  test("pads by terminal display width — CJK cells count as 2 columns", async () => {
    const editor = await setupMdEditor(
      "| 名字 | x |\n| --- | --- |\n| 中文内容 | ok |",
    );
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-align-table)`);
    expect(bufferLines(editor, 3)).toBe(
      [
        "| 名字     | x  |",
        "| -------- | -- |",
        "| 中文内容 | ok |",
      ].join("\n"),
    );
  });

  test("honors alignment markers: :--- left, :---: center, ---: right", async () => {
    const editor = await setupMdEditor(
      "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 22 | 333 |",
    );
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-align-table)`);
    expect(bufferLines(editor, 3)).toBe(
      [
        "| a   |  b  |   c |",
        "| :-- | :-: | --: |",
        "| 1   | 22  | 333 |",
      ].join("\n"),
    );
  });

  test("idempotent: an aligned table re-aligns to itself, buffer not dirtied", async () => {
    const editor = await setupMdEditor(issueTableAligned);
    const before = executeTlisp(editor, `(buffer-modified-p)`);
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-align-table)`);
    executeTlisp(editor, `(markdown-align-table)`);
    expect(bufferLines(editor, 4)).toBe(issueTableAligned);
    const after = executeTlisp(editor, `(buffer-modified-p)`);
    expect(after.value).toBe(before.value);
  });

  test("align-on-open: major-mode-set runs the activate hook and aligns every table", async () => {
    const editor = await setupMdEditor(
      `${issueTable}\n\n| x | yy |\n| --- | --- |\n| 1 | 2 |`,
    );
    executeTlisp(editor, `(major-mode-set "markdown")`);
    const lines = executeTlisp(editor, `(buffer-line-count)`).value as number;
    const out: string[] = [];
    for (let i = 0; i < lines; i++) {
      out.push(expectTlispString(executeTlisp(editor, `(buffer-get-line ${i})`)));
    }
    expect(out.slice(0, 4).join("\n")).toBe(issueTableAligned);
    expect(out.slice(5).join("\n")).toBe(
      [
        "| x | yy |",
        "| - | -- |",
        "| 1 | 2  |",
      ].join("\n"),
    );
  });

  test("no phantom column: empty edge cells are dropped, short rows are padded", async () => {
    const editor = await setupMdEditor("| a | b |\n| --- | --- |\n| x |");
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-align-table)`);
    expect(bufferLines(editor, 3)).toBe(
      [
        "| a | b |",
        "| - | - |",
        "| x |   |",
      ].join("\n"),
    );
  });

  test("TAB on a table row aligns; on a heading it leaves the buffer unchanged", async () => {
    const editor = await setupMdEditor(`${issueTable}\n# Heading`);
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-tab)`);
    expect(bufferLines(editor, 4)).toBe(issueTableAligned);
    // Outside a table TAB falls through to visibility cycling — buffer text untouched.
    const before = bufferLines(editor, 5);
    executeTlisp(editor, `(cursor-move 4 0)`);
    executeTlisp(editor, `(markdown-tab)`);
    expect(bufferLines(editor, 5)).toBe(before);
  });

  test("post-newline-hook realigns when the cursor sits on a table row", async () => {
    const editor = await setupMdEditor("| a | b |\n| --- | --- |\n| longer | x |");
    // Activate the mode (aligns on open), then un-align row 2 and press "Enter" on it.
    executeTlisp(editor, `(major-mode-set "markdown")`);
    corruptLine2(editor);
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(post-newline-hook)`);
    expect(bufferLines(editor, 3)).toBe(smallAligned);
  });

  test("post-newline-hook realigns from the line after a table and restores the cursor", async () => {
    const editor = await setupMdEditor("| a | b |\n| --- | --- |\n| longer | x |\nafter");
    executeTlisp(editor, `(major-mode-set "markdown")`);
    corruptLine2(editor);
    executeTlisp(editor, `(cursor-move 3 0)`);
    executeTlisp(editor, `(post-newline-hook)`);
    expect(bufferLines(editor, 3)).toBe(smallAligned);
    expect(executeTlisp(editor, `(cursor-line)`).value).toBe(3);
  });

  test("cursor is mapped pipe-to-pipe into the same cell", async () => {
    const editor = await setupMdEditor(issueTable);
    // Line 3 "| quit | SPC q q | ...": column 8 is the space right after the Keys pipe.
    executeTlisp(editor, `(cursor-move 3 8)`);
    executeTlisp(editor, `(markdown-align-table)`);
    // Aligned line 3 puts the Keys pipe at column 14; the same relative spot is 15.
    expect(executeTlisp(editor, `(cursor-column)`).value).toBe(15);
    expect(executeTlisp(editor, `(cursor-line)`).value).toBe(3);
  });

  test("table rows keep their leading indentation", async () => {
    const editor = await setupMdEditor(
      "  | a | b |\n  | --- | --- |\n  | xx | c |",
    );
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-align-table)`);
    expect(bufferLines(editor, 3)).toBe(
      [
        "  | a  | b |",
        "  | -- | - |",
        "  | xx | c |",
      ].join("\n"),
    );
  });

  test("mixed per-row indentation normalizes to the first row's indent (aligned pipes need uniform indent)", async () => {
    const editor = await setupMdEditor(
      "  | a | b |\n| --- | --- |\n    | xx | c |",
    );
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-align-table)`);
    expect(bufferLines(editor, 3)).toBe(
      [
        "  | a  | b |",
        "  | -- | - |",
        "  | xx | c |",
      ].join("\n"),
    );
  });

  test("emoji cells count as 2 display columns (same isWideChar path as CJK)", async () => {
    const editor = await setupMdEditor("| a | b |\n| --- | --- |\n| 🚀 | xy |");
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-align-table)`);
    expect(bufferLines(editor, 3)).toBe(
      [
        "| a  | b  |",
        "| -- | -- |",
        "| 🚀 | xy |",
      ].join("\n"),
    );
  });

  test("formula evaluation leaves the table aligned (SPEC-039:373)", async () => {
    const editor = await setupMdEditor(
      "| a | b |\n| --- | --- |\n| 1 | x |\n<!-- tblfm: @3$2=@3$1+@3$1 -->",
    );
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-table-eval-formula)`);
    // 1+1 = 2 into the data row's second VISIBLE cell ($2 — writes are now
    // sentinel-aware like reads), the table re-aligns, and the consumed
    // formula comment is removed (org-style), leaving just the 3-line table.
    expect(bufferLines(editor, 3)).toBe(
      [
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
      ].join("\n"),
    );
  });

  test("the registered activate-hook name realigns (align-on-open wiring)", async () => {
    const editor = await setupMdEditor(issueTable);
    // Widen a cell BEFORE any alignment runs (fixture starts in fundamental mode).
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-replace-line "| save-buffer-long | :w | Write |")`);
    // Running the exact hook major-mode-set fires must realign the table.
    executeTlisp(editor, `(run-hooks "mode-markdown-activate-hook")`);
    const widths = [16, 7, 22];
    expect(bufferLines(editor, 4)).toBe(
      [
        mdRow(["Command", "Keys", "Description"], widths),
        "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |",
        mdRow(["save-buffer-long", ":w", "Write"], widths),
        mdRow(["quit", "SPC q q", "Quit editor and daemon"], widths),
      ].join("\n"),
    );
  });
});
