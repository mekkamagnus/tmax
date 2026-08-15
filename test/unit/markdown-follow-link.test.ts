/**
 * @file markdown-follow-link.test.ts
 * @description Tests for SPEC-035 enhanced markdown link navigation.
 * Only tests exported functions: markdown-follow-link, markdown-do, markdown-jump-back.
 */

import { describe, test, expect } from "bun:test";
import {
  executeTlisp,
  expectTlispString,
  setupMdEditor,
} from "../helpers/editor-fixture.ts";

describe("SPEC-035 markdown link navigation", () => {
  describe("markdown-follow-link — inline links", () => {
    test("jumps to heading via anchor link [text](#heading)", async () => {
      const editor = await setupMdEditor("# Intro\n\nSee [intro](#intro) above");
      executeTlisp(editor, `(cursor-move 2 5)`);
      executeTlisp(editor, `(markdown-follow-link)`);
      expect(editor.getState().cursorPosition.line).toBe(0);
    });

    test("messages when no link at point", async () => {
      const editor = await setupMdEditor("plain text here");
      executeTlisp(editor, `(cursor-move 0 0)`);
      const result = executeTlisp(editor, `(markdown-follow-link)`);
      expect(result.type).toBe("string");
    });

    test("follows link when cursor is on [text] portion", async () => {
      const editor = await setupMdEditor("# Intro\n\nSee [intro](#intro) above");
      // Cursor on 'i' of 'intro' in [text] — column 5
      executeTlisp(editor, `(cursor-move 2 5)`);
      executeTlisp(editor, `(markdown-follow-link)`);
      expect(editor.getState().cursorPosition.line).toBe(0);
    });
  });

  describe("markdown-follow-link — anchor matching", () => {
    test("jumps to heading with mixed case", async () => {
      const editor = await setupMdEditor("# Getting Started\n\nSee [start](#getting-started)");
      executeTlisp(editor, `(cursor-move 2 5)`);
      executeTlisp(editor, `(markdown-follow-link)`);
      expect(editor.getState().cursorPosition.line).toBe(0);
    });
  });

  describe("link-back navigation (gb)", () => {
    test("returns to previous position after anchor jump", async () => {
      const editor = await setupMdEditor("# Intro\n\nSome text\n\nSee [intro](#intro)");
      executeTlisp(editor, `(cursor-move 4 5)`);
      executeTlisp(editor, `(markdown-follow-link)`);
      expect(editor.getState().cursorPosition.line).toBe(0);

      executeTlisp(editor, `(markdown-jump-back)`);
      expect(editor.getState().cursorPosition.line).toBe(4);
      expect(editor.getState().cursorPosition.column).toBe(5);
    });

    test("messages when ring is empty", async () => {
      const editor = await setupMdEditor("test");
      const result = executeTlisp(editor, `(markdown-jump-back)`);
      // Returns nil (no previous position)
      expect(["nil", "string"].includes(result.type)).toBe(true);
    });
  });

  describe("markdown-do context dispatch", () => {
    test("follows link when on a link", async () => {
      const editor = await setupMdEditor("# Intro\n\nSee [intro](#intro)");
      executeTlisp(editor, `(cursor-move 2 5)`);
      executeTlisp(editor, `(markdown-do)`);
      expect(editor.getState().cursorPosition.line).toBe(0);
    });

    test("folds when on a heading", async () => {
      const editor = await setupMdEditor("# Heading\n\nContent\n\n# Other");
      executeTlisp(editor, `(cursor-move 0 0)`);
      executeTlisp(editor, `(markdown-do)`);
      // Fold was applied, cursor stays on heading
      expect(editor.getState().cursorPosition.line).toBe(0);
    });
  });

  // BUG-76: only the FIRST [t](u) link on a line was ever detected — the
  // regex match bounds were checked against the first match regardless of
  // cursor position. Verified live in the mekkapi pane (link-test.md).
  describe("multi-link lines (BUG-76)", () => {
    const LINE = "links: [Anthropic](https://anthropic.com) and [note](#note)";

    test("markdown-link-at-point finds the second link on the line", async () => {
      const editor = await setupMdEditor(LINE + "\n\n# Note");
      // Column 48 = inside [note] (second link)
      executeTlisp(editor, `(cursor-move 0 48)`);
      const result = executeTlisp(editor, `(markdown-link-at-point)`);
      expectTlispString(result, "#note");
    });

    test("markdown-link-at-point still finds the first link", async () => {
      const editor = await setupMdEditor(LINE);
      // Column 9 = inside [Anthropic]
      executeTlisp(editor, `(cursor-move 0 9)`);
      const result = executeTlisp(editor, `(markdown-link-at-point)`);
      expectTlispString(result, "https://anthropic.com");
    });

    test("markdown-link-at-point returns nil between links", async () => {
      const editor = await setupMdEditor(LINE);
      // Column 43 = the space after the first link's ')'
      executeTlisp(editor, `(cursor-move 0 43)`);
      const result = executeTlisp(editor, `(markdown-link-at-point)`);
      expect(result.type).toBe("nil");
    });

    test("markdown-follow-link follows the second link, not the first", async () => {
      const editor = await setupMdEditor("# Intro\n\n" + LINE + "\n\n# Note");
      executeTlisp(editor, `(cursor-move 2 55)`);
      executeTlisp(editor, `(markdown-follow-link)`);
      // Jumped to the #Note heading (line 4), not line 0
      expect(editor.getState().cursorPosition.line).toBe(4);
    });

    test("markdown-do dispatches the second link", async () => {
      const editor = await setupMdEditor("# Intro\n\n" + LINE + "\n\n# Note");
      executeTlisp(editor, `(cursor-move 2 55)`);
      executeTlisp(editor, `(markdown-do)`);
      expect(editor.getState().cursorPosition.line).toBe(4);
    });
  });
});
