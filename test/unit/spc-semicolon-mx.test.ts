import { describe, expect, it } from "bun:test";
import type { Editor } from "../../src/editor/editor.ts";
import { createStartedEditor, executeTlisp } from "../helpers/editor-fixture.ts";
import { dispatchSerialized } from "../../src/steep/input.ts";
import { tokenizeSteepInput } from "../../src/steep/input.ts";

// #195 / BUG-81 — "SPC ;" must enter M-x in the LIVE editor, not only in
// sequential fixtures. Two regressions live here:
//
// 1. Sequential handleKey calls (the original fixture path) — pins the
//    engine-level behavior that was already correct.
// 2. Coalesced single-chunk delivery through the real Steep dispatch path
//    (dispatchSerialized feeding editor.handleKey) — pins the bug the live
//    editor had: keys from one stdin chunk used to dispatch CONCURRENTLY, so
//    the ";" read leader state before the " " had set it.

function mode(editor: Editor): string {
  return editor.getEditorState().mode;
}

describe("#195 (BUG-81): SPC ; enters M-x", () => {
  it("sequential handleKey calls enter mx mode", async () => {
    const editor = await createStartedEditor("");
    await editor.handleKey(" ");
    await editor.handleKey(";");
    expect(mode(editor)).toBe("mx");
  });

  it("coalesced single-chunk dispatch through the real input path enters mx mode", async () => {
    const editor = await createStartedEditor("");
    // Exactly what a terminal delivers when "SPC ;" is typed fast: one stdin
    // read containing both keys, tokenized, then serialized onto the chain.
    const messages = tokenizeSteepInput(" ;", "").messages;
    await dispatchSerialized(messages, async (msg) => {
      await editor.handleKey(msg.key);
    }, Promise.resolve());
    expect(mode(editor)).toBe("mx");
  });

  it("typed M-x input reaches the minibuffer and Enter completes the session", async () => {
    // #195 scope is M-x ENTRY. Full command execution from M-x is broken
    // separately (#226 / BUG-83: accepted commands don't run — editor-quit's
    // signal and command errors are swallowed in the minibuffer accept path).
    // Here we pin the #195 boundary: typed input reaches the minibuffer, and
    // Enter closes the M-x session (mx → normal). NOTE: once #226 lands,
    // Enter on "editor-quit" will genuinely quit — revisit this assertion
    // then (it should still pass: quit also leaves mx, via teardown).
    const editor = await createStartedEditor("");
    await editor.handleKey(" ");
    await editor.handleKey(";");
    expect(mode(editor)).toBe("mx");
    for (const key of "editor-quit") {
      await editor.handleKey(key);
    }
    expect(editor.getEditorState().minibufferView?.input).toBe("editor-quit");
    await editor.handleKey("Enter");
    expect(mode(editor)).not.toBe("mx");
  });

  it("quit signal contract: a handler that resolves after its own catch does not break the chain (SteepFrontend shape)", async () => {
    // SteepFrontend's onKey handler never rejects: it catches everything
    // itself, and EDITOR_QUIT_SIGNAL resolves through cleanup/exit inside the
    // handler. Pin that dispatchSerialized's defensive .catch does not
    // intercept (or delay) that contract: after a quit-shaped call resolves,
    // later keys in the same chunk still dispatch.
    const events: string[] = [];
    const handler = async (msg: { key: string }) => {
      try {
        if (msg.key === "q") throw new Error("EDITOR_QUIT_SIGNAL");
        events.push(msg.key);
      } catch (error) {
        // handler owns the signal: records it, resolves normally
        events.push(`handled:${(error as Error).message}`);
      }
    };

    await dispatchSerialized(
      tokenizeSteepInput("qx").messages,
      handler,
      Promise.resolve(),
    );
    expect(events).toEqual(["handled:EDITOR_QUIT_SIGNAL", "x"]);
  });
});
