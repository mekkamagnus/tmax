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
import type { EditorState } from "../core/types.ts";

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
  const bufferHeight = Math.max(1, height - 2);
  const lines = renderBufferLines(state, width, bufferHeight);

  clearScreen();
  lines.forEach((line, i) => writeAt(i, 0, line));

  if (state.mode === "command" || state.mode === "mx") {
    writeAt(height - 2, 0, renderCommandInput(state, width));
  }

  writeAt(height - 1, 0, renderStatusLine(state, width));

  const viewportTop = getVisibleViewportTop(state, bufferHeight);
  const cursorRow = Math.max(0, Math.min(bufferHeight - 1, state.cursorPosition.line - viewportTop));
  const cursorCol = Math.max(0, Math.min(width - 1, state.cursorPosition.column));
  moveTo(cursorRow, cursorCol);
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
  } catch (error) {
    console.error("Error: Cannot connect to tmax daemon.");
    console.error("Start one with: tmax --daemon");
    console.error(`Details: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  enterAltScreen();

  const cleanup = () => {
    clearInterval(pollInterval);
    exitAltScreen();
    process.stdin.setRawMode(false);
    process.stdin.pause();
  };

  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("exit", cleanup);

  // Initial render
  let lastState = remote.getEditorState();
  render(lastState);

  // Poll for external changes every 200ms
  const pollInterval = setInterval(async () => {
    try {
      const current = await remote.refreshState();
      if (JSON.stringify(current) !== JSON.stringify(lastState)) {
        lastState = current;
        render(current);
      }
    } catch {
      // Daemon unreachable — ignore, will show on next keypress
    }
  }, 200);

  // Key input loop
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const escapeMap: Record<string, string> = {
    "\x1b[A": "k",
    "\x1b[B": "j",
    "\x1b[C": "l",
    "\x1b[D": "h",
    "\x1b[3~": "\x7f",
  };

  process.stdin.on("data", async (chunk: string) => {
    try {
      const mapped = escapeMap[chunk];
      const key = mapped ?? (chunk === "\r" || chunk === "\n" ? "\n" : chunk === "\x1b" ? "\x1b" : chunk === "\x7f" || chunk === "\b" ? "\x7f" : chunk);

      const state = await remote.handleKey(key);
      lastState = state;
      render(state);
    } catch (error) {
      if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
        cleanup();
        process.exit(0);
      }
      render({ ...remote.getEditorState(), statusMessage: `Error: ${String(error)}` } as EditorState);
    }
  });

  // Handle terminal resize
  process.stdout.on("resize", () => {
    render(remote.getEditorState());
  });
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
