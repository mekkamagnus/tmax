import type { EditorState } from "../core/contracts/editor.ts";

/**
 * @file repaint-decision.ts
 * @description #318 (codex r2 catch 2): the TUI poll's O(1) repaint
 * decision, extracted PURE so the decisive cases are pinnable in unit
 * tests — a transient-only change (spinner tick) must repaint while the
 * buffer revision stays fixed, and an unchanged pair must not. The poll
 * closure compared these fields inline; the semantics are identical.
 */

export interface RepaintSnapshot {
  bufferRevision: number;
  /** #318: the display-layer counter — the SECOND independent compare. */
  transientRevision: number;
  mode: string;
  viewportTop: number;
  statusMessage: string;
  cursorLine: number;
  cursorColumn: number;
  /** #231: flash spans compared by value (JSON) — onset, clear, AND
   * supersede re-render (two flashes within one poll window). */
  flashJson: string;
  /** §8.8: ghost onset/clear/supersede. */
  ghostText: string | undefined;
}

export function repaintSnapshot(
  state: EditorState,
  bufferRevision: number,
  transientRevision: number,
): RepaintSnapshot {
  return {
    bufferRevision,
    transientRevision,
    mode: state.mode,
    viewportTop: state.viewportTop,
    statusMessage: state.statusMessage,
    cursorLine: state.cursorPosition.line,
    cursorColumn: state.cursorPosition.column,
    flashJson: JSON.stringify(state.flashSpans),
    ghostText: state.ghostText,
  };
}

export function shouldRepaint(prev: RepaintSnapshot, next: RepaintSnapshot): boolean {
  return (
    prev.bufferRevision !== next.bufferRevision ||
    // #318: BOTH counters compared INDEPENDENTLY — a transient bump
    // (5→6) renders while the buffer revision stays put; no max(), no
    // missed transitions.
    prev.transientRevision !== next.transientRevision ||
    prev.mode !== next.mode ||
    prev.viewportTop !== next.viewportTop ||
    prev.statusMessage !== next.statusMessage ||
    prev.cursorLine !== next.cursorLine ||
    prev.cursorColumn !== next.cursorColumn ||
    prev.flashJson !== next.flashJson ||
    prev.ghostText !== next.ghostText
  );
}
