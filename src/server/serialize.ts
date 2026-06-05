import { FunctionalTextBufferImpl } from "../core/buffer.ts";
import type { EditorState, Tab, Window } from "../core/types.ts";

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
    buffer: FunctionalTextBufferImpl.create(
      typeof record.bufferContent === "string" ? record.bufferContent : "",
    ),
    cursorLine: numberOr(record.cursorLine, 0),
    cursorColumn: numberOr(record.cursorColumn, 0),
    viewportTop: numberOr(record.viewportTop, 0),
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
    buffer: FunctionalTextBufferImpl.create(
      typeof record.bufferContent === "string" ? record.bufferContent : "",
    ),
  };
}

export function editorStateToJson(state: EditorState): Record<string, unknown> {
  return {
    cursorPosition: state.cursorPosition,
    mode: state.mode,
    statusMessage: state.statusMessage,
    viewportTop: state.viewportTop,
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
  };
}

export function jsonToEditorState(json: Record<string, unknown>): EditorState {
  const windows = Array.isArray(json.windows)
    ? json.windows.map(deserializeWindow).filter((window): window is Window => window !== null)
    : [];
  const tabs = Array.isArray(json.tabs)
    ? json.tabs.map(deserializeTab).filter((tab): tab is Tab => tab !== null)
    : [];

  return {
    currentBuffer: FunctionalTextBufferImpl.create((json.bufferContent as string) || ""),
    cursorPosition: json.cursorPosition as EditorState["cursorPosition"],
    mode: json.mode as EditorState["mode"],
    statusMessage: json.statusMessage as string,
    viewportTop: json.viewportTop as number,
    config: json.config as EditorState["config"],
    commandLine: json.commandLine as string,
    mxCommand: json.mxCommand as string,
    currentFilename: json.currentFilename as string | undefined,
    currentMajorMode: (json.currentMajorMode as string | undefined) ?? "fundamental",
    activeMinorModes: (json.activeMinorModes as string[] | undefined) ?? [],
    activeMinorModeLighters: (json.activeMinorModeLighters as string[] | undefined) ?? [],
    minibufferState: json.minibufferState as EditorState["minibufferState"],
    minibufferView: json.minibufferView as EditorState["minibufferView"],
    buffers: new Map(),
    cursorFocus: json.cursorFocus === "command" ? "command" : "buffer",
    windows,
    currentWindowIndex: (json.currentWindowIndex as number | undefined) ?? 0,
    tabs,
    currentTabIndex: (json.currentTabIndex as number | undefined) ?? 0,
  };
}
