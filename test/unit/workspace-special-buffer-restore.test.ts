/**
 * @file workspace-special-buffer-restore.test.ts
 * @description Issue #264: a window parked on *Messages* must survive a
 * workspace save/load round-trip. serializeWorkspace deliberately excludes
 * *Messages* from the persisted buffer list (it is regenerated from the
 * log), so restore must re-create missing referenced buffers instead of
 * rebinding the window to *scratch*.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceManager } from "../../src/core/workspace.ts";
import { WorkspaceRuntime } from "../../src/editor/runtime/workspace-runtime.ts";
import { TextBufferImpl } from "../../src/core/buffer.ts";
import { createEditorFixture } from "../helpers/editor-fixture.ts";
import { Either } from "../../src/utils/task-either.ts";
import type { WorkspaceState } from "../../src/core/types.ts";
import type { Window } from "../../src/core/contracts/editor.ts";

/** The workspace shape serializeWorkspace emits when the main window is on
 * *Messages*: the buffer list lacks it (excluded — regenerated at restore),
 * the window still references it by name. */
function workspaceWithMessagesWindow(): WorkspaceState {
  const scratch = TextBufferImpl.create("");
  const messages = TextBufferImpl.create("stale serialized content");
  const window: Window = {
    id: "window-main",
    buffer: messages,
    bufferName: "*Messages*",
    cursorLine: 0,
    cursorColumn: 0,
    viewportTop: 0,
    viewportLeft: 0,
    height: 22,
    width: 80,
  };
  const now = new Date().toISOString();
  return {
    metadata: { id: "ws-264", name: "issue-264", createdAt: now, lastAccessed: now, formatVersion: 1 },
    buffers: new Map([["*scratch*", scratch]]),
    bufferMetadata: new Map([["*scratch*", { name: "*scratch*", modified: false, cursorLine: 0, cursorColumn: 0 }]]),
    bufferModeStates: new Map([["*scratch*", {}]]),
    windows: [window],
    tabs: [],
    cursorState: { line: 0, column: 0 },
    viewportState: { top: 0 },
    currentBufferName: "*Messages*",
  } as WorkspaceState;
}

describe("Special-buffer window restore (issue #264)", () => {
  test("a window on *Messages* survives the save/load round-trip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tmax-ws-264-"));
    const manager = new WorkspaceManager(dir);
    const saved = await manager.save(workspaceWithMessagesWindow()).run();
    expect(saved._tag).toBe("Right");

    const loaded = await manager.load("issue-264").run();
    expect(loaded._tag).toBe("Right");
    if (loaded._tag === "Right") {
      // The binding survives: the window is NOT rebound to *scratch*.
      expect(loaded.right.windows[0]?.bufferName).toBe("*Messages*");
      expect(loaded.right.buffers.has("*Messages*")).toBe(true);
      // The miss is observably reported, not a silent fallback.
      expect(
        loaded.right.restoreWarnings?.some((w) => w.includes('"*Messages*"') && w.includes("window-main")),
      ).toBe(true);
    }
  });

  test("a tab on *Messages* survives the round-trip too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tmax-ws-264-tab-"));
    const manager = new WorkspaceManager(dir);
    const ws = workspaceWithMessagesWindow();
    ws.tabs = [{ id: "tab-1", label: "*Messages*", buffer: ws.windows[0]!.buffer, bufferName: "*Messages*" }] as WorkspaceState["tabs"];
    const saved = await manager.save(ws).run();
    expect(saved._tag).toBe("Right");

    const loaded = await manager.load("issue-264").run();
    expect(loaded._tag).toBe("Right");
    if (loaded._tag === "Right") {
      expect(loaded.right.tabs?.[0]?.bufferName).toBe("*Messages*");
    }
  });

  test("serializeWorkspace still excludes *Messages* while windows reference it (the pinned contract)", () => {
    const runtime = new WorkspaceRuntime();
    const ws = workspaceWithMessagesWindow();
    const out = runtime.serializeWorkspace({
      buffers: new Map([["*scratch*", ws.buffers.get("*scratch*")!], ["*Messages*", ws.windows[0]!.buffer]]),
      bufferMetadata: new Map(),
      bufferModeStates: new Map(),
      minorModeRegistry: new Map(),
      model: {
        cursorPosition: { line: 0, column: 0 },
        viewportTop: 0,
        viewportLeft: 0,
        windows: ws.windows,
        tabs: [],
      } as never,
      currentBufferName: "*Messages*",
      currentMajorMode: "fundamental",
      activeMinorModes: [],
      base: undefined,
    });
    // The exclusion the restore must handle: buffer list drops it…
    expect(out.buffers.has("*Messages*")).toBe(false);
    // …while the window still references it.
    expect(out.windows[0]?.bufferName).toBe("*Messages*");
  });

  test("applyWorkspace rebinds the restored window to the live *Messages* buffer", async () => {
    const fixture = await createEditorFixture();
    try {
      fixture.editor.logMessage("ROUND-TRIP-MARKER");
      const loaded = await (async () => {
        const dir = mkdtempSync(join(tmpdir(), "tmax-ws-264-e2e-"));
        const manager = new WorkspaceManager(dir);
        await manager.save(workspaceWithMessagesWindow()).run();
        return manager.load("issue-264").run();
      })();
      expect(loaded._tag).toBe("Right");
      if (Either.isLeft(loaded)) return;

      fixture.editor.applyWorkspace(loaded.right);
      const state = fixture.editor.getState();
      expect(state.windows?.[0]?.bufferName).toBe("*Messages*");
      // The window's buffer is the reconciled live *Messages* instance —
      // the same one the model switched to (identity, not a placeholder or
      // a *scratch* stand-in) — carrying the log render, not empty content.
      expect(state.windows?.[0]?.buffer).toBe(state.currentBuffer);
      const content = state.windows?.[0]?.buffer?.getContent();
      expect(content && Either.isRight(content)).toBe(true);
      if (content && Either.isRight(content)) {
        expect(content.right).toContain("ROUND-TRIP-MARKER");
        expect(content.right.length).toBeGreaterThan(0);
      }
    } finally {
      fixture.dispose();
    }
  });
});
