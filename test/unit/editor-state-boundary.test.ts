/**
 * @file editor-state-boundary.test.ts
 * @description CHORE-39 Phase 5 boundary regression: the public EditorState
 * returned by getState()/getEditorState() and ingested by setEditorState()
 * must NOT share mutable Map/array/object references with the internal
 * EditorModel. Mutating public state must never mutate the model.
 */

import { describe, test, expect } from "bun:test";
import { createStartedEditor } from "../helpers/editor-fixture.ts";
import type { EditorState } from "../../src/core/types.ts";

describe("editor state boundary isolation", () => {
  test("mutating getState().buffers does not mutate the model", async () => {
    const editor = await createStartedEditor("hello");
    const beforeKeys = Array.from(editor.getModel().buffers?.keys() ?? []);

    const publicBuffers = editor.getState().buffers!;
    expect(publicBuffers.has("test")).toBe(true);
    // Mutate the public Map: add and remove entries.
    publicBuffers.set("foreign", publicBuffers.get("test")!);
    publicBuffers.delete("test");

    const modelKeys = Array.from(editor.getModel().buffers?.keys() ?? []);
    expect(modelKeys).toEqual(beforeKeys);
    // A fresh getState() is unaffected by the prior mutation.
    expect(editor.getState().buffers!.has("test")).toBe(true);
    expect(editor.getState().buffers!.has("foreign")).toBe(false);
  });

  test("mutating getState().windows / tabs / highlightSpans does not mutate the model", async () => {
    const editor = await createStartedEditor("a\nb\nc");
    const s1 = editor.getState();

    const windowsBefore = editor.getModel().windows?.length ?? 0;
    const tabsBefore = editor.getModel().tabs?.length ?? 0;

    s1.windows?.push({ id: "x", buffer: s1.currentBuffer!, cursorLine: 0, cursorColumn: 0, viewportTop: 0, viewportLeft: 0 });
    s1.tabs?.push({ id: "x", label: "x", buffer: s1.currentBuffer! });
    s1.highlightSpans?.push([]);

    expect(editor.getModel().windows?.length ?? 0).toBe(windowsBefore);
    expect(editor.getModel().tabs?.length ?? 0).toBe(tabsBefore);
    // Fresh getState() sees no leaked mutations.
    expect(editor.getState().windows?.length ?? 0).toBe(windowsBefore);
    expect(editor.getState().tabs?.length ?? 0).toBe(tabsBefore);
  });

  test("setEditorState does not retain caller-owned Map/array references", async () => {
    const editor = await createStartedEditor("hello");
    const original = editor.getState();

    const callerBuffers = new Map(original.buffers);
    const callerWindows = [...(original.windows ?? [])];
    const external: EditorState = {
      ...original,
      buffers: callerBuffers,
      windows: callerWindows,
      commandLine: "xyz",
    };
    editor.setEditorState(external);

    // Mutate the caller-owned collections AFTER setEditorState.
    callerBuffers.set("leaked", callerBuffers.get("test")!);
    callerBuffers.delete("test");
    callerWindows.push({ id: "leaked", buffer: callerBuffers.get("*Messages*")!, cursorLine: 0, cursorColumn: 0, viewportTop: 0, viewportLeft: 0 });

    // The model must reflect only what was committed, not the later mutation.
    expect(editor.getModel().buffers?.has("leaked")).toBe(false);
    expect(editor.getModel().buffers?.has("test")).toBe(true);
    expect(editor.getState().buffers!.has("leaked")).toBe(false);
    expect(editor.getState().commandLine).toBe("xyz");
  });

  test("mutating the public state returned after setEditorState does not mutate the model", async () => {
    const editor = await createStartedEditor("hello");
    editor.setEditorState({ ...editor.getState(), commandLine: "abc" });

    const after = editor.getState();
    expect(after.commandLine).toBe("abc");
    after.commandLine = "tampered";
    after.buffers?.delete("test");

    expect(editor.getModel().commandLine).toBe("abc");
    expect(editor.getModel().buffers?.has("test")).toBe(true);
  });

  test("getModel() returns a fresh reference after applyUpdate", async () => {
    const editor = await createStartedEditor("hello");
    const m1 = editor.getModel();
    editor.applyUpdate({ type: "SetCommandLine", value: "changed" });
    const m2 = editor.getModel();
    expect(m1).not.toBe(m2);
    expect(m2.commandLine).toBe("changed");
  });

  test("applyUpdate SetStatusMessage commits to model and surfaces via getState", async () => {
    const editor = await createStartedEditor("hello");
    editor.applyUpdate({ type: "SetStatusMessage", message: "status-x" });
    expect(editor.getModel().statusMessage).toBe("status-x");
    expect(editor.getState().statusMessage).toBe("status-x");
  });
});
