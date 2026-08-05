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
