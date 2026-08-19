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

    // #201 (BUG-84): while in shell-mode the PTY produces output
    // asynchronously (claude/codex stream while the user types nothing) — a
    // repaint tick keeps the screen live without a keystroke.
    let termTick: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (termTick) clearInterval(termTick);
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
        if (state.mode === "terminal") {
          // #201: the PTY owns the cursor position in terminal mode — clamped
          // to the visible pane (a PTY can report past it; the TUI branch
          // clamps too).
          const tc = (state as unknown as { terminalCursor?: { row: number; col: number } }).terminalCursor;
          if (tc) {
            const { width: w, height: h } = screen.getDims();
            screen.moveTo(Math.max(0, Math.min(h - 2, tc.row)), Math.max(0, Math.min(w - 1, tc.col)));
          }
        } else {
          const cursor = getCursorScreenOffset(state, bufferHeight, width);
          const cursorRow = Math.max(0, Math.min(bufferHeight - 1, cursor.row));
          const cursorCol = Math.max(0, Math.min(width - 1, cursor.col));
          screen.moveTo(cursorRow + tabBarHeight, cursorCol);
        }
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

      // #201: a terminal-mode repaint tick — the PTY produces output while
      // the user types nothing (claude/codex streaming), so keypress-driven
      // rendering is not enough. Always-on with a mode guard (the mode at
      // THIS point is still the startup mode; the guard re-checks each tick).
      termTick = setInterval(() => {
        if (stopped) return;
        // Cheap model read FIRST — getEditorState clones the whole state, and
        // the tick runs for the frontend's lifetime even outside terminal mode
        // (verify-gate #201 retry 1).
        if (editor.getState().mode !== "terminal") return;
        state = editor.getEditorState();
        render();
      }, 100);

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
