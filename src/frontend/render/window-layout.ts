import type { Window } from "../../core/contracts/editor.ts";

export interface WindowCell {
  windowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
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

  // Simple layout: distribute evenly
  // If any window has splitType "vertical", use vertical split; otherwise horizontal
  const hasVertical = windows.some(w => w.splitType === "vertical");

  if (hasVertical) {
    const colWidth = Math.floor(terminalWidth / n);
    for (let i = 0; i < n; i++) {
      const window = windows[i]!;
      cells.push({
        windowId: window.id,
        x: i * colWidth,
        y: 0,
        width: i === n - 1 ? terminalWidth - i * colWidth : colWidth,
        height: terminalHeight,
      });
    }
  } else {
    const rowHeight = Math.floor(terminalHeight / n);
    for (let i = 0; i < n; i++) {
      const window = windows[i]!;
      cells.push({
        windowId: window.id,
        x: 0,
        y: i * rowHeight,
        width: terminalWidth,
        height: i === n - 1 ? terminalHeight - i * rowHeight : rowHeight,
      });
    }
  }

  return cells;
}

const HSEP = "\u2500";
const VSEP = "\u2502";

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
