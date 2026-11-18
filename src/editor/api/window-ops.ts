/**
 * @file window-ops.ts
 * @description Window management operations for T-Lisp API (US-3.2.1, US-3.2.2)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import type { Window } from "../../core/contracts/editor.ts";
import type { TextBuffer } from "../../core/contracts/buffer.ts";
import { runModel, readModelField, type EditorModelAccess } from "./state-context.ts";
import { computeLayout } from "../../core/window-layout.ts";
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
  getTerminalSize: () => { width: number; height: number }
): Map<string, TLispFunctionImpl> {
  // CHORE-39 Phase 4: window/index/buffer reads flow through the State monad
  // against EditorModel; writes + terminal-size accessor stay on callbacks.
  const getWindows = (): Window[] => [...(runModel(access, readModelField("windows")) ?? [])];
  const getCurrentWindowIndex = (): number => runModel(access, readModelField("currentWindowIndex")) ?? 0;
  const getCurrentBuffer = (): TextBuffer | undefined =>
    runModel(access, readModelField("currentBuffer"));
  const ops = new Map<string, TLispFunctionImpl>();

  /**
   * Split window horizontally or vertically
   * Usage: (split-window "horizontal") or (split-window "vertical")
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
    
    // Calculate dimensions based on split type. A split divides the pane:
    // BOTH halves get a share of the divided dimension (#259 — previously
    // only the new window got floor(dim/2) while the origin kept its full
    // stored size, so stored sizes summed past the terminal).
    const currentHeight = currentWindow.height || terminalSize.height - 2;
    const currentWidth = currentWindow.width || terminalSize.width;

    let newHeight: number;
    let newWidth: number;
    let originHeight = currentHeight;
    let originWidth = currentWidth;

    if (type === "horizontal") {
      // Split horizontally: divide height
      newHeight = Math.max(3, Math.floor(currentHeight / 2));
      newWidth = currentWidth;
      originHeight = Math.max(3, currentHeight - newHeight);
    } else {
      // Split vertically: divide width
      newHeight = currentHeight;
      newWidth = Math.max(10, Math.floor(currentWidth / 2));
      originWidth = Math.max(10, currentWidth - newWidth);
    }

    const newWindow: Window = {
      id: `window-${Date.now()}`,
      buffer: currentBuffer,
      bufferName: currentWindow.bufferName,
      cursorLine: currentWindow.cursorLine,
      cursorColumn: currentWindow.cursorColumn,
      viewportTop: currentWindow.viewportTop,
      viewportLeft: currentWindow.viewportLeft ?? 0,
      splitType: type,
      height: newHeight,
      width: newWidth,
    };

    // Add new window after the current one; the origin window's stored
    // dimension shrinks to its half of the split.
    const newWindows = [...windows];
    const originIndex = getCurrentWindowIndex();
    newWindows[originIndex] = {
      ...currentWindow,
      height: originHeight,
      width: originWidth,
    };
    newWindows.splice(originIndex + 1, 0, newWindow);
    setWindows(newWindows);

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
    const windowList = windows.map(w => 
      createList([
        createSymbol("window"),
        createString(w.id),
        createNumber(w.cursorLine),
        createNumber(w.cursorColumn)
      ])
    );

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
      throw new Error("balance-windows takes no arguments");
    }

    const windows = getWindows();

    // No-op with a single window
    if (windows.length <= 1) {
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
    const cells = computeLayout(windows, getTerminalSize().width, getTerminalSize().height);
    const currentIndex = getCurrentWindowIndex();
    const current = cells[currentIndex];
    if (!current) return Either.right(createNil());

    let bestIndex = -1;
    let bestDistance = Infinity;
    let bestOverlap = 0;
    for (let i = 0; i < cells.length; i++) {
      if (i === currentIndex) continue;
      const cell = cells[i]!;
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
        bestIndex = i;
        bestDistance = distance;
        bestOverlap = overlap;
      }
    }

    if (bestIndex === -1) return Either.right(createNil());
    setCurrentWindowIndex(bestIndex);
    return Either.right(createNumber(bestIndex));
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
    return Either.right(createNumber(w.height ?? 0));
  });

  return ops;
}
