/**
 * @file capture-frame.ts
 * @description Standalone render function that produces ANSI lines from EditorState.
 * Mirrors the TUI client's render() but returns strings instead of writing to a terminal.
 */

import type { EditorState } from "../core/contracts/editor.ts";
import type { HighlightSpan } from "../core/contracts/editor.ts";
import { renderBufferLines, getVisibleViewportTop, getWrappedViewportTop } from "../frontend/render/buffer-lines.ts";
import { renderStatusLine } from "../frontend/render/status-line.ts";
import { renderCommandInput } from "../frontend/render/command-input.ts";
import { renderTabBarAnsi } from "../frontend/render/tab-bar.ts";
import { renderMinibuffer } from "../frontend/render/minibuffer.ts";
import { renderWhichKeyOverlay } from "../frontend/render/which-key-overlay.ts";
import { mergeFlashSpans } from "./flash-merge.ts";
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

  // #321: wrap-aware top — spans must cover the range the wrapped render
  // actually walks (up to 2x the logical height under wrap).
  const vt = state.config?.wordWrap
    ? getWrappedViewportTop(state, bufferHeight, width)
    : getVisibleViewportTop(state, bufferHeight);
  const spanHeight = state.config?.wordWrap ? bufferHeight * 2 : bufferHeight;
  const getLine = (ln: number) => {
    const r = state.currentBuffer?.getLine(ln);
    return r && Either.isRight(r) ? r.right : "";
  };
  const syntaxSpans = state.currentBuffer
    ? computeHighlightSpans(
        getLine,
        vt,
        vt + spanHeight,
        state.currentFilename,
        // SPEC-118: dim dangling [[wiki-links]] (no-op for non-markdown langs).
        makeWikiLinkResolver(state.currentBuffer, state.currentFilename),
      )
    : undefined;
  // #231: merge the transient goggles flash on top of the syntax spans so
  // every capture-frame consumer (Steep embedded, capture RPC) shows it.
  // #296: the persistent per-buffer span layer — LAZY invalidation by
  // shape identity (any mutation that changes the buffer's shape
  // skips the grid; consumers re-apply).
  const spanLayer = state.currentBuffer && state.currentBufferName
    ? bufferSpanLayer(state, state.currentBufferName)
    : undefined;
  const spans = mergeFlashSpans(mergeFlashSpans(syntaxSpans, spanLayer), state.flashSpans);

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
      // #205: slice by VISIBLE width — the rows are ANSI-styled (#202), so a
      // JS-length slice cuts inside escape sequences and loses visible
      // columns to the escape budget (claude's colored right border vanished).
      screen.push(sliceByVisibleWidth(line, width));
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

/**
 * #205: truncate an ANSI-styled line to `maxCols` VISIBLE columns. Escape
 * sequences pass through uncounted (and are never cut mid-sequence); a wide
 * glyph that would straddle the boundary is dropped. Unstyled tail beyond the
 * boundary is simply omitted (the caller paints rows at absolute positions).
 */
function sliceByVisibleWidth(line: string, maxCols: number): string {
  let out = "";
  let cols = 0;
  let i = 0;
  while (i < line.length) {
    const code = line.codePointAt(i)!;
    const ch = String.fromCodePoint(code);
    const chLen = ch.length;
    if (ch === "\x1b") {
      // Pass the whole sequence through uncounted.
      const m = /^\x1b\[[0-9;]*[A-Za-z]/.exec(line.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
      // Bare ESC (unexpected in styled rows) — stop here.
      break;
    }
    const w = code >= 0x1100 && (
      (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x2b00 && code <= 0x2bff)
      || (code >= 0x20000 && code <= 0x3fffd)
    ) ? 2 : 1;
    if (cols + w > maxCols) break;
    out += ch;
    cols += w;
    i += chLen;
  }
  return out;
}

/** #296: the current buffer's persistent span grid — only when its
 * recorded shape identity still matches the live buffer (the
 * conservative v1 invalidation: shape change ⇒ dropped). */
function bufferSpanLayer(
  state: EditorState,
  bufferName: string,
): HighlightSpan[][] | undefined {
  const entry = state.bufferSpans?.get(bufferName);
  const buf = state.buffers?.get(bufferName);
  if (!entry || !buf) return undefined;
  // Either-returning probes (the buffer contract).
  const countR = buf.getLineCount();
  const lineCount = "right" in countR && typeof countR.right === "number" ? countR.right : -1;
  // gate r2: ONE getText pass (the per-line walk was an ~80x
  // per-frame regression on large buffers) folding CHARS (a real
  // content checksum — length-folding was shape-only).
  const textR = buf.getText({ start: { line: 0, column: 0 }, end: { line: Math.max(0, lineCount - 1), column: 1 << 30 } });
  const text = "right" in textR && typeof textR.right === "string" ? textR.right : "";
  // Bun.hash: wyhash 64-bit (valve r3: the 32-bit rolling fold
  // collided — 'Aa' and 'BB' hash identically).
  const checksum = Number(Bun.hash(text));
  if (
    lineCount !== entry.shape.lineCount ||
    checksum !== entry.shape.checksum ||
    buf !== entry.shape.token
  ) {
    return undefined;
  }
  return entry.spans;
}

