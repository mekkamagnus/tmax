import type { Editor as EditorClass } from "../editor/editor.ts";
import type { EditorState } from "../core/contracts/editor.ts";
import type { Frontend } from "../frontend/frontends/types.ts";
import { getCursorScreenOffset } from "../frontend/render/buffer-lines.ts";
import { Input } from "./input.ts";
import { Screen } from "./screen.ts";
import { renderMinibuffer } from "../frontend/render/minibuffer.ts";
import { renderSteepFrame } from "./render-frame.ts";

export class SteepFrontend implements Frontend {
  // Set once run() initializes its render loop. Allows external callers
  // (e.g. main.ts wiring an editor.onStateChange subscription) to request a
  // re-render from socket-driven input that bypasses local stdin.
  private renderFromEditor: ((editor: EditorClass) => void) | null = null;

  /**
   * Re-render from the editor's current state. No-op until run() has started.
   * Safe to call on every editor state change.
   */
  requestRender(editor: EditorClass): void {
    this.renderFromEditor?.(editor);
  }

  async run(editor: EditorClass, initialState: EditorState): Promise<void> {
    const screen = new Screen();
    const input = new Input();

    let state = initialState;
    let stopped = false;
    let stopResize = () => {};

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      stopResize();
      input.stop();
      screen.showCursor();
      screen.exitAltScreen();
    };

    const render = () => {
      const { width, height } = screen.getDims();
      const hasTabBar = (state.tabs?.length ?? 0) > 1;
      const tabBarHeight = hasTabBar ? 1 : 0;
      const minibuffer = state.minibufferView ? renderMinibuffer(state.minibufferView, width) : undefined;
      const commandHeight = minibuffer?.lines.length ?? ((state.mode === "command" || state.mode === "mx") ? 1 : 0);
      const bufferHeight = Math.max(1, height - 1 - commandHeight - tabBarHeight);

      // Frame content (tab + buffer + command/minibuffer + status, and the
      // which-key overlay when active) is produced by the pure
      // `renderSteepFrame` — extracted so Steep's render is unit-testable
      // (BUG-24 / #124). Cursor positioning stays here.
      const lines = renderSteepFrame(state, width, height);
      screen.clear();
      lines.forEach((line, i) => screen.writeAt(i, 0, line));

      if (minibuffer) {
        screen.moveTo(height - 1 - minibuffer.lines.length + minibuffer.cursorRow, minibuffer.cursorColumn);
      } else {
        const cursor = getCursorScreenOffset(state, bufferHeight, width);
        const cursorRow = Math.max(0, Math.min(bufferHeight - 1, cursor.row));
        const cursorCol = Math.max(0, Math.min(width - 1, cursor.col));
        screen.moveTo(cursorRow + tabBarHeight, cursorCol);
      }
    };

    // Allow external callers (socket-driven --keys via editor.onStateChange)
    // to request a repaint. Fetches fresh state from the editor so mutations
    // from outside the local stdin loop are reflected.
    this.renderFromEditor = (ed) => {
      state = ed.getEditorState();
      render();
    };

    try {
      await editor.start();
      screen.enterAltScreen();
      screen.showCursor();

      const dims = screen.getDims();
      editor.updateTerminalSize(dims.width, dims.height);
      state = editor.getEditorState();

      stopResize = screen.onResize(() => {
        const nextDims = screen.getDims();
        editor.updateTerminalSize(nextDims.width, nextDims.height);
        state = editor.getEditorState();
        render();
      });

      input.onKey(async (msg) => {
        try {
          await editor.handleKey(msg.key);
          state = editor.getEditorState();
          render();
        } catch (error) {
          if (error instanceof Error && error.message === "EDITOR_QUIT_SIGNAL") {
            cleanup();
            process.exit(0);
          }

          state = { ...editor.getEditorState(), statusMessage: `Error: ${String(error)}` };
          render();
        }
      });

      input.start();
      render();

      await new Promise<void>((resolve) => {
        process.once("SIGINT", () => {
          cleanup();
          resolve();
        });
        process.once("SIGTERM", () => {
          cleanup();
          resolve();
        });
      });
    } finally {
      cleanup();
    }
  }
}
