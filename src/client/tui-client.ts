#!/usr/bin/env bun
/**
 * @file tui-client.ts
 * @description TUI client that connects to a running tmax daemon and renders
 * the editor using native ANSI escape sequences (Steep-style rendering).
 */

import { RemoteEditor } from "../editor/remote-editor.ts";
import { renderBufferLines, getVisibleViewportTop, getWrappedViewportTop, getWrappedCursorRow, getWrappedCursorColumn, getCursorScreenOffset, wordWrapActive } from "../frontend/render/buffer-lines.ts";
import { mergeFlashSpans } from "../render/flash-merge.ts";
export { mergeFlashSpans };
import { renderStatusLine } from "../frontend/render/status-line.ts";
import { renderCommandInput } from "../frontend/render/command-input.ts";
import { tokenizeTerminalInput } from "../frontend/render/input.ts";
import { renderTabBarAnsi } from "../frontend/render/tab-bar.ts";
import type { EditorState } from "../core/contracts/editor.ts";
import { renderMinibuffer } from "../frontend/render/minibuffer.ts";
import { renderWhichKeyOverlay } from "../frontend/render/which-key-overlay.ts";
import { computeHighlightSpans } from "../syntax/highlight-buffer.ts";
import { makeWikiLinkResolver } from "../syntax/wiki-link-faces.ts";
import type { HighlightSpan } from "../core/contracts/editor.ts";
import { Either } from "../utils/task-either.ts";
import { repaintSnapshot, shouldRepaint, spinnerRowReserved } from "./repaint-decision.ts";

function enterAltScreen() {
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write("\x1b[?25l");
}

function exitAltScreen() {
  process.stdout.write("\x1b[?25h");
  process.stdout.write("\x1b[?1049l");
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function writeAt(row: number, col: number, text: string) {
  process.stdout.write(`\x1b[${row + 1};${col + 1}H${text}`);
}

function moveTo(row: number, col: number) {
  process.stdout.write(`\x1b[${row + 1};${col + 1}H`);
}

function getDims() {
  return {
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  };
}

function render(state: EditorState) {
  const { width, height } = getDims();

  // #201 (BUG-84): terminal mode renders the daemon's PTY screen — not the
  // editor buffer — plus the status line and the PTY's own cursor.
  const termLines = state.terminalLines;
  if (state.mode === "terminal" && termLines) {
    clearScreen();
    // #202: lines are ANSI-styled — never .slice() them (that can cut an
    // escape sequence mid-code). The PTY's width matches the pane (resize
    // forwards), so rows are already width-bounded.
    termLines.slice(0, height - 1).forEach((line, i) => writeAt(i, 0, line));
    writeAt(height - 1, 0, renderStatusLine(state, width));
    const tc = state.terminalCursor;
    if (tc) moveTo(Math.max(0, Math.min(height - 2, tc.row)), Math.max(0, Math.min(width - 1, tc.col)));
    return;
  }

  const hasTabBar = (state.tabs?.length ?? 0) > 1;
  const tabBarHeight = hasTabBar ? 1 : 0;
  const minibuffer = state.minibufferView ? renderMinibuffer(state.minibufferView, width) : undefined;
  const commandHeight = minibuffer?.lines.length ?? ((state.mode === "command" || state.mode === "mx") ? 1 : 0);
  // #318 (codex r3): while the spinner renders, its row is RESERVED
  // from the buffer — the last chat line stays visible for the whole
  // turn (the row is given back when the segment clears).
  const spinnerRow = spinnerRowReserved(state) ? 1 : 0;
  const bufferHeight = Math.max(1, height - 1 - commandHeight - tabBarHeight - spinnerRow);
  // #321: wrap-aware top — spans cover the range the wrapped render walks.
  const vt = wordWrapActive(state)
    ? getWrappedViewportTop(state, bufferHeight, width)
    : getVisibleViewportTop(state, bufferHeight);
  const spanHeight = wordWrapActive(state) ? bufferHeight * 2 : bufferHeight;
  const getLine = (ln: number) => {
    const r = state.currentBuffer?.getLine(ln);
    return r && Either.isRight(r) ? r.right : "";
  };
  let spans = state.currentBuffer
    ? computeHighlightSpans(
        getLine,
        vt,
        vt + spanHeight,
        state.currentFilename,
        // SPEC-118: dim dangling [[wiki-links]] (no-op for non-markdown langs).
        makeWikiLinkResolver(state.currentBuffer, state.currentFilename),
      )
    : undefined;

  // Dim the splash screen in *scratch* (like vim's intro). Client-side detection:
  // no filename + line 0 starts with "  tmax" = the splash sentinel.
  if (!state.currentFilename && getLine(0)?.startsWith("  tmax")) {
    spans = [];
    for (let i = vt; i < vt + bufferHeight; i++) {
      const lineText = getLine(i);
      spans.push(lineText
        ? [{ start: 0, end: lineText.length, style: { dim: true } }]
        : []);
    }
  }
  // #231: merge the transient goggles flash spans (from render-state) on top.
  spans = mergeFlashSpans(spans, state.flashSpans);
  const lines = renderBufferLines(state, width, bufferHeight, spans);

  clearScreen();
  if (hasTabBar) {
    writeAt(0, 0, renderTabBarAnsi(state.tabs!, state.currentTabIndex ?? 0, width));
  }
  lines.forEach((line, i) => writeAt(i + tabBarHeight, 0, line));

  if (minibuffer) {
    const start = height - 1 - minibuffer.lines.length;
    minibuffer.lines.forEach((line, index) => writeAt(start + index, 0, line));
  } else if (state.mode === "command" || state.mode === "mx") {
    writeAt(height - 2, 0, renderCommandInput(state, width));
  } else if (state.statusMessage) {
    // #318 (gate r2): status messages WIN over the spinner — a running
    // thread must not hide "Fikra: approve …" or error feedback.
    const msg = state.statusMessage.length > width ? state.statusMessage.slice(0, width - 1) : state.statusMessage;
    writeAt(height - 2, 0, msg + "\x1b[K");
  } else if (state.transientSegment) {
    // #318: the transient spinner row (the viewed thread is running) —
    // only when no status message holds the row. Trailing \x1b[K so a
    // shorter spinner row clears the previous longer row's tail.
    const msg = state.transientSegment.length > width ? state.transientSegment.slice(0, width - 1) : state.transientSegment;
    writeAt(height - 2, 0, msg + "\x1b[K");
  }

  writeAt(height - 1, 0, renderStatusLine(state, width));

  // Which-key popup overlay on bottom of buffer area
  if (state.whichKeyActive && state.whichKeyPopup) {
    const overlayLines = renderWhichKeyOverlay(state.whichKeyPopup, width);
    const overlayStart = tabBarHeight + bufferHeight - overlayLines.length;
    overlayLines.forEach((line, i) => writeAt(overlayStart + i, 0, line));
  }

  if (minibuffer) {
    moveTo(height - 1 - minibuffer.lines.length + minibuffer.cursorRow, minibuffer.cursorColumn);
  } else {
    // #321 (codex): the hardware cursor rides the WRAPPED layout (the
    // renderer advances the top wrap-awarely — a logical row put it on the
    // wrong screen line). The COLUMN keeps the logical path's gutter-
    // aware math in both modes.
    const cursorRow = Math.max(0, Math.min(bufferHeight - 1,
      wordWrapActive(state) ? getWrappedCursorRow(state, bufferHeight, width) : getCursorScreenOffset(state, bufferHeight, width).row));
    const cursorCol = Math.max(0, Math.min(width - 1,
      wordWrapActive(state) ? getWrappedCursorColumn(state, width) : getCursorScreenOffset(state, bufferHeight, width).col));
    moveTo(cursorRow + tabBarHeight, cursorCol);
  }
}

/** Render the last cached state with a disconnect banner — NO daemon round-trip
 *  (the socket is gone). Used when the daemon drops (BUG-36 / #54). */
function renderDisconnected(state: EditorState): void {
  render({ ...state, statusMessage: "daemon disconnected — press q or Esc to quit" });
}

// #250: exported so main.ts can route the launcher's internal --tui-client
// child-process flag here (the compiled binary re-execs itself for TUI
// attach). `import.meta.main` below keeps direct `bun tui-client.ts` runs
// working.
export async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
tmax-tui - TUI client for tmax daemon

Usage: tmax-tui [options]

Options:
  -s, --socket PATH   Custom socket path
  --workspace NAME    Connect to workspace
  -h, --help          Show this help message

Requires a running tmax daemon. Start one with:
  tmax --daemon
    `);
    process.exit(0);
  }

  let socketPath: string | undefined;
  let workspaceId: string | undefined;
  const socketIndex = args.indexOf("-s");
  if (socketIndex !== -1) socketPath = args[socketIndex + 1];
  const socketArgIndex = args.indexOf("--socket");
  if (socketArgIndex !== -1) socketPath = args[socketArgIndex + 1];
  const workspaceIndex = args.indexOf("--workspace");
  if (workspaceIndex !== -1) workspaceId = args[workspaceIndex + 1];

  const remote = new RemoteEditor(socketPath, workspaceId);

  try {
    await remote.start();
    await remote.sendEvent("tui-started", { terminalSize: getDims() });
  } catch (error) {
    console.error("Error: Cannot connect to tmax daemon.");
    console.error("Start one with: tmax --daemon");
    console.error(`Details: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  enterAltScreen();

  let pollInterval: ReturnType<typeof setInterval> | undefined;

  const cleanup = () => {
    if (pollInterval) clearInterval(pollInterval);
    void remote.sendEvent("shutdown").catch(() => undefined);
    exitAltScreen();
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  };

  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("exit", cleanup);

  // Initial render
  let lastState = remote.getEditorState();
  let disconnected = false;  // set when the daemon socket drops (BUG-36 / #54)
  try {
    render(lastState);
    await remote.sendEvent("first-render", { terminalSize: getDims() });

    if (typeof process.stdin.setRawMode !== "function") {
      throw new Error("stdin raw mode is unavailable");
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    await remote.sendEvent("raw-mode-ready", { terminalSize: getDims() });
  } catch (error) {
    await remote.sendEvent("error", { message: String(error), phase: "startup" }).catch(() => undefined);
    throw error;
  }

  // Poll for external changes every 200ms. O(1) change detection (issue #46):
  // compare the daemon-side bufferRevision plus the display fields the render
  // actually depends on — never JSON.stringify the whole (potentially large)
  // state. #318 (codex r2): the decision lives in the PURE shouldRepaint —
  // pinned by unit tests (a transient-only change renders while the buffer
  // revision stays fixed; an unchanged pair does not).
  let lastSnap = repaintSnapshot(lastState, -1, -1); // -1 forces a first render
  pollInterval = setInterval(async () => {
    try {
      const current = await remote.refreshState();
      const snap = repaintSnapshot(current, remote.lastBufferRevision, remote.lastTransientRevision);
      if (shouldRepaint(lastSnap, snap)) {
        lastSnap = snap;
        lastState = current;
        render(current);
        await remote.sendEvent("render", { terminalSize: getDims() });
      }
    } catch (error) {
      // Daemon socket dropped: surface a visible banner. The socket is nulled
      // on close (BUG-36), so refreshState now rejects FAST instead of hanging
      // 30s. Do NOT round-trip an error event — the socket is dead. #54.
      if (!remote.isConnected && !disconnected) {
        disconnected = true;
        renderDisconnected(lastState);
      }
    }
  }, 200);

  let pendingInput = "";

  process.stdin.on("data", async (chunk: string) => {
    try {
      const tokens = tokenizeTerminalInput(chunk, pendingInput);
      pendingInput = tokens.pending;
      for (const key of tokens.keys) {
        // Daemon gone: quit LOCALLY on q / Esc (no round-trip to a dead socket).
        // BUG-36 / #54.
        if (disconnected) {
          if (key === "q" || key === "\x1b") {
            cleanup();
            process.exit(0);
          }
          continue;
        }
        const state = await remote.handleKey(key);
        lastState = state;
        render(state);
        await remote.sendEvent("render", { terminalSize: getDims() });
      }
    } catch (error) {
      if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
        cleanup();
        process.exit(0);
      }
      if (!remote.isConnected) {
        // A keypress hit the dead socket before the poll noticed — mark
        // disconnected so the next key quits locally. BUG-36 / #54.
        disconnected = true;
        renderDisconnected(remote.getEditorState());
      } else {
        await remote.sendEvent("error", { message: String(error), phase: "keypress" }).catch(() => undefined);
        render({ ...remote.getEditorState(), statusMessage: `Error: ${String(error)}` } as EditorState);
      }
    }
  });

  // Handle terminal resize
  process.stdout.on("resize", () => {
    render(remote.getEditorState());
    void remote.sendEvent("resize", { terminalSize: getDims() }).catch(() => undefined);
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
