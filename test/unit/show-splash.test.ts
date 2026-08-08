import { describe, expect, test } from "bun:test";
import { createEditorFixture, bufferText } from "../helpers/editor-fixture.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";

// BUG-65: showSplashIfEmpty must seed the splash into an empty *scratch* on a
// fresh start, but must NOT clobber a current window that holds a restored
// name-only buffer (no filename) after a daemon restart. Both guard branches
// are pinned here; the end-to-end restart path is covered by the workspace-
// lifecycle integration test.

describe("BUG-65 Editor.showSplashIfEmpty", () => {
  test("seeds splash into an empty *scratch* on a fresh start", async () => {
    // start:false so start()'s own splash-seeding does not run; exercise the
    // daemon-side on-demand variant directly.
    const f = await createEditorFixture({ start: false });
    try {
      f.editor.createBuffer("*scratch*", ""); // empty *scratch*, current, no file
      f.editor.showSplashIfEmpty();
      expect(bufferText(f.editor)).toBe(TextBufferImpl.SPLASH_TEXT);
    } finally {
      f.dispose();
    }
  });

  test("does not clobber a current window holding a restored name-only buffer", async () => {
    const f = await createEditorFixture({ start: false });
    try {
      f.editor.createBuffer("*scratch*", "");        // empty *scratch* exists
      f.editor.createBuffer("durable.ts", "restored"); // ...and a restored buffer owns the window
      f.editor.showSplashIfEmpty();
      // The restored buffer stays current (the guard returns early); the splash
      // did not displace it. (Old behavior: *scratch* splash would become current.)
      expect(bufferText(f.editor)).toBe("restored");
      const win = f.editor.getState().windows?.[f.editor.getState().currentWindowIndex ?? 0];
      expect(win?.bufferName).toBe("durable.ts");
    } finally {
      f.dispose();
    }
  });
});

// BUG-76: the splash never cleared because (a) the clear expression referenced
// an out-of-bounds end line (lc = line COUNT, but lines are 0-indexed, so
// getText() returned Left and the whole `when` aborted) and (b) the logic was
// inlined in the handlers. The fix moves the clear into the T-Lisp command
// `clear-splash-if-present` (buffers.tlisp) — handlers stay thin routers — and
// deletes to line lc-1 with a large (clamped) column. The raw expression is
// pinned here (the logic), and a source-grep pins the shipped defun + handler
// wiring (start:false doesn't load the command modules, so we can't call the
// defun directly in this fixture).
describe("BUG-76 splash clear-on-first-keystroke", () => {
  // The exact body of clear-splash-if-present in buffers.tlisp. Must stay in
  // sync with the defun (also source-grep-pinned below).
  const CLEAR_EXPR =
    "(when (and (string= (buffer-current) \"*scratch*\") (string-prefix-p \"  tmax\" (buffer-text)))" +
    " (buffer-set-read-only nil)" +
    " (let ((lc (buffer-line-count))) (buffer-delete-range 0 0 (- lc 1) 99999)))";

  test("deletes all splash content and lifts read-only", async () => {
    const f = await createEditorFixture({ start: false });
    try {
      // Seed via the real path: empty *scratch* → showSplashIfEmpty seeds the
      // splash text AND marks *scratch* read-only.
      f.editor.createBuffer("*scratch*", "");
      f.editor.showSplashIfEmpty();
      expect(bufferText(f.editor)).toBe(TextBufferImpl.SPLASH_TEXT);
      expect(f.executeTlisp("(buffer-read-only-p)").value).toBe(true);

      f.executeTlisp(CLEAR_EXPR);

      expect(bufferText(f.editor)).toBe("");
      expect(f.executeTlisp("(buffer-read-only-p)").value).toBe(false);
    } finally {
      f.dispose();
    }
  });

  test("is a no-op on a non-scratch buffer (does not clear user content)", async () => {
    const f = await createEditorFixture({ start: false });
    try {
      // Content that WOULD match the splash sentinel — proves the (buffer-current)
      // guard, not the sentinel, is what scopes the clear to *scratch*.
      f.editor.createBuffer("notes.md", "  tmax is great\nkeep me");
      f.executeTlisp(CLEAR_EXPR);
      expect(bufferText(f.editor)).toBe("  tmax is great\nkeep me");
    } finally {
      f.dispose();
    }
  });

  test("clear-splash-if-present defun ships the corrected bounds in buffers.tlisp", async () => {
    const src = await Bun.file("src/tlisp/core/commands/buffers.tlisp").text();
    expect(src).toContain("(defun clear-splash-if-present ()");
    expect(src).toContain("(buffer-delete-range 0 0 (- lc 1) 99999)"); // NOT lc 0
    expect(src).not.toContain("(buffer-delete-range 0 0 lc 0)");        // old out-of-bounds form
  });

  test("handlers call clear-splash-if-present (thin router, no inline mutation)", async () => {
    const normal = await Bun.file("src/editor/handlers/normal-handler.ts").text();
    const insert = await Bun.file("src/editor/handlers/insert-handler.ts").text();
    expect(normal).toContain("(clear-splash-if-present)");
    expect(insert).toContain("(clear-splash-if-present)");
    // The buffer mutation must live in T-Lisp, not in the handlers.
    expect(normal).not.toContain("buffer-delete-range");
    expect(insert).not.toContain("buffer-delete-range");
  });
});
