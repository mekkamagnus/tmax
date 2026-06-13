/**
 * @file capture-frame.ts
 * @description Standalone render function that produces ANSI lines from EditorState.
 * Mirrors the TUI client's render() but returns strings instead of writing to a terminal.
 */

import type { EditorState } from "../core/types.ts";
import { renderBufferLines, getVisibleViewportTop } from "../frontend/render/buffer-lines.ts";
import { renderStatusLine } from "../frontend/render/status-line.ts";
import { renderCommandInput } from "../frontend/render/command-input.ts";
import { renderTabBarAnsi } from "../frontend/render/tab-bar.ts";
import { renderMinibuffer } from "../frontend/render/minibuffer.ts";
import { renderWhichKeyOverlay } from "../frontend/render/which-key-overlay.ts";
import { computeHighlightSpans } from "../syntax/highlight-buffer.ts";
import { Either } from "../utils/task-either.ts";

/**
 * Render the current editor state into an array of ANSI-encoded lines.
 * Each line includes any syntax highlighting escape codes.
 */
export function captureFrame(state: EditorState, width: number, height: number): string[] {
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

  const screen: string[] = [];

  if (hasTabBar) {
    screen.push(renderTabBarAnsi(state.tabs!, state.currentTabIndex ?? 0, width));
  }

  const bufferLines = renderBufferLines(state, width, bufferHeight, spans);
  for (const line of bufferLines) {
    screen.push(line);
  }

  if (minibuffer) {
    for (const line of minibuffer.lines) {
      screen.push(line);
    }
  } else if (state.mode === "command" || state.mode === "mx") {
    screen.push(renderCommandInput(state, width));
  }

  screen.push(renderStatusLine(state, width));

  // Which-key popup overlay on bottom of buffer area
  if (state.whichKeyActive && state.whichKeyPopup) {
    const overlayLines = renderWhichKeyOverlay(state.whichKeyPopup, width);
    const overlayStart = tabBarHeight + bufferHeight - overlayLines.length;
    for (let i = 0; i < overlayLines.length; i++) {
      const row = overlayStart + i;
      if (row >= tabBarHeight && row < tabBarHeight + bufferHeight) {
        screen[row] = overlayLines[i]!;
      }
    }
  }

  return screen;
}
