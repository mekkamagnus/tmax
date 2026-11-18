import type { Window } from "./contracts/editor.ts";

export interface WindowCell {
  windowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimum pane sizes — mirror window-resize-height/-width in window-ops. */
const MIN_PANE_HEIGHT = 3;
const MIN_PANE_WIDTH = 10;

/**
 * Fit n panes into `available` rows/cols honoring their stored sizes
 * (issue #259). Stored sizes are scaled proportionally to fill the space
 * exactly — a flat, single-axis layout can only honor RELATIVE sizes, so a
 * resize changes the pane's share — clamped to the pane minimum, with any
 * remainder going to the last pane. Windows without a stored size default
 * to an even share. Degenerate space (below n minimums) falls back to an
 * even distribution.
 */
function fitStoredSizes(stored: (number | undefined)[], available: number, min: number): number[] {
  const n = stored.length;
  if (n === 0) return [];
  const even = Math.max(1, Math.floor(available / n));
  if (available < n * min) {
    // Best effort: even split, last pane absorbs the remainder.
    return stored.map((_, i) => (i === n - 1 ? Math.max(1, available - even * (n - 1)) : even));
  }
  const wanted = stored.map((s) => (s !== undefined && s > 0 ? s : even));
  const total = wanted.reduce((a, b) => a + b, 0);
  if (total === available) return wanted;
  // No pane may take so much that the others cannot reach their minimum.
  const maxEach = available - (n - 1) * min;
  const scaled = wanted.map((s) =>
    Math.min(maxEach, Math.max(min, Math.floor((available * s) / total)))
  );
  // Absorb the rounding difference on the last pane; if clamping overshot
  // (sum > available), take the excess back from the panes, newest first.
  let diff = available - scaled.reduce((a, b) => a + b, 0);
  for (let i = n - 1; i >= 0 && diff !== 0; i--) {
    if (diff > 0) {
      scaled[i] = scaled[i]! + diff;
      diff = 0;
    } else {
      const take = Math.min(scaled[i]! - min, -diff);
      scaled[i] = scaled[i]! - take;
      diff += take;
    }
  }
  return scaled;
}

export function computeLayout(
  windows: Window[],
  terminalWidth: number,
  terminalHeight: number,
): WindowCell[] {
  if (windows.length === 0) return [];
  if (windows.length === 1) {
    return [{ windowId: windows[0]!.id, x: 0, y: 0, width: terminalWidth, height: terminalHeight }];
  }

  const cells: WindowCell[] = [];
  const n = windows.length;

  // Simple layout: one axis for all panes
  // If any window has splitType "vertical", use vertical split; otherwise horizontal
  const hasVertical = windows.some(w => w.splitType === "vertical");

  if (hasVertical) {
    // Reserve a column between panes so separators never overlap content
    // (#258); columns honor the stored window widths (#259).
    const available = Math.max(1, terminalWidth - (n - 1));
    const widths = fitStoredSizes(windows.map(w => w.width), available, MIN_PANE_WIDTH);
    let x = 0;
    for (let i = 0; i < n; i++) {
      cells.push({
        windowId: windows[i]!.id,
        x,
        y: 0,
        width: widths[i]!,
        height: terminalHeight,
      });
      x += widths[i]! + 1;
    }
  } else {
    // Reserve a row between panes so separators never overlap content
    // (#258); rows honor the stored window heights (#259).
    const available = Math.max(1, terminalHeight - (n - 1));
    const heights = fitStoredSizes(windows.map(w => w.height), available, MIN_PANE_HEIGHT);
    let y = 0;
    for (let i = 0; i < n; i++) {
      cells.push({
        windowId: windows[i]!.id,
        x: 0,
        y,
        width: terminalWidth,
        height: heights[i]!,
      });
      y += heights[i]! + 1;
    }
  }

  return cells;
}

const HSEP = "─";
const VSEP = "│";

export function renderSeparators(
  cells: WindowCell[],
  terminalWidth: number,
  terminalHeight: number,
): string[] {
  const overlay: string[] = Array.from({ length: terminalHeight }, () =>
    " ".repeat(terminalWidth),
  );

  for (let ci = 1; ci < cells.length; ci++) {
    const cell = cells[ci]!;
    const prev = cells[ci - 1]!;

    if (cell.x > prev.x && cell.y === prev.y) {
      // Vertical separator at cell.x - 1
      const sx = cell.x - 1;
      for (let y = cell.y; y < cell.y + cell.height && y < terminalHeight; y++) {
        const row = overlay[y]!;
        overlay[y] = row.slice(0, sx) + VSEP + row.slice(sx + 1);
      }
    } else if (cell.y > prev.y && cell.x === prev.x) {
      // Horizontal separator at cell.y - 1
      const sy = cell.y - 1;
      if (sy < terminalHeight) {
        overlay[sy] = HSEP.repeat(terminalWidth);
      }
    }
  }

  return overlay;
}
