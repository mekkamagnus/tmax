import type { Editor as EditorClass } from "../editor/editor.ts";
import type { EditorState } from "../core/types.ts";
import type { Frontend } from "../frontend/frontends/types.ts";
import { renderBufferLines, getVisibleViewportTop, getCursorScreenOffset } from "../frontend/render/buffer-lines.ts";
import { renderCommandInput } from "../frontend/render/command-input.ts";
import { renderStatusLine } from "../frontend/render/status-line.ts";
import { renderTabBarAnsi } from "../frontend/render/tab-bar.ts";
import { Input } from "./input.ts";
import { Screen } from "./screen.ts";
import { renderMinibuffer } from "../frontend/render/minibuffer.ts";
import { computeHighlightSpans } from "../syntax/highlight-buffer.ts";
import { Either } from "../utils/task-either.ts";

export class SteepFrontend implements Frontend {
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
      const vt = getVisibleViewportTop(state, bufferHeight);
      const getLine = (ln: number) => {
        const r = state.currentBuffer?.getLine(ln);
        return r && Either.isRight(r) ? r.right : "";
      };
      const spans = state.currentBuffer
        ? computeHighlightSpans(getLine, vt, vt + bufferHeight, state.currentFilename)
        : undefined;
      const lines = renderBufferLines(state, width, bufferHeight, spans);

      screen.clear();
      if (hasTabBar) {
        screen.writeAt(0, 0, renderTabBarAnsi(state.tabs!, state.currentTabIndex ?? 0, width));
      }
      lines.forEach((line, i) => screen.writeAt(i + tabBarHeight, 0, line));

      if (minibuffer) {
        const start = height - 1 - minibuffer.lines.length;
        minibuffer.lines.forEach((line, index) => screen.writeAt(start + index, 0, line));
      } else if (state.mode === "command" || state.mode === "mx") {
        screen.writeAt(height - 2, 0, renderCommandInput(state, width));
      }

      screen.writeAt(height - 1, 0, renderStatusLine(state, width));

      if (minibuffer) {
        screen.moveTo(height - 1 - minibuffer.lines.length + minibuffer.cursorRow, minibuffer.cursorColumn);
      } else {
        const cursor = getCursorScreenOffset(state, bufferHeight, width);
        const cursorRow = Math.max(0, Math.min(bufferHeight - 1, cursor.row));
        const cursorCol = Math.max(0, Math.min(width - 1, cursor.col));
        screen.moveTo(cursorRow + tabBarHeight, cursorCol);
      }
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
