/**
 * @file macro-handler.test.ts
 * @description SPEC-044 Phase 1.F-1.H — vim macro record/play/replay bindings
 * wired through normal-handler.ts. Real keystrokes go through handleKey,
 * exercising the T-Lisp dispatcher (macros.tlisp), the handler pending-state
 * routing, and the recording-capture hook near the keymap executeCommand.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import {
  bufferText,
  createStartedEditor,
  executeTlisp,
} from "../helpers/editor-fixture.ts";
import { resetMacroRecordingState } from "../../src/editor/api/macro-recording.ts";

async function press(editor: Editor, keys: string): Promise<void> {
  for (const key of keys) {
    await editor.handleKey(key);
  }
}

// Macro recording state lives in a module-level singleton (api/macro-recording.ts),
// so tests must reset it between cases or recordings leak across the suite.
beforeEach(() => {
  resetMacroRecordingState();
});

function isRecording(editor: Editor): boolean {
  const value = executeTlisp(editor, "(macro-record-active)");
  return value.type === "boolean" && value.value === true;
}

function currentRegister(editor: Editor): string | null {
  const value = executeTlisp(editor, "(macro-record-register)");
  if (value.type === "nil") return null;
  if (value.type === "string") return value.value as string;
  return null;
}

function getMacroKeys(editor: Editor, register: string): string[] {
  const value = executeTlisp(editor, `(macro-list)`);
  if (value.type !== "list") return [];
  for (const entry of value.value as any[]) {
    const items = entry.value as any[];
    const reg = items[0];
    if (reg.type === "string" && reg.value === register) {
      const keys = items[1];
      if (keys.type === "list") {
        return (keys.value as any[]).map((v) => v.value as string);
      }
    }
  }
  return [];
}

describe("SPEC-044 Phase 1.F — q dispatcher records into registers", () => {
  test("qa enters recording state with register a", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "qa");
    expect(isRecording(editor)).toBe(true);
    expect(currentRegister(editor)).toBe("a");
  });

  test("qb enters recording state with register b", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "qb");
    expect(isRecording(editor)).toBe(true);
    expect(currentRegister(editor)).toBe("b");
  });

  test("q1 enters recording state with numbered register 1", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "q1");
    expect(isRecording(editor)).toBe(true);
    expect(currentRegister(editor)).toBe("1");
  });

  test("q during recording stops and saves the macro", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "qa");
    expect(isRecording(editor)).toBe(true);
    await press(editor, "q");
    expect(isRecording(editor)).toBe(false);
  });

  test("q<Escape> cancels pending record and quits the editor", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "q");
    await editor.handleKey("Escape");
    // Editor signals quit via EDITOR_QUIT_SIGNAL thrown from handleKey chain.
    // After the signal, recording must NOT be active.
    expect(isRecording(editor)).toBe(false);
    expect(currentRegister(editor)).toBe(null);
  });
});

describe("SPEC-044 Phase 1.G — recording-capture hook stores keys", () => {
  test("qa j x q records [j, x] into register a", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "qajxq");
    const keys = getMacroKeys(editor, "a");
    expect(keys).toEqual(["j", "x"]);
  });

  test("recording excludes the starting q<register> keys", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "qa");
    await press(editor, "jx");
    await press(editor, "q");
    const keys = getMacroKeys(editor, "a");
    // The starting "qa" must NOT appear in the recording.
    expect(keys).not.toContain("q");
    expect(keys).not.toContain("a");
    // But j and x must be there.
    expect(keys).toContain("j");
    expect(keys).toContain("x");
  });

  test("recording excludes the stopping q key", async () => {
    const editor = await createStartedEditor("hello\nworld");
    await press(editor, "qajxq");
    const keys = getMacroKeys(editor, "a");
    // Only j and x — the stopping q is NOT recorded.
    expect(keys).toEqual(["j", "x"]);
  });
});

describe("SPEC-044 Phase 1.H — @ plays, @@ replays last", () => {
  test("qa j x q then @a replays j and x on the next line", async () => {
    const editor = await createStartedEditor("aaa\nbbb\nccc");
    // Recording qajxq applies effects AS recorded: j moves to row 1,
    // x cuts first char of "bbb" → "bb". Buffer is now "aaa\nbb\nccc".
    await press(editor, "qajxq");
    expect(bufferText(editor)).toBe("aaa\nbb\nccc");
    // Playback @a applies j+x again from the current cursor (row 1, col 0):
    // j moves to row 2 (ccc), x cuts first char → "cc".
    await press(editor, "@a");
    expect(bufferText(editor)).toBe("aaa\nbb\ncc");
  });

  test("@@ replays the last-played macro", async () => {
    const editor = await createStartedEditor("aaa\nbbb\nccc\nddd");
    // Recording applies j+x to "bbb" → "bb". Buffer: "aaa\nbb\nccc\nddd".
    await press(editor, "qajxq");
    expect(bufferText(editor)).toBe("aaa\nbb\nccc\nddd");
    // @a: cursor at row 1 (after recording), j→row 2 (ccc), x→"cc".
    await press(editor, "@a");
    expect(bufferText(editor)).toBe("aaa\nbb\ncc\nddd");
    // @@ replays last macro: j→row 3 (ddd), x→"dd".
    await press(editor, "@@");
    expect(bufferText(editor)).toBe("aaa\nbb\ncc\ndd");
  });

  test("@ during record-pending followed by register plays the macro", async () => {
    const editor = await createStartedEditor("aaa\nbbb\nccc");
    await press(editor, "qajxq");
    expect(bufferText(editor)).toBe("aaa\nbb\nccc");
    // @ then a → plays register a: j→row 2 (ccc), x→"cc".
    await press(editor, "@a");
    expect(bufferText(editor)).toBe("aaa\nbb\ncc");
  });

  test("@ then non-register cancels play pending without playing", async () => {
    const editor = await createStartedEditor("aaa\nbbb\nccc");
    // Recording applies j+x once (bbb → bb). Buffer: "aaa\nbb\nccc".
    await press(editor, "qajxq");
    const textAfterRecording = bufferText(editor);
    // @ then Escape should cancel without playing.
    await press(editor, "@");
    await editor.handleKey("Escape");
    // Buffer unchanged because the macro didn't play.
    expect(bufferText(editor)).toBe(textAfterRecording);
  });
});
