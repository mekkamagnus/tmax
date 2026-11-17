/**
 * @file viewport.ts
 * @description Single source of truth for viewport self-healing (issue #258).
 */

/**
 * Minimal viewport-relevant state shape — satisfied structurally by both
 * `EditorState` (render path) and `EditorModel` (editor focus switch), so
 * the two can never drift apart on the clamp.
 */
export interface ViewportClampState {
  readonly viewportTop: number;
  readonly cursorPosition: { readonly line: number };
}

/**
 * Effective viewport top: clamps the stored viewportTop so the cursor line
 * is always visible. Single source of truth for viewport self-healing;
 * renderers and editor focus switches must both use this.
 */
export function getVisibleViewportTop(state: ViewportClampState, height: number): number {
  const visibleLines = Math.max(1, height);
  const viewportTop = Math.max(0, state.viewportTop);

  if (state.cursorPosition.line < viewportTop) {
    return Math.max(0, state.cursorPosition.line);
  }

  if (state.cursorPosition.line >= viewportTop + visibleLines) {
    return Math.max(0, state.cursorPosition.line - visibleLines + 1);
  }

  return viewportTop;
}
