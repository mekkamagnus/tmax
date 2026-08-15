/**
 * @file capture-frame.ts
 * @description Standalone render function that produces ANSI lines from EditorState.
 * Mirrors the TUI client's render() but returns strings instead of writing to a terminal.
 */

import type { EditorState } from "../core/contracts/editor.ts";
import { renderBufferLines, getVisibleViewportTop } from "../frontend/render/buffer-lines.ts";
import { renderStatusLine } from "../frontend/render/status-line.ts";
import { renderCommandInput } from "../frontend/render/command-input.ts";
import { renderTabBarAnsi } from "../frontend/render/tab-bar.ts";
import { renderMinibuffer } from "../frontend/render/minibuffer.ts";
import { renderWhichKeyOverlay } from "../frontend/render/which-key-overlay.ts";
import { computeHighlightSpans } from "../syntax/highlight-buffer.ts";
import { makeWikiLinkResolver } from "../syntax/wiki-link-faces.ts";
import { Either } from "../utils/task-either.ts";

/**
 * Render the current editor state into an array of ANSI-encoded lines.
 * Each line includes any syntax highlighting escape codes.
 */
export function captureFrame(state: EditorState, width: number, height: number): string[] {
  // #155: Terminal mode — render screen-buffer lines instead of editor buffer.
  // The terminal-handler routes keys to the PTY; the TerminalManager's screen
  // buffer holds the parsed ANSI output. Here we composite those lines.
  if (state.mode === "terminal") {
    return captureTerminalFrame(state, width, height);
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
  const spans = state.currentBuffer
    ? computeHighlightSpans(
        getLine,
        vt,
        vt + bufferHeight,
        state.currentFilename,
        // SPEC-118: dim dangling [[wiki-links]] (no-op for non-markdown langs).
        makeWikiLinkResolver(state.currentBuffer, state.currentFilename),
      )
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
  } else if (state.statusMessage) {
    // BUG-76: echo row. The TUI client overlays the status message on the
    // last buffer line (height-2); captureFrame — used by the embedded Steep
    // frontend and `tmax --capture` — omitted it, so commands ran (messages
    // landed in *Messages*) but gave NO visible feedback. Mirror the TUI
    // exactly: same row, same truncation, overlay semantics (frame stays
    // exactly `height` lines).
    const msg = state.statusMessage.length > width
      ? state.statusMessage.slice(0, width - 1)
      : state.statusMessage;
    const row = tabBarHeight + bufferHeight - 1;
    if (row >= 0 && row < screen.length) {
      screen[row] = msg;
    }
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

/**
 * #155: Render a terminal frame — screen-buffer lines + status line.
 * The terminal lines come from the TerminalManager's screen buffer (via the
 * shell-get-lines T-Lisp primitive). This function is called when
 * `state.mode === "terminal"`.
 *
 * Note: The screen buffer lives in the TerminalManager (not in EditorState),
 * so we can't access it directly from this pure render function. Instead, the
 * caller (editor.ts) populates `state.visibleLines` before calling captureFrame,
 * OR we read them via a callback. For the MVP, we check if the state already
 * has terminal lines; if not, we render a placeholder.
 *
 * The actual terminal-line injection happens in editor.ts's render path (it
 * calls shell-get-lines and stores the result). This function just formats them.
 */
function captureTerminalFrame(state: EditorState, width: number, height: number): string[] {
  const bufferHeight = Math.max(1, height - 1); // -1 for status line
  const screen: string[] = [];

  // Terminal lines are injected via state.visibleLines (set by editor.ts
  // before calling captureFrame, or by the daemon's render path).
  const terminalLines = (state as any).terminalLines as string[] | undefined;

  if (terminalLines && terminalLines.length > 0) {
    for (let i = 0; i < bufferHeight && i < terminalLines.length; i++) {
      const line = terminalLines[i] ?? "";
      // Truncate/pad to width
      screen.push(line.length > width ? line.slice(0, width) : line);
    }
  } else {
    // Placeholder when terminal lines aren't injected yet
    for (let i = 0; i < bufferHeight; i++) {
      screen.push("");
    }
  }

  // Status line
  screen.push(renderStatusLine(state, width));

  return screen;
}
