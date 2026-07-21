import { TextBufferImpl } from "../core/buffer.ts";
import type { EditorState, Tab, Window } from "../core/contracts/editor.ts";
import type { TextBuffer } from "../core/contracts/buffer.ts";
import type { WorkspaceState, WorkspaceData, BufferMetadata, BufferModeState } from "../core/contracts/workspace.ts";
import type { SerializedEditorState } from "./rpc/types.ts";

function bufferContent(buffer: EditorState["currentBuffer"]): string {
  if (!buffer) return "";
  const result = buffer.getContent();
  return result._tag === "Right" ? result.right : "";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function deserializeWindow(raw: unknown): Window | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string") return null;

  const splitType = record.splitType === "horizontal" || record.splitType === "vertical"
    ? record.splitType
    : undefined;

  return {
    id: record.id,
    buffer: TextBufferImpl.create(
      typeof record.bufferContent === "string" ? record.bufferContent : "",
    ),
    bufferName: typeof record.bufferName === "string" ? record.bufferName : undefined,
    cursorLine: numberOr(record.cursorLine, 0),
    cursorColumn: numberOr(record.cursorColumn, 0),
    viewportTop: numberOr(record.viewportTop, 0),
    viewportLeft: numberOr(record.viewportLeft, 0),
    ...(splitType ? { splitType } : {}),
    ...(typeof record.height === "number" ? { height: record.height } : {}),
    ...(typeof record.width === "number" ? { width: record.width } : {}),
    ...(typeof record.row === "number" ? { row: record.row } : {}),
    ...(typeof record.col === "number" ? { col: record.col } : {}),
  };
}

function deserializeTab(raw: unknown): Tab | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.label !== "string") return null;

  return {
    id: record.id,
    label: record.label,
    buffer: TextBufferImpl.create(
      typeof record.bufferContent === "string" ? record.bufferContent : "",
    ),
    bufferName: typeof record.bufferName === "string" ? record.bufferName : undefined,
  };
}

export function editorStateToJson(state: EditorState): SerializedEditorState {
  return {
    cursorPosition: state.cursorPosition,
    mode: state.mode,
    statusMessage: state.statusMessage,
    viewportTop: state.viewportTop,
    viewportLeft: state.viewportLeft,
    config: state.config,
    commandLine: state.commandLine,
    mxCommand: state.mxCommand,
    currentFilename: state.currentFilename,
    currentMajorMode: state.currentMajorMode ?? "fundamental",
    activeMinorModes: state.activeMinorModes ?? [],
    activeMinorModeLighters: state.activeMinorModeLighters ?? [],
    minibufferState: state.minibufferState,
    minibufferView: state.minibufferView,
    cursorFocus: state.cursorFocus ?? "buffer",
    bufferContent: bufferContent(state.currentBuffer),
    windows: state.windows?.map(window => {
      const { buffer, ...rest } = window;
      return { ...rest, bufferContent: bufferContent(buffer) };
    }) ?? [],
    currentWindowIndex: state.currentWindowIndex ?? 0,
    tabs: state.tabs?.map(tab => {
      const { buffer, ...rest } = tab;
      return { ...rest, bufferContent: bufferContent(buffer) };
    }) ?? [],
    currentTabIndex: state.currentTabIndex ?? 0,
    whichKeyActive: state.whichKeyActive ?? false,
    whichKeyPrefix: state.whichKeyPrefix ?? "",
    whichKeyBindings: state.whichKeyBindings ?? [],
    whichKeyPopup: state.whichKeyPopup ?? null,
  };
}

export function jsonToEditorState(json: SerializedEditorState): EditorState;
export function jsonToEditorState(json: Record<string, unknown>): EditorState;
export function jsonToEditorState(json: SerializedEditorState | Record<string, unknown>): EditorState {
  const record = json as Record<string, unknown>;
  const windows = Array.isArray(record.windows)
    ? record.windows.map(deserializeWindow).filter((window): window is Window => window !== null)
    : [];
  const tabs = Array.isArray(record.tabs)
    ? record.tabs.map(deserializeTab).filter((tab): tab is Tab => tab !== null)
    : [];

  return {
    currentBuffer: TextBufferImpl.create((record.bufferContent as string) || ""),
    cursorPosition: record.cursorPosition as EditorState["cursorPosition"],
    mode: record.mode as EditorState["mode"],
    statusMessage: record.statusMessage as string,
    viewportTop: record.viewportTop as number,
    viewportLeft: (record.viewportLeft as number | undefined) ?? 0,
    config: record.config as EditorState["config"],
    commandLine: record.commandLine as string,
    mxCommand: record.mxCommand as string,
    currentFilename: record.currentFilename as string | undefined,
    currentMajorMode: (record.currentMajorMode as string | undefined) ?? "fundamental",
    activeMinorModes: (record.activeMinorModes as string[] | undefined) ?? [],
    activeMinorModeLighters: (record.activeMinorModeLighters as string[] | undefined) ?? [],
    minibufferState: record.minibufferState as EditorState["minibufferState"],
    minibufferView: record.minibufferView as EditorState["minibufferView"],
    buffers: new Map(),
    cursorFocus: record.cursorFocus === "command" ? "command" : "buffer",
    windows,
    currentWindowIndex: (record.currentWindowIndex as number | undefined) ?? 0,
    tabs,
    currentTabIndex: (record.currentTabIndex as number | undefined) ?? 0,
    whichKeyActive: (record.whichKeyActive as boolean | undefined) ?? false,
    whichKeyPrefix: (record.whichKeyPrefix as string | undefined) ?? "",
    whichKeyBindings: (record.whichKeyBindings as EditorState["whichKeyBindings"]) ?? [],
    whichKeyPopup: (record.whichKeyPopup as EditorState["whichKeyPopup"]) ?? null,
  };
}

// =============================================================================
// WORKSPACE SERIALIZATION (RFC-014)
// =============================================================================

/**
 * Convert WorkspaceState to WorkspaceData for serialization
 *
 * Converts buffer references to string contents and serializes all metadata.
 */
export function workspaceToData(workspace: WorkspaceState): WorkspaceData {
  const buffers: WorkspaceData["buffers"] = [];

  for (const [name, buffer] of workspace.buffers.entries()) {
    const meta = workspace.bufferMetadata.get(name);
    const modeState = workspace.bufferModeStates.get(name);

    const contentResult = buffer.getContent();
    if (contentResult._tag === "Left") {
      // If we can't get buffer content, use empty string
      console.error(`Failed to get buffer content for ${name}: ${contentResult.left}`);
    }

    buffers.push({
      name,
      filename: meta?.filename,
      content: contentResult._tag === "Right" ? contentResult.right : "",
      modified: meta?.modified ?? false,
      majorMode: meta?.majorMode,
      cursorLine: meta?.cursorLine ?? 0,
      cursorColumn: meta?.cursorColumn ?? 0,
      minorModes: modeState?.minorModes,
      lighters: modeState?.lighters
    });
  }

  return {
    metadata: workspace.metadata,
    buffers,
    windows: workspace.windows.map(win => {
      // R3-2: use cached bufferName when available (identity check fails after mutations)
      let winBufferName = win.bufferName ?? "";
      if (!winBufferName && win.buffer) {
        for (const [name, buf] of workspace.buffers.entries()) {
          if (buf === win.buffer) { winBufferName = name; break; }
        }
      }
      return {
      id: win.id,
      bufferName: winBufferName,
      cursorLine: win.cursorLine,
      cursorColumn: win.cursorColumn,
      viewportTop: win.viewportTop,
      viewportLeft: win.viewportLeft,
      splitType: win.splitType,
      height: win.height,
      width: win.width,
      row: win.row,
      col: win.col,
      scrollback: win.scrollback ? {
        capacity: win.scrollback.capacity,
        lines: win.scrollback.lines,
        size: win.scrollback.size,
        head: win.scrollback.head,
        tail: win.scrollback.tail,
        viewportOffset: win.scrollback.viewportOffset
      } : undefined
      };
    }),
    tabs: workspace.tabs.map(tab => {
      let tabBufferName = tab.bufferName ?? "";
      if (!tabBufferName && tab.buffer) {
        for (const [name, buf] of workspace.buffers.entries()) {
          if (buf === tab.buffer) { tabBufferName = name; break; }
        }
      }
      return {
      id: tab.id,
      label: tab.label,
      bufferName: tabBufferName
      };
    }),
    cursorState: workspace.cursorState,
    viewportState: workspace.viewportState,
    currentBufferName: workspace.currentBufferName,
    currentFilename: workspace.currentFilename,
    currentMajorMode: workspace.currentMajorMode,
    activeMinorModes: workspace.activeMinorModes,
    activeMinorModeLighters: workspace.activeMinorModeLighters
  };
}

/**
 * Convert WorkspaceData to WorkspaceState for deserialization
 *
 * Reconstructs TextBuffer instances from string contents.
 */
export function dataToWorkspace(data: WorkspaceData): WorkspaceState {
  // Reconstruct buffers
  const buffers = new Map<string, TextBuffer>();
  const bufferMetadata = new Map<string, BufferMetadata>();
  const bufferModeStates = new Map<string, BufferModeState>();

  for (const bufferData of data.buffers ?? []) {
    const buffer = TextBufferImpl.create(bufferData.content);
    buffers.set(bufferData.name, buffer);
    bufferMetadata.set(bufferData.name, {
      name: bufferData.name,
      filename: bufferData.filename,
      modified: bufferData.modified,
      majorMode: bufferData.majorMode,
      cursorLine: bufferData.cursorLine,
      cursorColumn: bufferData.cursorColumn
    });
    bufferModeStates.set(bufferData.name, {
      majorMode: bufferData.majorMode,
      minorModes: bufferData.minorModes,
      lighters: bufferData.lighters
    });
  }

  // Ensure *scratch* exists (for old workspaces)
  if (!buffers.has("*scratch*")) {
    const scratchBuffer = TextBufferImpl.create("");
    buffers.set("*scratch*", scratchBuffer);
    bufferMetadata.set("*scratch*", {
      name: "*scratch*",
      modified: false,
      cursorLine: 0,
      cursorColumn: 0
    });
    bufferModeStates.set("*scratch*", {});
  }

  // Reconstruct windows with buffer references
  const windows: Window[] = [];
  for (const winData of data.windows ?? []) {
    const resolvedName = buffers.has(winData.bufferName) ? winData.bufferName : "*scratch*";
    // R3-10: warn when buffer reference can't be resolved
    if (winData.bufferName && !buffers.has(winData.bufferName)) {
      console.warn(`dataToWorkspace: window "${winData.id}" references unknown buffer "${winData.bufferName}", falling back to *scratch*`);
    }
    const buffer = buffers.get(resolvedName)!;
    const window: Window = {
      id: winData.id,
      buffer,
      bufferName: resolvedName,
      cursorLine: winData.cursorLine,
      cursorColumn: winData.cursorColumn,
      viewportTop: winData.viewportTop,
      viewportLeft: winData.viewportLeft ?? 0,
      ...(winData.splitType ? { splitType: winData.splitType } : {}),
      ...(winData.height !== undefined ? { height: winData.height } : {}),
      ...(winData.width !== undefined ? { width: winData.width } : {}),
      ...(winData.row !== undefined ? { row: winData.row } : {}),
      ...(winData.col !== undefined ? { col: winData.col } : {}),
      ...(winData.scrollback ? {
        scrollback: {
          lines: winData.scrollback.lines,
          capacity: winData.scrollback.capacity,
          head: winData.scrollback.head,
          tail: winData.scrollback.tail,
          size: winData.scrollback.size,
          viewportOffset: winData.scrollback.viewportOffset
        }
      } : {})
    };
    windows.push(window);
  }

  // Reconstruct tabs with buffer references
  const tabs: Tab[] = [];
  for (const tabData of data.tabs ?? []) {
    const resolvedName = buffers.has(tabData.bufferName) ? tabData.bufferName : "*scratch*";
    if (tabData.bufferName && !buffers.has(tabData.bufferName)) {
      console.warn(`dataToWorkspace: tab "${tabData.id}" references unknown buffer "${tabData.bufferName}", falling back to *scratch*`);
    }
    const buffer = buffers.get(resolvedName)!;
    const tab: Tab = {
      id: tabData.id,
      label: tabData.label,
      buffer,
      bufferName: resolvedName
    };
    tabs.push(tab);
  }

  return {
    metadata: data.metadata,
    buffers,
    bufferMetadata,
    bufferModeStates,
    windows,
    tabs,
    cursorState: data.cursorState ?? { line: 0, column: 0 },
    viewportState: data.viewportState ?? { top: 0 },
    currentBufferName: data.currentBufferName ?? "*scratch*",
    currentFilename: data.currentFilename,
    currentMajorMode: data.currentMajorMode,
    activeMinorModes: data.activeMinorModes,
    activeMinorModeLighters: data.activeMinorModeLighters
  };
}

/**
 * Deserialize a buffer list from raw JSON data
 *
 * Helper function for converting array of buffer data to Map.
 */
export function deserializeBufferList(raw: unknown[]): Map<string, ReturnType<typeof TextBufferImpl.create>> {
  const buffers = new Map<string, ReturnType<typeof TextBufferImpl.create>>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;

    if (typeof record.name === "string" && typeof record.content === "string") {
      buffers.set(record.name, TextBufferImpl.create(record.content));
    }
  }

  // Ensure *scratch* exists
  if (!buffers.has("*scratch*")) {
    buffers.set("*scratch*", TextBufferImpl.create(""));
  }

  return buffers;
}
