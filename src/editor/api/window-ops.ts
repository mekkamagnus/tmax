/**
 * @file window-ops.ts
 * @description Window management operations for T-Lisp API (US-3.2.1, US-3.2.2)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import type { Window } from "../../core/contracts/editor.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { computeLayout, flatTree, pruneTree, annotateLayout, type AnnotatedLayout } from "../../core/window-layout.ts";
import type { LayoutNode } from "../../core/contracts/editor.ts";
import { layoutSplit } from "../../core/contracts/editor.ts";
import { AppError } from "../../error/types.ts";
import { Either } from "../../utils/task-either.ts";

/**
 * Create window management operations for T-Lisp
 * @param getWindows - Function to get current windows array
 * @param setWindows - Function to set windows array
 * @param getCurrentWindowIndex - Function to get current window index
 * @param setCurrentWindowIndex - Function to set current window index
 * @param getCurrentBuffer - Function to get current buffer
 * @param getTerminalSize - Function to get terminal size (US-3.2.2)
 * @returns Map of window operation names to implementations
 */
export function createWindowOps(
  access: EditorModelAccess,
  setWindows: (windows: Window[]) => void,
  setCurrentWindowIndex: (index: number) => void,
  getTerminalSize: () => { width: number; height: number },
  mintWindowId: () => string,
  getLayout: () => LayoutNode | undefined,
  setLayout: (layout: LayoutNode | undefined) => void,
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: window/index/buffer reads flow through the State monad
  // against EditorModel; writes + terminal-size accessor stay on callbacks.
  const getWindows = (): Window[] => [...(runModel(access, readModelField("windows")) ?? [])];
  const getCurrentWindowIndex = (): number => runModel(access, readModelField("currentWindowIndex")) ?? 0;
  const getCurrentBuffer = (): TextBuffer | undefined =>
    runModel(access, readModelField("currentBuffer"));
  const ops = new Map<string, TLispFunctionImpl>();

  // #263: window IDs must be unique — the render path keys panes by ID
  // (windows.find(w => w.id === cell.windowId)). The Editor owns the
  // sequence so workspace restore can advance it past restored IDs
  // (persisted IDs live in the same editor after applyWorkspace).

  // ── #260 layout tree ─────────────────────────────────────────────────
  // The flat `windows` array stays the leaf registry (records, focus index,
  // rebind, rotate); the split tree owns GEOMETRY. Helpers here keep the
  // two in lockstep; without a tree (legacy states) the flat single-axis
  // layout applies and stored dims remain advisory.
  const liveIds = (windows: Window[]): Set<string> => new Set(windows.map((w) => w.id));
  /** Cells for cell-math (guards, introspection, navigation): the REAL
   * tree when present, else the flat branch (matches render exactly — never
   * a fabricated tree, whose geometry could diverge from the flat layout). */
  const layoutCells = () => {
    const size = getTerminalSize();
    return computeLayout(getWindows(), size.width, size.height, getLayout());
  };
  const replaceLeaf = (node: LayoutNode, targetId: string, replacement: LayoutNode): LayoutNode =>
    node.kind === "leaf"
      ? node.windowId === targetId ? replacement : node
      : { ...node, first: replaceLeaf(node.first, targetId, replacement), second: replaceLeaf(node.second, targetId, replacement) };
  /** Nearest enclosing split of `axis` on the path to the focused leaf;
   * adjusts its ratio by delta rows/cols. Returns the updated tree, or
   * undefined when no matching ancestor exists. */
  const resizeTreeRatio = (tree: LayoutNode, focusedId: string, axis: "horizontal" | "vertical", delta: number): LayoutNode | undefined => {
    const size = getTerminalSize();
    const annotated = annotateLayout(tree, size.width, size.height);
    const path: AnnotatedLayout[] = [];
    const walk = (a: AnnotatedLayout): boolean => {
      path.push(a);
      if (a.node.kind === "leaf") {
        if (a.node.windowId === focusedId) return true;
        path.pop();
        return false;
      }
      if ((a.first && walk(a.first)) || (a.second && walk(a.second))) return true;
      path.pop();
      return false;
    };
    if (!walk(annotated)) return undefined;
    for (let i = path.length - 2; i >= 0; i--) {
      const ancestor = path[i]!;
      if (ancestor.node.kind === "split" && ancestor.node.axis === axis) {
        const content = Math.max(1, (axis === "horizontal" ? ancestor.height : ancestor.width) - 1);
        const min = axis === "horizontal" ? 3 : 10;
        const lo = Math.min(0.5, min / content);
        const hi = 1 - lo;
        // `ratio` is the FIRST child's share: growing a pane nested under
        // `second` means SHRINKING the ratio (and vice versa).
        const side = path[i + 1] === ancestor.first ? 1 : -1;
        const ratio = Math.min(hi, Math.max(lo, ancestor.node.ratio + (side * delta) / content));
        const target = ancestor.node;
        const replace = (n: LayoutNode): LayoutNode =>
          n === target ? { ...n, ratio } : n.kind === "leaf" ? n : { ...n, first: replace(n.first), second: replace(n.second) };
        return replace(tree);
      }
    }
    return undefined;
  };
  /** Sync informational stored dims from the authoritative cells. */
  const syncStoredDims = (windows: Window[]): void => {
    const cells = layoutCells();
    const updated = windows.map((w) => {
      const cell = cells.find((c) => c.windowId === w.id);
      return cell ? { ...w, height: cell.height, width: cell.width } : w;
    });
    setWindows(updated);
  };

  /**
   * Split window horizontally or vertically
   * Usage: (split-window "horizontal") or (split-window "vertical")
   *
   * Terminology (#263, Emacs-inherited inversion): "horizontal" produces
   * STACKED panes (divides HEIGHT — one above the other); "vertical"
   * produces SIDE-BY-SIDE panes (divides WIDTH). The unambiguous aliases
   * are split-window-below (horizontal) and split-window-right (vertical).
   */
  ops.set("split-window", (args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("split-window requires one argument: split type");
    }

    const splitType = args[0]!
    if (splitType.type !== "string") {
      throw new Error("split-window type must be a string");
    }

    const type = splitType.value;
    if (type !== "horizontal" && type !== "vertical") {
      throw new Error("split-window type must be 'horizontal' or 'vertical'");
    }

    const windows = getWindows();
    const currentWindow = windows[getCurrentWindowIndex()]!;
    const currentBuffer = getCurrentBuffer();

    if (!currentBuffer) {
      throw new Error("No buffer to display in new window");
    }

    // Create new window with same buffer
    // Get terminal size for window dimensions (US-3.2.2)
    const terminalSize = getTerminalSize();

    // #260: the CELL is the authoritative pane size — the split minimum
    // guard (#263) reads the focused pane's rendered geometry, not stored
    // dims (which are advisory under the tree).
    const MIN_HEIGHT = 3; // mirror window-resize-height
    const MIN_WIDTH = 10; // mirror window-resize-width
    const cells = layoutCells();
    const focusedCell = cells.find((c) => c.windowId === currentWindow.id);
    const currentHeight = focusedCell?.height ?? currentWindow.height ?? terminalSize.height - 2;
    const currentWidth = focusedCell?.width ?? currentWindow.width ?? terminalSize.width;

    if (type === "horizontal" && currentHeight < MIN_HEIGHT * 2) {
      // Split horizontally: divide height — refuse below the pane minimum
      // (#263 vim behavior; clamping would produce two over-subscribed
      // half-panes).
      throw new Error(`split-window: pane height ${currentHeight} too small to split (minimum ${MIN_HEIGHT * 2})`);
    }
    if (type === "vertical" && currentWidth < MIN_WIDTH * 2) {
      throw new Error(`split-window: pane width ${currentWidth} too small to split (minimum ${MIN_WIDTH * 2})`);
    }

    const newWindow: Window = {
      id: mintWindowId(),
      buffer: currentBuffer,
      bufferName: currentWindow.bufferName,
      cursorLine: currentWindow.cursorLine,
      cursorColumn: currentWindow.cursorColumn,
      viewportTop: currentWindow.viewportTop,
      viewportLeft: currentWindow.viewportLeft ?? 0,
      splitType: type,
      height: Math.floor(currentHeight / 2),
      width: Math.floor(currentWidth / 2),
    };

    // Add new window after the current one (flat registry order); stored
    // dims stay advisory.
    const newWindows = [...windows];
    const originIndex = getCurrentWindowIndex();
    newWindows[originIndex] = { ...currentWindow };
    newWindows.splice(originIndex + 1, 0, newWindow);
    setWindows(newWindows);

    // #260: split the FOCUSED PANE in the tree — the new split node nests
    // inside the focused leaf's frame (mixed-axis layouts become
    // representable; previously one vertical pane re-flowed every pane into
    // columns).
    const tree = getLayout() ?? flatTree(windows) ?? { kind: "leaf", windowId: currentWindow.id } as LayoutNode;
    const grown = replaceLeaf(
      tree,
      currentWindow.id,
      layoutSplit(type, 0.5, { kind: "leaf", windowId: currentWindow.id }, { kind: "leaf", windowId: newWindow.id }),
    );
    setLayout(grown);
    // Stored dims are informational — keep them mirroring the new cells.
    syncStoredDims(getWindows());

    return Either.right(createNil());
  });

  /**
   * Switch to next window
   * Usage: (window-next)
   */
  ops.set("window-next", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-next takes no arguments");
    }

    const windows = getWindows();
    const currentIndex = getCurrentWindowIndex();
    const nextIndex = (currentIndex + 1) % windows.length;
    
    setCurrentWindowIndex(nextIndex);

    return Either.right(createNil());
  });

  /**
   * Switch to previous window
   * Usage: (window-prev)
   */
  ops.set("window-prev", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-prev takes no arguments");
    }

    const windows = getWindows();
    const currentIndex = getCurrentWindowIndex();
    const prevIndex = (currentIndex - 1 + windows.length) % windows.length;
    
    setCurrentWindowIndex(prevIndex);

    return Either.right(createNil());
  });

  /**
   * Close current window
   * Usage: (window-close)
   */
  ops.set("window-close", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-close takes no arguments");
    }

    const windows = getWindows();
    
    // Don't allow closing the last window
    if (windows.length <= 1) {
      return Either.right(createNil());
    }

    const currentIndex = getCurrentWindowIndex();

    // Remove current window
    const newWindows = windows.filter((_, i) => i !== currentIndex);
    setWindows(newWindows);

    // #260: prune the closed leaf from the tree — single-child splits
    // collapse (the surviving sibling takes its parent's frame).
    const afterClose = getLayout();
    if (afterClose) {
      setLayout(pruneTree(afterClose, liveIds(newWindows)));
    }

    // The focused window was removed — the model must rebind to the
    // surviving window that now occupies this slot (or the last one).
    // Closing a focused non-last window previously left the model editing
    // the CLOSED window's buffer (#262).
    setCurrentWindowIndex(Math.min(currentIndex, newWindows.length - 1));

    return Either.right(createNil());
  });

  /**
   * Get list of all windows
   * Usage: (window-list)
   */
  ops.set("window-list", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-list takes no arguments");
    }

    const windows = getWindows();
    // #263: expose bufferName + dimensions — the fields live layout
    // debugging actually needs (cursor alone made the #258/#259 triage
    // awkward). #260: dimensions are the authoritative CELLS.
    const cells = layoutCells();
    const windowList = windows.map(w => {
      const cell = cells.find((c) => c.windowId === w.id);
      return createList([
        createSymbol("window"),
        createString(w.id),
        createString(w.bufferName ?? ""),
        createNumber(w.cursorLine),
        createNumber(w.cursorColumn),
        createNumber(cell?.height ?? w.height ?? 0),
        createNumber(cell?.width ?? w.width ?? 0),
      ]);
    });

    return Either.right(createList(windowList));
  });

  /**
   * Get current window index
   * Usage: (window-current)
   */
  ops.set("window-current", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-current takes no arguments");
    }

    return Either.right(createNumber(getCurrentWindowIndex()));
  });

  /**
   * Get total number of windows
   * Usage: (window-count)
   */
  ops.set("window-count", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-count takes no arguments");
    }

    return Either.right(createNumber(getWindows().length));
  });

  /**
   * Resize current window height by delta
   * Usage: (window-resize-height delta)
   */
  ops.set("window-resize-height", (args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("window-resize-height requires one argument: delta");
    }

    const deltaValue = args[0]!
    if (deltaValue.type !== "number") {
      throw new Error("window-resize-height delta must be a number");
    }

    const delta = deltaValue.value as number;
    const windows = getWindows();
    const currentIndex = getCurrentWindowIndex();
    const currentWindow = windows[currentIndex];

    if (!currentWindow) {
      throw new Error("No current window");
    }

    // #260: with a split tree, resize adjusts the ratio of the nearest
    // enclosing horizontal split (both sides keep the pane minimum). Stored
    // dims sync from the new cells. A bare-leaf tree (single window) or no
    // tree falls to the legacy stored-dim arithmetic.
    const tree = getLayout();
    if (tree && tree.kind === "split") {
      const resized = resizeTreeRatio(tree, currentWindow.id, "horizontal", delta);
      if (resized) {
        setLayout(resized);
        syncStoredDims(getWindows());
        return Either.right(createNil());
      }
      return Either.right(createNil()); // no horizontal split on the path — no-op
    }

    const currentHeight = currentWindow.height || 24; // Default terminal height
    const MIN_HEIGHT = 3; // Minimum window height

    // Calculate new height with bounds checking
    const newHeight = Math.max(MIN_HEIGHT, currentHeight + delta);

    // Update current window height
    const updatedWindows = [...windows];
    updatedWindows[currentIndex] = {
      ...currentWindow,
      height: newHeight
    };
    setWindows(updatedWindows);

    return Either.right(createNil());
  });

  /**
   * Resize current window width by delta
   * Usage: (window-resize-width delta)
   */
  ops.set("window-resize-width", (args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("window-resize-width requires one argument: delta");
    }

    const deltaValue = args[0]!
    if (deltaValue.type !== "number") {
      throw new Error("window-resize-width delta must be a number");
    }

    const delta = deltaValue.value as number;
    const windows = getWindows();
    const currentIndex = getCurrentWindowIndex();
    const currentWindow = windows[currentIndex];

    if (!currentWindow) {
      throw new Error("No current window");
    }

    // #260: tree-first ratio resize (see window-resize-height).
    const tree = getLayout();
    if (tree && tree.kind === "split") {
      const resized = resizeTreeRatio(tree, currentWindow.id, "vertical", delta);
      if (resized) {
        setLayout(resized);
        syncStoredDims(getWindows());
        return Either.right(createNil());
      }
      return Either.right(createNil()); // no vertical split on the path — no-op
    }

    const currentWidth = currentWindow.width || 80; // Default terminal width
    const MIN_WIDTH = 10; // Minimum window width

    // Calculate new width with bounds checking
    const newWidth = Math.max(MIN_WIDTH, currentWidth + delta);

    // Update current window width
    const updatedWindows = [...windows];
    updatedWindows[currentIndex] = {
      ...currentWindow,
      width: newWidth
    };
    setWindows(updatedWindows);

    return Either.right(createNil());
  });

  /**
   * Balance (equalize) window heights/widths across all windows (SPEC-084).
   *
   * Groups windows by the dominant split axis and sets each window's dimension
   * to floor(total / count), assigning the remainder to the last window so the
   * sizes sum to the terminal size. No-op when only one window exists.
   *
   * Usage: (window-balance) -> nil
   *
   * Named `window-balance` to match the `window-*` primitive convention
   * (split-window, window-resize-height, …); the Emacs-parity T-Lisp command
   * `balance-windows` in src/tlisp/core/commands/windows.tlisp wraps this.
   */
  ops.set("window-balance", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-balance takes no arguments");
    }

    const windows = getWindows();

    // No-op with a single window
    if (windows.length <= 1) {
      return Either.right(createNil());
    }

    // #260: with a tree, balance resets every split ratio to 0.5 (each
    // frame divides evenly, recursively) and stored dims sync from cells.
    const tree = getLayout();
    if (tree) {
      const rebalance = (node: LayoutNode): LayoutNode =>
        node.kind === "leaf"
          ? node
          : { ...node, ratio: 0.5, first: rebalance(node.first), second: rebalance(node.second) };
      setLayout(rebalance(tree));
      syncStoredDims(getWindows());
      return Either.right(createNil());
    }

    const terminalSize = getTerminalSize();
    const MIN_HEIGHT = 3; // mirror window-resize-height
    const MIN_WIDTH = 10; // mirror window-resize-width

    // Determine the dominant axis: prefer an explicit 'vertical' splitType
    // (left/right panes → balance widths); otherwise treat panes as stacked
    // horizontally (top/bottom → balance heights). This mirrors how split-window
    // derives dimensions at lines 67-99.
    const hasVerticalSplit = windows.some(
      (w) => w.splitType === "vertical"
    );

    const count = windows.length;
    const updatedWindows = windows.map((w, i) => {
      if (hasVerticalSplit) {
        // Vertical splits: equalize widths across columns
        const totalWidth = terminalSize.width;
        const evenWidth = Math.max(MIN_WIDTH, Math.floor(totalWidth / count));
        // Last window absorbs the remainder so widths sum to totalWidth
        const width =
          i === count - 1
            ? Math.max(MIN_WIDTH, totalWidth - evenWidth * (count - 1))
            : evenWidth;
        return { ...w, width };
      } else {
        // Horizontal splits: equalize heights across rows (reserve status line)
        const STATUS_ROWS = 2; // status line + command/echo area (matches split-window's terminalSize.height - 2)
        const totalHeight = terminalSize.height - STATUS_ROWS;
        const evenHeight = Math.max(MIN_HEIGHT, Math.floor(totalHeight / count));
        // Last window absorbs the remainder so heights sum to totalHeight
        const height =
          i === count - 1
            ? Math.max(MIN_HEIGHT, totalHeight - evenHeight * (count - 1))
            : evenHeight;
        return { ...w, height };
      }
    });

    setWindows(updatedWindows);

    return Either.right(createNil());
  });

  /**
   * split-window-below — Emacs/vim alias for (split-window "horizontal"): split
   * the current window into two stacked panes. SPEC-084 balance-windows DoD
   * drives the split via this name.
   */
  ops.set("split-window-below", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("split-window-below takes no arguments");
    }
    const fn = ops.get("split-window")!;
    return fn([createString("horizontal")]);
  });

  /**
   * split-window-right — Emacs alias for (split-window "vertical"): split the
   * current window into two side-by-side panes.
   */
  ops.set("split-window-right", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("split-window-right takes no arguments");
    }
    const fn = ops.get("split-window")!;
    return fn([createString("vertical")]);
  });

  /**
   * delete-other-windows — close every window except the current one (vim :only
   * / Emacs C-x 1). The focused window survives as the only pane: its record
   * absorbs the model's live context before the switch port restores from it,
   * so the collapse keeps the model cursor where the user is (#262). #261: this
   * TS implementation is the live one (TS builtins win symbol resolution over
   * same-named T-Lisp defuns — the windows.tlisp loop duplicate was removed);
   * the array surgery + context absorb is layout-mutation logic that belongs
   * at this altitude.
   */
  ops.set("delete-other-windows", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("delete-other-windows takes no arguments");
    }
    const windows = getWindows();
    const currentIdx = getCurrentWindowIndex();
    const current = windows[currentIdx];
    if (!current || windows.length <= 1) {
      return Either.right(createNil());
    }
    const cursor = runModel(access, readModelField("cursorPosition"));
    const kept: Window = {
      ...current,
      buffer: getCurrentBuffer() ?? current.buffer,
      cursorLine: cursor?.line ?? current.cursorLine,
      cursorColumn: cursor?.column ?? current.cursorColumn,
      viewportTop: runModel(access, readModelField("viewportTop")) ?? current.viewportTop,
      viewportLeft: runModel(access, readModelField("viewportLeft")) ?? current.viewportLeft,
    };
    setWindows([kept]);
    // #260: the tree collapses to the surviving leaf (full frame).
    setLayout({ kind: "leaf", windowId: kept.id });
    setCurrentWindowIndex(0);
    return Either.right(createNil());
  });

  /**
   * window-move-focus — focus the nearest pane in a direction
   * ("left"|"right"|"up"|"down") using the computeLayout cell geometry
   * (#261). A candidate must share an edge overlap on the perpendicular
   * axis and lie strictly on the target side; the nearest edge wins
   * (largest overlap breaks ties). No candidate → nil, focus unchanged.
   * The focus switch routes through the switch port, so the full #262
   * context rebind applies.
   */
  ops.set("window-move-focus", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 1) {
      throw new Error("window-move-focus requires one argument: direction");
    }
    const dirArg = args[0]!;
    if (dirArg.type !== "string") {
      throw new Error("window-move-focus direction must be a string");
    }
    const dir = dirArg.value as string;
    if (dir !== "left" && dir !== "right" && dir !== "up" && dir !== "down") {
      throw new Error("window-move-focus direction must be 'left', 'right', 'up', or 'down'");
    }

    const windows = getWindows();
    if (windows.length <= 1) return Either.right(createNil());
    // #260: cells come from the tree when present (nested geometry).
    const cells = layoutCells();
    const currentIndex = getCurrentWindowIndex();
    const current = cells.find((c) => c.windowId === windows[currentIndex]?.id);
    if (!current) return Either.right(createNil());

    let bestId: string | undefined;
    let bestDistance = Infinity;
    let bestOverlap = 0;
    for (const cell of cells) {
      if (cell.windowId === current.windowId) continue;
      let distance: number;
      let overlap: number;
      if (dir === "left" || dir === "right") {
        overlap = Math.min(cell.y + cell.height, current.y + current.height) - Math.max(cell.y, current.y);
        distance = dir === "left"
          ? current.x - (cell.x + cell.width)
          : cell.x - (current.x + current.width);
      } else {
        overlap = Math.min(cell.x + cell.width, current.x + current.width) - Math.max(cell.x, current.x);
        distance = dir === "up"
          ? current.y - (cell.y + cell.height)
          : cell.y - (current.y + current.height);
      }
      // Strictly on the target side, sharing some perpendicular extent.
      if (distance <= 0 || overlap <= 0) continue;
      // Nearest edge wins (the immediately adjacent pane — windmove/vim
      // semantics); largest perpendicular overlap only breaks distance ties.
      // (The orderings coincide on flat single-axis layouts; they diverge
      // under #260's mixed-axis trees.)
      if (distance < bestDistance || (distance === bestDistance && overlap > bestOverlap)) {
        bestId = cell.windowId;
        bestDistance = distance;
        bestOverlap = overlap;
      }
    }

    if (!bestId) return Either.right(createNil());
    const targetIndex = getWindows().findIndex((w) => w.id === bestId);
    if (targetIndex < 0) return Either.right(createNil());
    setCurrentWindowIndex(targetIndex);
    return Either.right(createNumber(targetIndex));
  });

  /**
   * window-rotate — swap the focused window with the next one (cyclic), vim
   * C-w r: pane CONTENTS trade places while focus stays on the same slot
   * (#261). No-op with a single window.
   */
  ops.set("window-rotate", (args: TLispValue[]): Either<AppError, TLispValue> => {
    if (args.length !== 0) {
      throw new Error("window-rotate takes no arguments");
    }
    const windows = getWindows();
    if (windows.length <= 1) return Either.right(createNil());
    const currentIndex = getCurrentWindowIndex();
    const nextIndex = (currentIndex + 1) % windows.length;
    const rotated = [...windows];
    const a = rotated[currentIndex]!;
    rotated[currentIndex] = rotated[nextIndex]!;
    rotated[nextIndex] = a;
    setWindows(rotated);
    // The focused slot now holds the OTHER record — re-route the switch port
    // so the model rebinds to the slot's new occupant (same-index switch with
    // a different buffer rebinds; same buffer is already consistent).
    setCurrentWindowIndex(currentIndex);
    return Either.right(createNil());
  });

  /**
   * window-height — read a window's height by index. SPEC-084 balance-windows
   * DoD asserts the two panes share an equal height after balance.
   */
  ops.set("window-height", (args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("window-height requires one argument: index");
    }
    const idxArg = args[0]!;
    if (idxArg.type !== "number") {
      throw new Error("window-height index must be a number");
    }
    const idx = idxArg.value as number;
    const windows = getWindows();
    const w = windows[idx];
    if (!w) {
      throw new Error(`window-height: no window at index ${idx}`);
    }
    // #260: the authoritative height is the CELL (tree layout).
    const cell = layoutCells().find((c) => c.windowId === w.id);
    return Either.right(createNumber(cell?.height ?? w.height ?? 0));
  });

  /**
   * window-width — read a window's width by index (#263: the symmetric
   * twin of window-height, absent before).
   */
  ops.set("window-width", (args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("window-width requires one argument: index");
    }
    const idxArg = args[0]!;
    if (idxArg.type !== "number") {
      throw new Error("window-width index must be a number");
    }
    const idx = idxArg.value as number;
    const windows = getWindows();
    const w = windows[idx];
    if (!w) {
      throw new Error(`window-width: no window at index ${idx}`);
    }
    // #260: the authoritative width is the CELL (tree layout).
    const cell = layoutCells().find((c) => c.windowId === w.id);
    return Either.right(createNumber(cell?.width ?? w.width ?? 0));
  });

  return ops;
}
