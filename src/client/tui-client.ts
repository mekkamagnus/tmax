#!/usr/bin/env bun
/**
 * @file tui-client.ts
 * @description TUI client that connects to a running tmax daemon and renders
 * the editor using native ANSI escape sequences (Steep-style rendering).
 */

import { RemoteEditor } from "../editor/remote-editor.ts";
import { renderBufferLines, getVisibleViewportTop } from "../frontend/render/buffer-lines.ts";
import { renderStatusLine } from "../frontend/render/status-line.ts";
import { renderCommandInput } from "../frontend/render/command-input.ts";
import { tokenizeTerminalInput } from "../frontend/render/input.ts";
import { renderTabBarAnsi } from "../frontend/render/tab-bar.ts";
import type { EditorState } from "../core/types.ts";
import { renderMinibuffer } from "../frontend/render/minibuffer.ts";
import { computeHighlightSpans } from "../syntax/highlight-buffer.ts";
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

function render(state: EditorState) {
  const { width, height } = getDims();
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
  const spans = state.currentBuffer
    ? computeHighlightSpans(getLine, vt, vt + bufferHeight, state.currentFilename)
    : undefined;
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
  }

  writeAt(height - 1, 0, renderStatusLine(state, width));

  if (minibuffer) {
    moveTo(height - 1 - minibuffer.lines.length + minibuffer.cursorRow, minibuffer.cursorColumn);
  } else {
    const viewportTop = getVisibleViewportTop(state, bufferHeight);
    const cursorRow = Math.max(0, Math.min(bufferHeight - 1, state.cursorPosition.line - viewportTop));
    const cursorCol = Math.max(0, Math.min(width - 1, state.cursorPosition.column));
    moveTo(cursorRow + tabBarHeight, cursorCol);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
tmax-tui - TUI client for tmax daemon

Usage: tmax-tui [options]

Options:
  -s, --socket PATH   Custom socket path
  -h, --help          Show this help message

Requires a running tmax daemon. Start one with:
  tmax --daemon
    `);
    process.exit(0);
  }

  let socketPath: string | undefined;
  const socketIndex = args.indexOf("-s");
  if (socketIndex !== -1) socketPath = args[socketIndex + 1];
  const socketArgIndex = args.indexOf("--socket");
  if (socketArgIndex !== -1) socketPath = args[socketArgIndex + 1];

  const remote = new RemoteEditor(socketPath);

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

  // Poll for external changes every 200ms
  pollInterval = setInterval(async () => {
    try {
      const current = await remote.refreshState();
      if (JSON.stringify(current) !== JSON.stringify(lastState)) {
        lastState = current;
        render(current);
        await remote.sendEvent("render", { terminalSize: getDims() });
      }
    } catch (error) {
      await remote.sendEvent("error", { message: String(error), phase: "render-poll" }).catch(() => undefined);
      // Daemon unreachable — ignore, will show on next keypress
    }
  }, 200);

  let pendingInput = "";

  process.stdin.on("data", async (chunk: string) => {
    try {
      const tokens = tokenizeTerminalInput(chunk, pendingInput);
      pendingInput = tokens.pending;
      for (const key of tokens.keys) {
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
      await remote.sendEvent("error", { message: String(error), phase: "keypress" }).catch(() => undefined);
      render({ ...remote.getEditorState(), statusMessage: `Error: ${String(error)}` } as EditorState);
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
