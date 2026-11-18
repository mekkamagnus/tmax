/**
 * @file mx-nested-describe-status.test.ts
 * @description Issue #257 regression pin: driving describe-mode through the
 * NESTED M-x path (M-x → filter → Enter → nested completing-read prompt →
 * accept) must leave the model on *Help* AND the rendered status line naming
 * *Help* — repeatedly WITHIN ONE editor session (codex saw the status line
 * name *scratch* on rounds 2 and 3 of the grading arc, before the #253
 * status-line fix landed).
 */

import { describe, test, expect } from "bun:test";
import { createEditorFixture } from "../helpers/editor-fixture.ts";
import { renderStatusLine } from "../../src/frontend/render/status-line.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** The full nested sequence: M-x → "describe" → Enter (nested prompt opens)
 *  → "describe-mode" → Enter (nested accept runs describe-mode). */
async function nestedDescribe(editor: { handleKey(k: string): Promise<unknown> }): Promise<void> {
  await editor.handleKey(" ");  // SPC
  await editor.handleKey(";");  // leader → M-x
  for (const ch of "describe") await editor.handleKey(ch);
  await editor.handleKey("\r"); // select → nested "Describe function:" prompt
  for (const ch of "describe-mode") await editor.handleKey(ch);
  await editor.handleKey("\r"); // nested accept → describe-mode runs
}

describe("Nested M-x describe-mode status line (issue #257)", () => {
  // SAME editor for all three rounds — the codex observation was on the
  // second and third invocation within one session; a fresh-fixture-per-round
  // pin would miss a repeated-invocation regression (verify-gate round 1).
  test("rounds 1-3 in ONE session: *Help* in state AND status line each time", async () => {
    const fixture = await createEditorFixture();
    try {
      for (let round = 1; round <= 3; round++) {
        await nestedDescribe(fixture.editor);
        const state = fixture.editor.getState();
        expect(state.mode).toBe("normal");
        expect(state.currentBufferName).toBe("*Help*");
        const status = stripAnsi(renderStatusLine(state, 80));
        expect(status).toContain("*Help*");
        expect(status).not.toContain("*scratch*");
      }
    } finally {
      fixture.dispose();
    }
  }, 30000);
});
