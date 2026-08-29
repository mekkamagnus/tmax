#!/usr/bin/env bun
/**
 * @file tui-client.ts
 * @description TUI client that connects to a running tmax daemon and renders
 * the editor using native ANSI escape sequences (Steep-style rendering).
 */

import { RemoteEditor } from "../editor/remote-editor.ts";
import { renderBufferLines, getVisibleViewportTop, getCursorScreenOffset } from "../frontend/render/buffer-lines.ts";
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

/** #231: merge the transient goggles flash spans on top of the base spans.
 * Extracted (BUG-24 renderSteepFrame precedent) so the client's flash merge
 * is directly testable — the render() caller is module-private.
 * Merges out to max(base, flash) length — a flash.map(...) truncation would
 * drop syntax spans on every line below the flash for its TTL (gate retry 3). */
export function mergeFlashSpans(
  base: HighlightSpan[][] | undefined,
  flash: HighlightSpan[][] | undefined,
): HighlightSpan[][] | undefined {
  if (!flash) return base;
  const b = base ?? [];
  const len = Math.max(b.length, flash.length);
  const out: HighlightSpan[][] = [];
  for (let i = 0; i < len; i++) {
    out.push([...(b[i] ?? []), ...(flash[i] ?? [])]);
  }
  return out;
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
  const bufferHeight = Math.max(1, height - 1 - commandHeight - tabBarHeight);
  const vt = getVisibleViewportTop(state, bufferHeight);
  const getLine = (ln: number) => {
    const r = state.currentBuffer?.getLine(ln);
    return r && Either.isRight(r) ? r.right : "";
  };
  let spans = state.currentBuffer
    ? computeHighlightSpans(
        getLine,
        vt,
        vt + bufferHeight,
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
    const msg = state.statusMessage.length > width ? state.statusMessage.slice(0, width - 1) : state.statusMessage;
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
    const cursor = getCursorScreenOffset(state, bufferHeight, width);
    const cursorRow = Math.max(0, Math.min(bufferHeight - 1, cursor.row));
    const cursorCol = Math.max(0, Math.min(width - 1, cursor.col));
    moveTo(cursorRow + tabBarHeight, cursorCol);
  }
}

/** Render the last cached state with a disconnect banner — NO daemon round-trip
 *  (the socket is gone). Used when the daemon drops (BUG-36 / #54). */
function renderDisconnected(state: EditorState): void {
  render({ ...state, statusMessage: "daemon disconnected — press q or Esc to quit" });
}

async function main() {
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
  // state.
  const lastRevision = -1;  // forces a render on the first poll
  let lastPollRevision = lastRevision;
  pollInterval = setInterval(async () => {
    try {
      const current = await remote.refreshState();
      const rev = remote.lastBufferRevision;
      const changed =
        rev !== lastPollRevision ||
        current.mode !== lastState.mode ||
        current.viewportTop !== lastState.viewportTop ||
        current.statusMessage !== lastState.statusMessage ||
        current.cursorPosition.line !== lastState.cursorPosition.line ||
        current.cursorPosition.column !== lastState.cursorPosition.column ||
        // #231: flash onset, clear, AND supersede must re-render — a
        // value-shape compare, not presence (two yy within one poll window
        // otherwise drops the second flash; verify-gate retry 2). Flash
        // arrays are tiny, so JSON compare is cheap.
        JSON.stringify(current.flashSpans) !== JSON.stringify(lastState.flashSpans);
      if (changed) {
        lastPollRevision = rev;
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
