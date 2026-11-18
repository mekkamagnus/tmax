import type { LayoutNode, Window } from "./contracts/editor.ts";

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
 * Divide a rectangle along an axis for a split node: one separator row/column
 * is reserved at the boundary (#258), the remaining extent is split by
 * `ratio`, clamped so both children reach the pane minimum where space
 * allows. Single source for layout, annotation, and resize math.
 */
export function divideRect(
  axis: "horizontal" | "vertical",
  ratio: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { firstX: number; firstY: number; firstW: number; firstH: number; secondX: number; secondY: number; secondW: number; secondH: number } {
  if (axis === "horizontal") {
    // Stacked panes: divide HEIGHT, separator is a row.
    const content = Math.max(1, h - 1);
    const min = MIN_PANE_HEIGHT;
    let first = Math.floor(content * ratio);
    if (content >= min * 2) {
      first = Math.min(content - min, Math.max(min, first));
    } else {
      first = Math.floor(content / 2);
    }
    return {
      firstX: x, firstY: y, firstW: w, firstH: first,
      secondX: x, secondY: y + first + 1, secondW: w, secondH: content - first,
    };
  }
  // Side-by-side panes: divide WIDTH, separator is a column.
  const content = Math.max(1, w - 1);
  const min = MIN_PANE_WIDTH;
  let first = Math.floor(content * ratio);
  if (content >= min * 2) {
    first = Math.min(content - min, Math.max(min, first));
  } else {
    first = Math.floor(content / 2);
  }
  return {
    firstX: x, firstY: y, firstW: first, firstH: h,
    secondX: x + first + 1, secondY: y, secondW: content - first, secondH: h,
  };
}

/**
 * Lay out a split tree into leaf cells (#260). Each split node reserves one
 * separator row (horizontal/stacked axis) or column (vertical/side-by-side
 * axis) at the boundary — #258 semantics generalized to nesting — then
 * divides the remaining extent by `ratio`, clamped so both children reach
 * the pane minimum where space allows. Leaves whose window is absent are
 * skipped (the editor prunes stale leaves; this is defense).
 */
function layoutTreeCells(
  node: LayoutNode,
  windows: Window[],
  x: number,
  y: number,
  w: number,
  h: number,
  out: WindowCell[],
): void {
  if (w <= 0 || h <= 0) return;
  if (node.kind === "leaf") {
    if (windows.some((win) => win.id === node.windowId)) {
      out.push({ windowId: node.windowId, x, y, width: w, height: h });
    }
    return;
  }
  const d = divideRect(node.axis, node.ratio, x, y, w, h);
  layoutTreeCells(node.first, windows, d.firstX, d.firstY, d.firstW, d.firstH, out);
  layoutTreeCells(node.second, windows, d.secondX, d.secondY, d.secondW, d.secondH, out);
}

/**
 * Annotate a tree with each node's rectangle (same division math as the
 * layout). Consumers: resize (finds the nearest enclosing split of an axis
 * and its extent) and any future geometry walk.
 */
export interface AnnotatedLayout {
  node: LayoutNode;
  x: number;
  y: number;
  width: number;
  height: number;
  first?: AnnotatedLayout;
  second?: AnnotatedLayout;
}

export function annotateLayout(node: LayoutNode, width: number, height: number): AnnotatedLayout {
  if (node.kind === "leaf") {
    return { node, x: 0, y: 0, width, height };
  }
  const d = divideRect(node.axis, node.ratio, 0, 0, width, height);
  return {
    node,
    x: 0, y: 0, width, height,
    first: annotateNodeRect(node.first, d.firstX, d.firstY, d.firstW, d.firstH),
    second: annotateNodeRect(node.second, d.secondX, d.secondY, d.secondW, d.secondH),
  };
}

function annotateNodeRect(node: LayoutNode, x: number, y: number, w: number, h: number): AnnotatedLayout {
  if (node.kind === "leaf") {
    return { node, x, y, width: w, height: h };
  }
  const d = divideRect(node.axis, node.ratio, x, y, w, h);
  return {
    node,
    x, y, width: w, height: h,
    first: annotateNodeRect(node.first, d.firstX, d.firstY, d.firstW, d.firstH),
    second: annotateNodeRect(node.second, d.secondX, d.secondY, d.secondW, d.secondH),
  };
}

/**
 * Derive a flat single-axis chain tree from a flat windows array (legacy
 * states without an explicit tree): siblings of the dominant axis stacked
 * in array order, ratios 0.5 (matches the pre-#260 flat layout closely
 * enough for old workspaces; stored dims remain advisory only).
 */
export function flatTree(windows: Window[]): LayoutNode | undefined {
  if (windows.length === 0) return undefined;
  const axis = windows.some((w) => w.splitType === "vertical") ? "vertical" : "horizontal";
  let node: LayoutNode = { kind: "leaf", windowId: windows[0]!.id };
  for (let i = 1; i < windows.length; i++) {
    // Even ratios: the accumulated chain keeps i/(i+1) of the extent so the
    // materialized tree renders the same even split as the flat layout.
    node = { kind: "split", axis, ratio: i / (i + 1), first: node, second: { kind: "leaf", windowId: windows[i]!.id } };
  }
  return node;
}

/**
 * Remove leaves whose window no longer exists and collapse single-child
 * splits (the surviving child takes its parent's rectangle). Returns
 * undefined when nothing survives.
 */
export function pruneTree(node: LayoutNode, liveIds: Set<string>): LayoutNode | undefined {
  if (node.kind === "leaf") {
    return liveIds.has(node.windowId) ? node : undefined;
  }
  const first = pruneTree(node.first, liveIds);
  const second = pruneTree(node.second, liveIds);
  if (first && second) return { ...node, first, second };
  return first ?? second;
}

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
  tree?: LayoutNode,
): WindowCell[] {
  if (windows.length === 0) return [];
  if (windows.length === 1) {
    return [{ windowId: windows[0]!.id, x: 0, y: 0, width: terminalWidth, height: terminalHeight }];
  }

  // #260: an explicit split tree lays out nested mixed-axis panes (each
  // split reserves its own separator and divides by ratio). Without a tree
  // (legacy states, direct unit-test calls) the flat single-axis path below
  // applies unchanged.
  if (tree) {
    const cells: WindowCell[] = [];
    layoutTreeCells(tree, windows, 0, 0, terminalWidth, terminalHeight, cells);
    if (cells.length > 0) return cells;
    // Degenerate tree (no live leaves): fall through to the flat path.
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
  tree?: LayoutNode,
): string[] {
  const overlay: string[] = Array.from({ length: terminalHeight }, () =>
    " ".repeat(terminalWidth),
  );

  // #260: with a tree, every split node draws its own separator at its
  // boundary (nested panes are not adjacency-inferable: a cell may differ
  // from its traversal neighbor in BOTH axes).
  if (tree) {
    drawTreeSeparators(tree, 0, 0, terminalWidth, terminalHeight, overlay, terminalWidth, terminalHeight);
    return overlay;
  }

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

function drawTreeSeparators(
  node: LayoutNode,
  x: number,
  y: number,
  w: number,
  h: number,
  overlay: string[],
  terminalWidth: number,
  terminalHeight: number,
): void {
  if (node.kind === "leaf" || w <= 0 || h <= 0) return;
  const d = divideRect(node.axis, node.ratio, x, y, w, h);
  if (node.axis === "horizontal") {
    const sy = d.firstY + d.firstH;
    if (sy >= 0 && sy < terminalHeight) {
      overlay[sy] = HSEP.repeat(terminalWidth);
    }
  } else {
    const sx = d.firstX + d.firstW;
    if (sx >= 0 && sx < terminalWidth) {
      for (let row = y; row < y + h && row < terminalHeight; row++) {
        const line = overlay[row]!;
        overlay[row] = line.slice(0, sx) + VSEP + line.slice(sx + 1);
      }
    }
  }
  drawTreeSeparators(node.first, d.firstX, d.firstY, d.firstW, d.firstH, overlay, terminalWidth, terminalHeight);
  drawTreeSeparators(node.second, d.secondX, d.secondY, d.secondW, d.secondH, overlay, terminalWidth, terminalHeight);
}
