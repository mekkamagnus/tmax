/**
 * @file markdown-spec-039.test.ts
 * @description Tests for SPEC-039 markdown-mode Org/Obsidian enhancements.
 * Covers: subtree ops, sparse trees, tag navigation, code blocks, table formulas,
 * export, footnotes, frontmatter, wiki-links.
 */

import { describe, test, expect } from "bun:test";
import {
  createStartedEditor,
  executeTlisp,
  expectTlispString,
} from "../helpers/editor-fixture.ts";
import type { Editor } from "../../src/editor/editor.ts";

async function setupMdEditor(content: string, filename?: string): Promise<Editor> {
  const editor = await createStartedEditor();
  executeTlisp(editor, `(require-module editor/commands/markdown)`);
  executeTlisp(editor, `(require-module editor/commands/find-file)`);
  editor.createBuffer(filename ?? "test.md", content);
  if (filename) {
    executeTlisp(editor, `(set-buffer-filename "${filename}")`);
  }
  return editor;
}

// ── Phase 1: Subtree operations ──────────────────────────────────────

describe("SPEC-039 Phase 1: Subtree operations", () => {
  const subtreeDoc = `# Title
intro
## Section 1
content 1
### Subsection
detail
## Section 2
content 2`;

  test("markdown-kill-subtree deletes heading and children", async () => {
    const editor = await setupMdEditor(subtreeDoc);
    // Move to ## Section 2 (line 6)
    executeTlisp(editor, `(cursor-move 6 0)`);
    executeTlisp(editor, `(markdown-kill-subtree)`);
    // Section 2 and its content should be gone
    const line0 = executeTlisp(editor, `(buffer-get-line 0)`);
    expect(expectTlispString(line0)).toBe("# Title");
    // Line count should be reduced
    const count = executeTlisp(editor, `(buffer-line-count)`);
    expect(count.value).toBeLessThan(8);
  });

  test("markdown-copy-subtree copies without deleting", async () => {
    const editor = await setupMdEditor(subtreeDoc);
    executeTlisp(editor, `(cursor-move 2 0)`);
    const beforeCount = executeTlisp(editor, `(buffer-line-count)`).value;
    executeTlisp(editor, `(markdown-copy-subtree)`);
    const afterCount = executeTlisp(editor, `(buffer-line-count)`).value;
    // Line count unchanged
    expect(afterCount).toBe(beforeCount);
  });

  test("markdown-promote-subtree reduces heading levels", async () => {
    const editor = await setupMdEditor(subtreeDoc);
    // Move to ## Section 1 (line 2)
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-promote-subtree)`);
    // ## Section 1 should become # Section 1
    const line2 = expectTlispString(executeTlisp(editor, `(buffer-get-line 2)`));
    expect(line2).toMatch(/^# Section 1/);
    // ### Subsection should become ## Subsection
    const line4 = expectTlispString(executeTlisp(editor, `(buffer-get-line 4)`));
    expect(line4).toMatch(/^## Subsection/);
  });

  test("markdown-demote-subtree increases heading levels", async () => {
    const editor = await setupMdEditor(subtreeDoc);
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-demote-subtree)`);
    // # Title should become ## Title
    const line0 = expectTlispString(executeTlisp(editor, `(buffer-get-line 0)`));
    expect(line0).toMatch(/^## Title/);
  });

  test("subtree ops on non-heading shows message", async () => {
    const editor = await setupMdEditor("plain text\nmore text");
    executeTlisp(editor, `(cursor-move 0 0)`);
    // First line is not a heading in this doc
    const result = executeTlisp(editor, `(markdown-kill-subtree)`);
    expect(result.type).toBe("string");
  });
});

// ── Phase 1: Sparse tree filtering ──────────────────────────────────

describe("SPEC-039 Phase 1: Sparse tree filtering", () => {
  const doc = `# Title
## Important
content
## Other
more content`;

  test("markdown-sparse-tree-regex folds non-matching headings", async () => {
    const editor = await setupMdEditor(doc);
    executeTlisp(editor, `(markdown-sparse-tree-regex "Important")`);
    // Check that "Other" is folded (line 3 is a heading range start)
    const collapsed = executeTlisp(editor, `(fold-is-collapsed 3)`);
    expect(collapsed.value).toBe(true);
  });

  test("markdown-sparse-tree-level folds deeper headings", async () => {
    const editor = await setupMdEditor(doc);
    executeTlisp(editor, `(markdown-sparse-tree-level 1)`);
    // Level 2 headings should be folded
    const collapsed1 = executeTlisp(editor, `(fold-is-collapsed 1)`);
    expect(collapsed1.value).toBe(true);
  });
});

// ── Phase 1: Tag navigation ─────────────────────────────────────────

describe("SPEC-039 Phase 1: Tag navigation", () => {
  const doc = `# Notes
This has #important and #review tags
Another line with #urgent`;

  test("markdown-next-tag moves to next tag", async () => {
    const editor = await setupMdEditor(doc);
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-next-tag)`);
    // Should land on a line with a tag
    const line = editor.getState().cursorPosition.line;
    expect(line).toBeGreaterThan(0);
  });

  test("markdown-tag-list finds unique tags", async () => {
    const editor = await setupMdEditor(doc);
    const result = executeTlisp(editor, `(markdown-tag-list)`);
    expect(result.type).toBe("string");
    const msg = expectTlispString(result);
    expect(msg).toContain("important");
    expect(msg).toContain("review");
    expect(msg).toContain("urgent");
  });

  test("markdown-prev-tag moves backward", async () => {
    const editor = await setupMdEditor(doc);
    // Start at last line
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-prev-tag)`);
    const line = editor.getState().cursorPosition.line;
    expect(line).toBeLessThan(2);
  });
});

// ── Phase 2: Code block execution ───────────────────────────────────

describe("SPEC-039 Phase 2: Code block execution", () => {
  test("markdown-execute-block runs shell block", async () => {
    const editor = await setupMdEditor("```sh\necho hello\n```");
    executeTlisp(editor, `(cursor-move 1 0)`);
    executeTlisp(editor, `(markdown-execute-block)`);
    // Should have inserted results line after code block
    const line3 = expectTlispString(executeTlisp(editor, `(buffer-get-line 3)`));
    expect(line3).toContain("hello");
  });

  test("markdown-clear-results removes results", async () => {
    const editor = await setupMdEditor("```sh\necho hello\n```\n<!-- results: hello -->");
    executeTlisp(editor, `(cursor-move 1 0)`);
    executeTlisp(editor, `(markdown-clear-results)`);
    const line3 = executeTlisp(editor, `(buffer-get-line 3)`);
    // Results line should be gone
    if (line3.type === "string") {
      expect(expectTlispString(line3)).not.toContain("results:");
    }
  });

  test("markdown-find-code-block returns nil outside block", async () => {
    const editor = await setupMdEditor("plain text\nno block here");
    executeTlisp(editor, `(cursor-move 0 0)`);
    const result = executeTlisp(editor, `(markdown-find-code-block)`);
    expect(result.type).toBe("nil");
  });
});

// ── Phase 3: Table formulas ─────────────────────────────────────────

describe("SPEC-039 Phase 3: Table formulas", () => {
  test("markdown-table-formula-parse parses valid formula", async () => {
    const editor = await setupMdEditor("test");
    const result = executeTlisp(editor, `(markdown-table-formula-parse "@2$3=@2$1+@2$2")`);
    expect(result.type).toBe("list");
  });

  test("markdown-table-formula-parse returns nil for invalid", async () => {
    const editor = await setupMdEditor("test");
    const result = executeTlisp(editor, `(markdown-table-formula-parse "invalid")`);
    expect(result.type).toBe("nil");
  });

  test("markdown-table-eval-expr evaluates arithmetic", async () => {
    const editor = await setupMdEditor("test");
    const result = executeTlisp(editor, `(markdown-table-eval-expr "3+4" '())`);
    expect(result.type).toBe("string");
    expect(expectTlispString(result)).toBe("7");
  });
});

// ── Phase 5: Footnote navigation ────────────────────────────────────

describe("SPEC-039 Phase 5: Footnote navigation", () => {
  const doc = `# Doc
Some text with a footnote[^1].
More text[^2].

[^1]: First footnote
[^2]: Second footnote`;

  test("markdown-next-footnote jumps to next footnote", async () => {
    const editor = await setupMdEditor(doc);
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-next-footnote)`);
    const line = editor.getState().cursorPosition.line;
    expect(line).toBeGreaterThan(0);
  });

  test("markdown-prev-footnote jumps to previous footnote", async () => {
    const editor = await setupMdEditor(doc);
    executeTlisp(editor, `(cursor-move 5 0)`);
    executeTlisp(editor, `(markdown-prev-footnote)`);
    const line = editor.getState().cursorPosition.line;
    expect(line).toBeLessThan(5);
  });

  test("no footnotes shows message", async () => {
    const editor = await setupMdEditor("plain text\nno footnotes");
    const result = executeTlisp(editor, `(markdown-next-footnote)`);
    expect(result.type).toBe("string");
  });
});

// ── Phase 5: YAML frontmatter ───────────────────────────────────────

describe("SPEC-039 Phase 5: YAML frontmatter", () => {
  const doc = `---
title: Test Doc
tags: [a, b]
---
# Content
Body text`;

  test("markdown-frontmatter-get reads value", async () => {
    const editor = await setupMdEditor(doc);
    const result = executeTlisp(editor, `(markdown-frontmatter-get "title")`);
    expect(expectTlispString(result)).toBe("Test Doc");
  });

  test("markdown-frontmatter-set updates value", async () => {
    const editor = await setupMdEditor(doc);
    executeTlisp(editor, `(markdown-frontmatter-set "title" "Updated")`);
    const result = executeTlisp(editor, `(markdown-frontmatter-get "title")`);
    expect(expectTlispString(result)).toBe("Updated");
  });

  test("markdown-frontmatter-get returns nil when no frontmatter", async () => {
    const editor = await setupMdEditor("No frontmatter here");
    const result = executeTlisp(editor, `(markdown-frontmatter-get "title")`);
    expect(result.type).toBe("nil");
  });

  test("markdown-frontmatter-show displays all fields", async () => {
    const editor = await setupMdEditor(doc);
    const result = executeTlisp(editor, `(markdown-frontmatter-show)`);
    const msg = expectTlispString(result);
    expect(msg).toContain("title");
    expect(msg).toContain("tags");
  });
});

// ── Phase 6: Wiki-links ─────────────────────────────────────────────

describe("SPEC-039 Phase 6: Wiki-links", () => {
  test("markdown-wiki-link-at-point detects [[link]]", async () => {
    const editor = await setupMdEditor("See [[other-note]] for details");
    executeTlisp(editor, `(cursor-move 0 5)`);
    const result = executeTlisp(editor, `(markdown-wiki-link-at-point)`);
    expect(expectTlispString(result)).toBe("other-note");
  });

  test("markdown-wiki-link-at-point returns nil when no link", async () => {
    const editor = await setupMdEditor("plain text here");
    executeTlisp(editor, `(cursor-move 0 0)`);
    const result = executeTlisp(editor, `(markdown-wiki-link-at-point)`);
    expect(result.type).toBe("nil");
  });

  test("wiki-link with heading reference is parsed", async () => {
    const editor = await setupMdEditor("See [[notes#intro]] for details");
    executeTlisp(editor, `(cursor-move 0 5)`);
    const result = executeTlisp(editor, `(markdown-wiki-link-at-point)`);
    expect(expectTlispString(result)).toBe("notes#intro");
  });
});
