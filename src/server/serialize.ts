import { TextBufferImpl } from "../core/buffer.ts";
import { wikiDisplayActive, transformWikiLine } from "../frontend/render/wiki-display.ts";
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
// #318: stamp the transient-layer revision + the VIEWED thread's spinner
// segment onto the frame state (the client's SECOND comparison + the
// display row). INTERP executes against the serving editor's interpreter
// (gate r1: interpreter.execute returns Either {_tag:'Right', right:{value}}
// — unwrap BOTH layers). Exported — the keypress and render-state handlers
// call this ONE helper (the gate caught duplicated dead copies).
export function withTransientRevision<T extends object>(
  state: T,
  interp?: { execute: (expr: string) => unknown },
): T {
  // #319: a PURE stamp (revision + the viewed thread's segment). The
  // frozen-frame ACKNOWLEDGMENT lives in the render-state handler
  // (markTransientServed) — the POLL is the only path every rendering
  // client exercises; keypress responses are input round-trips that
  // `tmaxclient --keys` discards (codex r4 catch 1), so they must not
  // acknowledge.
  if (!interp) return state;
  const readTransient = (expr: string): unknown => {
    try {
      const r = interp.execute(expr) as { _tag?: string; right?: { value?: unknown }; value?: unknown };
      if (r && typeof r === "object" && r._tag === "Right" && r.right && typeof r.right === "object" && "value" in r.right) {
        return (r.right as { value: unknown }).value;
      }
      if (r && typeof r === "object" && "value" in r) return r.value;
      return undefined;
    } catch { return undefined; }
  };
  const rev = readTransient("(condition-case nil (progn (require-module fikra/transient) (fikra/transient/fikra-transient-revision)) (error () 0))");
  if (typeof rev === "number") (state as { transientRevision?: number }).transientRevision = rev;
  // #318 (gate r2 / codex r1 catch 2): resolve the segment for the
  // thread whose *Fikra* buffer THIS state views — a frame watching
  // *Fikra-fix-1* must not receive the daemon-current thread's spinner.
  // The name crosses TS→T-Lisp HEX-ENCODED (gate r3): the reader strips
  // backslash escapes in literals — the known pattern is hex-decode on
  // the T-Lisp side.
  const viewedBuffer = (state as { currentBufferName?: unknown }).currentBufferName;
  const segExpr = typeof viewedBuffer === "string"
    ? `(condition-case nil (progn (require-module fikra/transient) (fikra/transient/fikra-transient-viewed-segment-for (hex-decode "${Buffer.from(viewedBuffer, "utf8").toString("hex")}"))) (error () nil))`
    : "(condition-case nil (progn (require-module fikra/transient) (fikra-transient-viewed-segment)) (error () nil))";
  const seg = readTransient(segExpr);
  if (typeof seg === "string" && seg.length > 0) {
    (state as { transientSegment?: string }).transientSegment = seg;
  }
  return state;
}

/**
 * #319: acknowledge the frozen terminal frame for the thread a response's
 * viewed buffer displays — called ONLY by the render-state handler (the
 * poll path every rendering client exercises). Keypress responses are
 * input round-trips (`tmaxclient --keys` discards them) and never
 * acknowledge; capture never calls this either.
 */
export function markTransientServed(
  interp: { execute: (expr: string) => unknown } | undefined,
  viewedBuffer: string | undefined,
): void {
  if (!interp) return;
  const expr = typeof viewedBuffer === "string"
    ? `(condition-case nil (progn (require-module fikra/transient) (fikra/transient/fikra-transient-mark-rendered-for (hex-decode "${Buffer.from(viewedBuffer, "utf8").toString("hex")}"))) (error () nil))`
    : "(condition-case nil (progn (require-module fikra/transient) (fikra/transient-mark-rendered (fikra/thread/fikra-thread-current))) (error () nil))";
  try { interp.execute(expr); } catch { /* never fatal */ }
}

export function editorStateToJson(
  state: EditorState,
  renderHeight: number = DEFAULT_RENDER_HEIGHT,
  renderWidth?: number,
): SerializedEditorState {
  const buffer = state.currentBuffer;
  const viewportTop = Math.max(0, state.viewportTop);
  const rows = Math.max(1, Math.floor(renderHeight));

  // WRAP EXPANSION (2026-11-20 live catch): the client re-renders the wire
  // window with word wrap — one logical line can occupy MULTIPLE screen
  // rows, so a rows-sized window truncates the wrapped tail (large chat
  // buffers rendered blank tails; small buffers fit and masked it). When
  // wrap is on and the frame's width is known, walk lines accumulating
  // wrapped-row counts until the screen is covered (cw approximates the
  // gutter-reduced width conservatively; over-sending is harmless — the
  // client's ViewportBuffer just holds extra rows).
  //
  // #321 (capture-matrix catch): the walk ALSO stops only when the screen
  // is covered — at ~2 wrapped rows/line that halts at rows/2 LOGICAL
  // lines, while the logical clamp places the cursor up to `rows` lines
  // below top. The wire window then EXCLUDES the cursor line entirely and
  // the client (logical-only clamp) renders the cursor + tail below the
  // fold — the blank/frozen tail. The window must ALWAYS span through the
  // cursor line; the walk continues until the screen is covered AND the
  // cursor is inside.
  let neededRows = rows;
  if (state.config?.wordWrap && buffer) {
    const cursorLine = state.cursorPosition.line;
    // No width (render-state/no-frame paths) → no wrap estimate; still
    // guarantee the cursor line plus forward screen slack on the wire.
    if (!renderWidth || renderWidth <= 24) {
      neededRows = Math.min(
        Math.max(rows, cursorLine - viewportTop + 1 + rows),
        rows * 6, // same wire bound as the estimated walk
      );
    } else {
      // A LOWER BOUND on wrapped rows: the widest content width the
      // renderer uses (its gutter only SHRINKS cw → more rows). The old
      // width-12 approximation over-counted rows, exiting the walk early
      // (codex r2: 12 blank rows on the 90-col-after-long shape).
      const cw = renderWidth;
      const rowLimit = rows * 6; // wire bound: pathological single-line walls
      let wrappedRows = 0;
      let postCursorRows = 0; // wrapped rows FROM the cursor line onward
      let i = 0;
      // The window must fill THREE views: the screen at the current top,
      // the cursor itself (+1 slack — the client's whole-line advance can
      // overshoot), and a FULL SCREEN below the cursor — the wrap-aware
      // viewport advance starts at/near the cursor line, so a window that
      // stops at the cursor leaves the advanced frame's tail blank (codex:
      // the reproduced cursor-21-on-100 case).
      const dispText = (ln: number): string => {
        const lineResult = buffer.getLine(ln);
        const text = lineResult && lineResult._tag === "Right" ? lineResult.right : "";
        // #321 (codex r5): the DISPLAY text — the wiki-link transform
        // applies before wrapping (links displaying short made the raw
        // estimate over-send yet still miss the real layout).
        if (wikiDisplayActive(state)) {
          const t = transformWikiLine(text, undefined);
          if (t.changed) return t.text;
        }
        return text;
      };
      while ((wrappedRows < rows
              || viewportTop + i <= cursorLine + 1
              || postCursorRows < rows)
             && i < rowLimit) {
        const text = dispText(viewportTop + i);
        const w = Math.max(1, Math.ceil(Bun.stringWidth(text) / cw));
        wrappedRows += w;
        if (viewportTop + i >= cursorLine) postCursorRows += w;
        i++;
      }
      neededRows = Math.max(rows, i);
    }
  }
  // #318 (codex r4/r5): the client RESERVES the spinner row from its
  // buffer (spinnerRowReserved) and may then advance its effective
  // viewport to keep the cursor visible — the wire must cover that
  // window or the former bottom row renders blank. Applied AFTER the
  // wrap walk (which overwrites neededRows — the reservation is
  // additive on top of the wrapped window, not part of it).
  // Over-sending is harmless (the ViewportBuffer just holds extra rows).
  if (state.transientSegment) neededRows += 1;

  // Compute visibleLines: O(viewport), never O(file).
  const visibleLines: string[] = [];
  if (buffer) {
    for (let i = 0; i < neededRows; i++) {
      const lineResult = buffer.getLine(viewportTop + i);
      visibleLines.push(lineResult && lineResult._tag === "Right" ? lineResult.right : "");
    }
  } else {
    for (let i = 0; i < neededRows; i++) visibleLines.push("");
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
    // #231: transient goggles flash spans — the TUI client merges these into
    // its render and re-renders when flash presence changes (200 ms poll).
    flashSpans: state.flashSpans
      ? state.flashSpans.map((line) => line.map((s) => ({ start: s.start, end: s.end, style: s.style })))
      : undefined,
    ghostText: state.ghostText,
    ghostAnchor: state.ghostAnchor,
    config: state.config,
    commandLine: state.commandLine,
    mxCommand: state.mxCommand,
    currentFilename: state.currentFilename,
    // #253 wire gap: the modeline names named buffers (*Fikra*, *Help*) —
    // this field was never serialized, so every client rendered the
    // filename-or-*scratch* fallback over a named buffer (fikra modeline).
    currentBufferName: state.currentBufferName,
    currentMajorMode: state.currentMajorMode ?? "fundamental",
    activeMinorModes: state.activeMinorModes ?? [],
    activeMinorModeLighters: state.activeMinorModeLighters ?? [],
    minibufferState: state.minibufferState,
    minibufferView: state.minibufferView,
    cursorFocus: state.cursorFocus ?? "buffer",
    visibleLines,
    totalLines,
    bufferRevision: Date.now(),
    // #318: the TRANSIENT revision rides the same poll response — the
    // client compares BOTH counters independently (render on EITHER
    // change; transient 5→6 renders while buffer-rev stays 100).
    transientRevision: (state as unknown as { transientRevision?: number }).transientRevision,
    transientSegment: (state as unknown as { transientSegment?: string }).transientSegment,
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
    currentBufferName: record.currentBufferName as string | undefined,
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
    // #231: transient goggles flash spans must survive the round-trip or the
    // TUI client's render merge + poll edge-check are dead code (verify-gate B).
    flashSpans: (record.flashSpans as EditorState["flashSpans"]) ?? undefined,
    ghostText: (record.ghostText as string | undefined) ?? undefined,
    ghostAnchor: (record.ghostAnchor as EditorState["ghostAnchor"]) ?? undefined,
    // #318 (gate r2 CRITICAL): the transient spinner row must survive the
    // round-trip — render() reads state.transientSegment, so dropping it
    // here made the whole wire half dead code in the live TUI.
    transientRevision: (record.transientRevision as number | undefined) ?? undefined,
    transientSegment: (record.transientSegment as string | undefined) ?? undefined,
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
    // Never fabricate *scratch* when a filename is known — a null buffer
    // name over a file buffer showed the wrong modeline (fikra live catch).
    currentBufferName: data.currentBufferName ?? data.currentFilename ?? "*scratch*",
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
