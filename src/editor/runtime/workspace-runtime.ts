/**
 * @file workspace-runtime.ts
 * @description CHORE-44 Change 3 — workspace serialization/reconciliation
 * collaborator delegated by `Editor`.
 *
 * Owns the workspace **build** (snapshot editor-local buffers/layout/mode state
 * into a `WorkspaceState`) and **reconcile** (deep-copy an incoming workspace's
 * buffers + rebuild per-buffer metadata/mode-state maps) algorithms, so neither
 * lives in `Editor` (AC3.4). `Editor` supplies a state snapshot and applies the
 * results; this module never imports the concrete `Editor` class (AC3.3).
 */

import type { TextBuffer, BufferMetadata, WorkspaceState, Window, Tab, Position } from "../../core/types.ts";
import { TextBufferImpl } from "../../core/buffer.ts";
import { Either } from "../../utils/task-either.ts";
import type { BufferModeState, MinorModeConfig } from "../mode-state.ts";

/** Editor-side state snapshot consumed by serialization. */
export interface WorkspaceSnapshot {
  buffers: Map<string, TextBuffer>;
  bufferMetadata: Map<string, { filename?: string; modified: boolean; recency: number }>;
  bufferModeStates: Map<string, BufferModeState>;
  minorModeRegistry: Map<string, MinorModeConfig>;
  model: {
    currentBuffer?: TextBuffer;
    cursorPosition: Position;
    windows?: readonly Window[];
    tabs?: readonly Tab[];
    viewportTop: number;
    viewportLeft?: number;
    currentFilename?: string;
  };
  currentBufferName: string;
  currentMajorMode: string;
  activeMinorModes: string[];
  base?: WorkspaceState;
}

/** Result of reconciling an incoming workspace into fresh editor-local maps. */
export interface ReconciledWorkspace {
  buffers: Map<string, TextBufferImpl>;
  bufferMetadata: Map<string, { filename?: string; modified: boolean; recency: number }>;
  bufferModeStates: Map<string, BufferModeState>;
  /** Next recency counter value (after allocating for each rebuilt buffer). */
  nextRecency: number;
}

export class WorkspaceRuntime {
  /**
   * Reconcile an incoming workspace into fresh, isolated editor-local maps:
   * deep-copy buffers (so workspace state stays isolated), rebuild per-buffer
   * metadata with a fresh recency counter, and convert workspace mode-state
   * entries to the internal buffer-mode-state shape. `messagesRender` supplies
   * the *Messages* buffer content. AC3.4: this algorithm lives here, not Editor.
   */
  reconcileWorkspace(workspace: WorkspaceState, startRecency: number, messagesRender: string): ReconciledWorkspace {
    let recency = startRecency;
    const buffers = new Map<string, TextBufferImpl>();
    for (const [name, buffer] of workspace.buffers.entries()) {
      const contentResult = buffer.getContent();
      const content = Either.isRight(contentResult) ? contentResult.right : "";
      buffers.set(name, TextBufferImpl.create(content));
    }
    buffers.set("*Messages*", TextBufferImpl.create(messagesRender));

    const bufferMetadata = new Map<string, { filename?: string; modified: boolean; recency: number }>();
    for (const [name, metadata] of workspace.bufferMetadata.entries()) {
      bufferMetadata.set(name, {
        filename: metadata.filename,
        modified: metadata.modified,
        recency: recency++,
      });
    }
    bufferMetadata.set("*Messages*", { modified: false, recency: recency++ });

    const bufferModeStates = new Map<string, BufferModeState>();
    for (const [name, modeState] of workspace.bufferModeStates.entries()) {
      bufferModeStates.set(name, {
        majorMode: modeState.majorMode ?? "fundamental",
        activeMinorModes: modeState.minorModes ?? [],
        minorModeActivationOrder: modeState.minorModes ?? [],
        minorModeSources: Object.fromEntries((modeState.minorModes ?? []).map(mode => [mode, "local" as const])),
        localMinorModeOverrides: {},
        minorModeSavedConfig: {},
      });
    }

    return { buffers, bufferMetadata, bufferModeStates, nextRecency: recency };
  }

  /**
   * Snapshot editor-local buffers/layout back into a workspace-owned
   * `WorkspaceState`. Returned buffers are live references; consumers needing
   * isolation must deep-copy (reconcileWorkspace does so on the receiving end).
   */
  serializeWorkspace(snapshot: WorkspaceSnapshot): WorkspaceState {
    const now = new Date().toISOString();
    const base = snapshot.base;
    const metadata = base?.metadata ?? {
      id: globalThis.crypto.randomUUID(),
      name: "default",
      createdAt: now,
      lastAccessed: now,
      formatVersion: 1,
    };
    const buffers = new Map<string, TextBuffer>();
    const bufferMetadata = new Map<string, BufferMetadata>();
    const bufferModeStates = new Map<string, import("../../core/types.ts").BufferModeState>();

    const currentBufferName = snapshot.currentBufferName;

    for (const [name, buffer] of snapshot.buffers.entries()) {
      if (name === "*Messages*") continue;
      buffers.set(name, buffer);
      const meta = snapshot.bufferMetadata.get(name);
      const modeState = snapshot.bufferModeStates.get(meta?.filename ?? name);
      const isActiveBuffer = name === currentBufferName;
      const incomingMeta = base?.bufferMetadata?.get(name);
      bufferMetadata.set(name, {
        name,
        filename: meta?.filename,
        modified: meta?.modified ?? false,
        cursorLine: isActiveBuffer ? snapshot.model.cursorPosition.line : (incomingMeta?.cursorLine ?? 0),
        cursorColumn: isActiveBuffer ? snapshot.model.cursorPosition.column : (incomingMeta?.cursorColumn ?? 0),
      });
      bufferModeStates.set(name, {
        majorMode: modeState?.majorMode,
        minorModes: modeState?.activeMinorModes ?? [],
        lighters: (modeState?.activeMinorModes ?? [])
          .map(mode => snapshot.minorModeRegistry.get(mode)?.lighter ?? "")
          .filter(lighter => lighter !== ""),
      });
    }

    if (!buffers.has("*scratch*")) {
      buffers.set("*scratch*", TextBufferImpl.create(""));
      bufferMetadata.set("*scratch*", { name: "*scratch*", modified: false, cursorLine: 0, cursorColumn: 0 });
    }

    return {
      metadata: { ...metadata, lastAccessed: now },
      buffers,
      bufferMetadata,
      bufferModeStates,
      windows: [...(snapshot.model.windows ?? [])],
      tabs: [...(snapshot.model.tabs ?? [])],
      cursorState: { ...snapshot.model.cursorPosition },
      viewportState: { top: snapshot.model.viewportTop, left: snapshot.model.viewportLeft ?? 0 },
      currentBufferName,
      currentFilename: snapshot.model.currentFilename,
      currentMajorMode: snapshot.currentMajorMode,
      activeMinorModes: [...snapshot.activeMinorModes],
      activeMinorModeLighters: snapshot.activeMinorModes
        .map(m => snapshot.minorModeRegistry.get(m)?.lighter ?? "")
        .filter(l => l !== ""),
    };
  }
}
