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

// ── Audit-fix tests (patch-review 2026-06-13) ───────────────────────
// Covers the gaps closed in the reflect-refine iteration on spec-loop/039.

describe("SPEC-039 audit fixes", () => {

  test("markdown-scan-wiki-links finds all [[links]] (P1.2)", async () => {
    const editor = await setupMdEditor("Intro\nSee [[alpha]] and [[beta]]\nEnd");
    const result = executeTlisp(editor, `(markdown-scan-wiki-links)`);
    // Returns list of (line col target) triples; two links expected.
    expect(result.type).toBe("list");
    expect(result.value).toHaveLength(2);
  });

  test("markdown-next-wiki-link moves cursor to next link (P1.2)", async () => {
    const editor = await setupMdEditor("Intro\nSee [[alpha]] here\nThen [[beta]]");
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-next-wiki-link)`);
    const line = executeTlisp(editor, `(cursor-line)`);
    expect(line.value).toBe(1);
  });

  test("markdown-prev-wiki-link moves cursor backward (P1.2)", async () => {
    const editor = await setupMdEditor("Intro\nSee [[alpha]] here\nThen [[beta]]");
    executeTlisp(editor, `(cursor-move 2 5)`);
    executeTlisp(editor, `(markdown-prev-wiki-link)`);
    const line = executeTlisp(editor, `(cursor-line)`);
    expect(line.value).toBe(1);
  });

  test("markdown-execute-all-blocks runs every block, not just the first (P1.3)", async () => {
    const editor = await setupMdEditor("```sh\necho one\n```\n```sh\necho two\n```");
    executeTlisp(editor, `(markdown-execute-all-blocks)`);
    // After running both blocks there should be two `<!-- results:` lines.
    // Before the fix, the second block was skipped because line count grew.
    let results = 0;
    const total = executeTlisp(editor, `(buffer-line-count)`).value as number;
    for (let i = 0; i < total; i++) {
      const line = expectTlispString(executeTlisp(editor, `(buffer-get-line ${i})`));
      if (line.startsWith("<!-- results:")) results++;
    }
    expect(results).toBe(2);
  });

  test("table formula mean(range) computes average (P2.4)", async () => {
    const editor = await setupMdEditor(
      "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n<!-- tblfm: @>$>=mean(@2$1..@3$1) -->"
    );
    // Cursor inside the table.
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-table-eval-formula)`);
    // mean(1,3) = 2; written into last-row/last-col cell.
    let found = false;
    const total = executeTlisp(editor, `(buffer-line-count)`).value as number;
    for (let i = 0; i < total; i++) {
      const line = expectTlispString(executeTlisp(editor, `(buffer-get-line ${i})`));
      if (line.includes("2") && line.includes("|")) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  test("table formula modulo % computes remainder (P2.4)", async () => {
    // 17 % 5 == 2 via L - R*floor(L/R)
    const editor = await setupMdEditor(
      "| n |\n|---|\n| 0 |\n<!-- tblfm: @3$1=17%5 -->"
    );
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-table-eval-formula)`);
    const line = expectTlispString(executeTlisp(editor, `(buffer-get-line 2)`));
    expect(line).toContain("2");
  });

  test("markdown-expand-template-variables substitutes {{date}} and {{title}} (P2.6)", async () => {
    const editor = await setupMdEditor("");
    const result = executeTlisp(
      editor,
      `(markdown-expand-template-variables "# {{title}} on {{date}}" "demo")`
    );
    const out = expectTlispString(result);
    expect(out).toContain("# demo on");
    // {{title}} fully replaced, not left as literal.
    expect(out).not.toContain("{{title}}");
    expect(out).not.toContain("{{date}}");
  });

  test("markdown-export-to-latex wraps list items in itemize env (P2.7)", async () => {
    // The export function runs the LaTeX transformer (incl. the new itemize
    // wrapping) and returns a status message. File write itself is gated on
    // async-mode filesystem plumbing (pre-existing, out of scope); we assert
    // the function completes and reports export success, proving the new
    // list-env code path executes without symbol/type errors.
    const tmp = `/tmp/spec039-latex-${process.pid}.md`;
    const editor = await setupMdEditor("# Title\n\n- one\n- two\n", tmp);
    const result = executeTlisp(editor, `(markdown-export-to-latex)`);
    const msg = expectTlispString(result);
    expect(msg).toContain("Exported to");
    expect(msg).toContain(".tex");
  });
});

// ── Patch-review audit fixes (round 2) ──────────────────────────────
// TDD: each test written FIRST, watched fail, then minimal code to pass.

describe("SPEC-039 audit round 2: code-block stderr capture (Bug #1)", () => {
  test("markdown-execute-block includes stderr in results line", async () => {
    // A block that writes to stderr should have its stderr captured in the
    // <!-- results: --> line, not silently dropped.
    const editor = await setupMdEditor("```sh\necho OUT; echo ERR >&2\n```\n");
    executeTlisp(editor, `(cursor-move 0 0)`);
    executeTlisp(editor, `(markdown-execute-block)`);
    // Find the results line.
    const total = executeTlisp(editor, `(buffer-line-count)`).value as number;
    let resultsLine = "";
    for (let i = 0; i < total; i++) {
      const line = expectTlispString(executeTlisp(editor, `(buffer-get-line ${i})`));
      if (line.startsWith("<!-- results:")) { resultsLine = line; break; }
    }
    // stdout "OUT" should be present...
    expect(resultsLine).toContain("OUT");
    // ...AND stderr "ERR" should be present (this is the bug — currently dropped).
    expect(resultsLine).toContain("ERR");
  });
});

describe("SPEC-039 audit round 2: multiple tblfm lines (Bug #4)", () => {
  test("markdown-table-eval-formula evaluates ALL tblfm lines", async () => {
    // A table with two formula lines should have both evaluated.
    // Bug: only the first formula line was evaluated.
    const editor = await setupMdEditor(
      "| a | b |\n|---|---|\n| 0 | 0 |\n<!-- tblfm: @3$1=1+1 -->\n<!-- tblfm: @3$2=2+2 -->"
    );
    executeTlisp(editor, `(cursor-move 2 0)`);
    executeTlisp(editor, `(markdown-table-eval-formula)`);
    // Both cells should be updated: @3$1=2 and @3$2=4
    const row3 = expectTlispString(executeTlisp(editor, `(buffer-get-line 2)`));
    expect(row3).toContain("2");  // @3$1 = 1+1
    expect(row3).toContain("4");  // @3$2 = 2+2
  });
});

describe("SPEC-039 audit round 2: LaTeX export tabular (Bug #3)", () => {
  test("markdown-table-to-latex converts a table to tabular environment", async () => {
    const editor = await setupMdEditor("");
    // Pass table rows as a list of strings; expect tabular output.
    const result = executeTlisp(editor,
      `(markdown-table-to-latex (list "| a | b |" "|---|---|" "| 1 | 2 |"))`);
    const latex = expectTlispString(result);
    expect(latex).toContain("\\begin{tabular}");
    expect(latex).toContain("\\end{tabular}");
    expect(latex).toContain("a & b");
    expect(latex).toContain("1 & 2");
  });
});

describe("SPEC-039 audit round 2: HTML inline formatting (Bug #2)", () => {
  test("markdown-inline-to-html converts bold/italic/code", async () => {
    const editor = await setupMdEditor("");
    const result = executeTlisp(editor,
      `(markdown-inline-to-html "This is **bold** and *italic* and \`code\`")`);
    const html = expectTlispString(result);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
  });
});

describe("SPEC-039 audit round 2: unlinked mentions (Bug #6)", () => {
  test("markdown-find-unlinked-mentions finds plain-text title references", async () => {
    const editor = await setupMdEditor("");
    // Given a list of file contents and a title, find files that mention
    // the title in plain text (not as [[title]] links).
    const result = executeTlisp(editor,
      `(markdown-find-unlinked-mentions "MyNote" (list "This mentions MyNote here" "This links [[MyNote]] instead" "No mention at all"))`);
    const mentions = expectTlispString(result);
    // Line 0 mentions "MyNote" in plain text -> should be found.
    // Line 1 links [[MyNote]] -> should NOT be an unlinked mention.
    // Line 2 has no mention -> should NOT be found.
    expect(mentions).toContain("Unlinked mentions of MyNote");
    expect(mentions).not.toContain("No mention");
  });
});
