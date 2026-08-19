import { TextBufferImpl } from "../core/buffer.ts";
import type { EditorState, Tab, Window } from "../core/contracts/editor.ts";
import type { TextBuffer } from "../core/contracts/buffer.ts";
import { Either } from "../utils/task-either.ts";
import type { WorkspaceState, WorkspaceData, BufferMetadata, BufferModeState } from "../core/contracts/workspace.ts";
import type { SerializedEditorState } from "./rpc/types.ts";

/**
 * Default rows serialized when no frame `terminalSize` is known (issue #46).
 * Matches the standard 24-row terminal minus the status line + minibuffer.
 * Callers with a real terminal height pass `renderHeight = height - 2`.
 */
export const DEFAULT_RENDER_HEIGHT = 22;

/**
 * Resolve the viewport height for serialization from a frame's recorded
 * `terminalSize` (issue #46). Returns `height - 2` (status line + minibuffer)
 * when known, otherwise {@link DEFAULT_RENDER_HEIGHT}. Handlers call this then
 * pass the result to {@link editorStateToJson}.
 */
export function renderHeightForTerminalSize(
  terminalSize: { width?: number; height?: number } | null | undefined,
): number {
  if (terminalSize && typeof terminalSize.height === "number" && terminalSize.height > 2) {
    return terminalSize.height - 2;
  }
  return DEFAULT_RENDER_HEIGHT;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/**
 * Read the line count of a buffer, unwrapping the Either. Returns 0 on a
 * missing buffer or a Left (never throws — serialization must stay total).
 */
function lineCountOf(buffer: EditorState["currentBuffer"]): number {
  if (!buffer) return 0;
  const result = buffer.getLineCount();
  return result && result._tag === "Right" ? result.right : 0;
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
    buffer: TextBufferImpl.create(""),
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
    buffer: TextBufferImpl.create(""),
    bufferName: typeof record.bufferName === "string" ? record.bufferName : undefined,
  };
}

/**
 * Serialize editor state to its viewport-only wire form (issue #46).
 *
 * `renderHeight` is the number of viewport rows to embed (default 22 = a 24-row
 * terminal minus status line + minibuffer). When a frame's real `terminalSize`
 * is known, pass `height - 2`. The wire carries ONLY those rows — not the full
 * buffer — so cost is O(viewport) per response regardless of file size.
 *
 * `bufferRevision` is a per-response counter (Date.now()) the client diffs to
 * detect change in O(1) instead of `JSON.stringify`-ing the whole state.
 */
export function editorStateToJson(
  state: EditorState,
  renderHeight: number = DEFAULT_RENDER_HEIGHT,
): SerializedEditorState {
  const buffer = state.currentBuffer;
  const viewportTop = Math.max(0, state.viewportTop);
  const rows = Math.max(1, Math.floor(renderHeight));

  // Compute visibleLines: O(viewport), never O(file).
  const visibleLines: string[] = [];
  if (buffer) {
    for (let i = 0; i < rows; i++) {
      const lineResult = buffer.getLine(viewportTop + i);
      visibleLines.push(lineResult && lineResult._tag === "Right" ? lineResult.right : "");
    }
  } else {
    for (let i = 0; i < rows; i++) visibleLines.push("");
  }

  const totalLines = lineCountOf(buffer);

  // Windows/tabs carry metadata only — their buffer text is NOT on the wire.
  const windows = state.windows?.map(({ buffer: _buffer, ...rest }) => rest) ?? [];
  const tabs = state.tabs?.map(({ buffer: _buffer, ...rest }) => rest) ?? [];

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
    visibleLines,
    totalLines,
    bufferRevision: Date.now(),
    // #201 (BUG-84): shell-mode's PTY screen + cursor ride the wire so the
    // TUI renders terminal mode from the daemon's TerminalManager.
    terminalLines: (state as unknown as { terminalLines?: string[] }).terminalLines,
    terminalCursor: (state as unknown as { terminalCursor?: { row: number; col: number } }).terminalCursor,
    windows,
    currentWindowIndex: state.currentWindowIndex ?? 0,
    tabs,
    currentTabIndex: state.currentTabIndex ?? 0,
    whichKeyActive: state.whichKeyActive ?? false,
    whichKeyPrefix: state.whichKeyPrefix ?? "",
    whichKeyBindings: state.whichKeyBindings ?? [],
    whichKeyPopup: state.whichKeyPopup ?? null,
  };
}

/**
 * Viewport-backed TextBuffer used client-side after deserialization (issue #46).
 *
 * Only the viewport rows that were on the wire are known. `getLine(i)` returns
 * the mapped row when `viewportTop <= i < viewportTop + visibleLines.length`,
 * otherwise `""`. `getLineCount()` returns `totalLines` so the gutter /
 * scrollback indicator render correctly. `getContent()` joins the viewport —
 * it is used only by non-rendering paths (e.g. capture's text fallback) and is
 * explicitly NOT the full file.
 *
 * Mutation operations (`insert`/`delete`/`replace`) are unsupported: the
 * client never edits the deserialized state — every keystroke round-trips to
 * the daemon, which owns the real buffer. They return Left so any accidental
 * call fails loudly instead of silently corrupting state.
 */
class ViewportBuffer implements TextBuffer {
  private readonly rows: readonly string[];
  private readonly top: number;
  private readonly count: number;

  constructor(visibleLines: string[], viewportTop: number, totalLines: number) {
    this.rows = visibleLines;
    this.top = Math.max(0, viewportTop);
    this.count = Math.max(totalLines, visibleLines.length);
  }

  getContent(): Either<string, string> {
    return Either.right(this.rows.join("\n"));
  }

  getLine(lineNumber: number): Either<string, string> {
    const offset = lineNumber - this.top;
    if (offset < 0 || offset >= this.rows.length) return Either.right("");
    return Either.right(this.rows[offset] ?? "");
  }

  getLineCount(): Either<string, number> {
    return Either.right(this.count);
  }

  insert(): Either<string, TextBuffer> {
    return Either.left("ViewportBuffer is read-only: edits must round-trip through the daemon (issue #46).");
  }

  delete(): Either<string, TextBuffer> {
    return Either.left("ViewportBuffer is read-only: edits must round-trip through the daemon (issue #46).");
  }

  replace(): Either<string, TextBuffer> {
    return Either.left("ViewportBuffer is read-only: edits must round-trip through the daemon (issue #46).");
  }

  getText(): Either<string, string> {
    return Either.right(this.rows.join("\n"));
  }

  getStats(): Either<string, { lines: number; characters: number; words: number }> {
    const text = this.rows.join("\n");
    const characters = text.length;
    const words = text.length === 0 ? 0 : text.split(/\s+/).filter(Boolean).length;
    return Either.right({ lines: this.count, characters, words });
  }
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

  // Viewport-backed current buffer (issue #46): reconstruct only the rows that
  // were on the wire. Out-of-viewport getLine() returns "".
  const visibleLines = Array.isArray(record.visibleLines)
    ? (record.visibleLines as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const viewportTop = numberOr(record.viewportTop, 0);
  const totalLines = numberOr(record.totalLines, visibleLines.length);
  const currentBuffer = new ViewportBuffer(visibleLines, viewportTop, totalLines);

  return {
    currentBuffer,
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
    // #201: shell-mode PTY screen + cursor (absent outside terminal mode).
    terminalLines: (record.terminalLines as string[] | undefined) ?? undefined,
    terminalCursor: (record.terminalCursor as { row: number; col: number } | undefined) ?? undefined,
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
