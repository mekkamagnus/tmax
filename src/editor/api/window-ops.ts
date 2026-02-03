/**
 * @file window-ops.ts
 * @description Window management operations for T-Lisp API (US-3.2.1, US-3.2.2)
 */

import type { TLispValue, TLispFunctionImpl } from "../../tlisp/types.ts";
import { createNil, createNumber, createString, createBoolean, createList, createSymbol } from "../../tlisp/values.ts";
import type { Window } from "../../core/types.ts";
import { AppError } from "../../error/types.ts";

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
  getWindows: () => Window[],
  setWindows: (windows: Window[]) => void,
  getCurrentWindowIndex: () => number,
  setCurrentWindowIndex: (index: number) => void,
  getCurrentBuffer: () => import("../../core/types.ts").FunctionalTextBuffer | undefined,
  getTerminalSize: () => { width: number; height: number }
): Map<string, TLispFunctionImpl> {
  const ops = new Map<string, TLispFunctionImpl>();

  /**
   * Split window horizontally or vertically
   * Usage: (split-window "horizontal") or (split-window "vertical")
   */
  ops.set("split-window", (args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("split-window requires one argument: split type");
    }

    const splitType = args[0];
    if (splitType.type !== "string") {
      throw new Error("split-window type must be a string");
    }

    const type = splitType.value;
    if (type !== "horizontal" && type !== "vertical") {
      throw new Error("split-window type must be 'horizontal' or 'vertical'");
    }

    const windows = getWindows();
    const currentWindow = windows[getCurrentWindowIndex()];
    const currentBuffer = getCurrentBuffer();

    if (!currentBuffer) {
      throw new Error("No buffer to display in new window");
    }

    // Create new window with same buffer
    // Get terminal size for window dimensions (US-3.2.2)
    const terminalSize = getTerminalSize();
    
    // Calculate dimensions based on split type
    const currentHeight = currentWindow.height || terminalSize.height - 2;
    const currentWidth = currentWindow.width || terminalSize.width;
    
    let newHeight: number;
    let newWidth: number;
    
    if (type === "horizontal") {
      // Split horizontally: divide height
      newHeight = Math.floor(currentHeight / 2);
      newWidth = currentWidth;
    } else {
      // Split vertically: divide width
      newHeight = currentHeight;
      newWidth = Math.floor(currentWidth / 2);
    }
    
    const newWindow: Window = {
      id: `window-${Date.now()}`,
      buffer: currentBuffer,
      cursorLine: currentWindow.cursorLine,
      cursorColumn: currentWindow.cursorColumn,
      viewportTop: currentWindow.viewportTop,
      splitType: type,
      height: newHeight,
      width: newWidth,
    };

    // Add new window after current window
    const newWindows = [...windows];
    newWindows.splice(getCurrentWindowIndex() + 1, 0, newWindow);
    setWindows(newWindows);

    return createNil();
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

    return createNil();
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

    return createNil();
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
      return createNil();
    }

    const currentIndex = getCurrentWindowIndex();
    
    // Remove current window
    const newWindows = windows.filter((_, i) => i !== currentIndex);
    setWindows(newWindows);

    // Adjust current window index if needed
    if (currentIndex >= newWindows.length) {
      setCurrentWindowIndex(newWindows.length - 1);
    }

    return createNil();
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

    return createList(windowList);
  });

  /**
   * Get current window index
   * Usage: (window-current)
   */
  ops.set("window-current", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-current takes no arguments");
    }

    return createNumber(getCurrentWindowIndex());
  });

  /**
   * Get total number of windows
   * Usage: (window-count)
   */
  ops.set("window-count", (args: TLispValue[]) => {
    if (args.length !== 0) {
      throw new Error("window-count takes no arguments");
    }

    return createNumber(getWindows().length);
  });

  /**
   * Resize current window height by delta
   * Usage: (window-resize-height delta)
   */
  ops.set("window-resize-height", (args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("window-resize-height requires one argument: delta");
    }

    const deltaValue = args[0];
    if (deltaValue.type !== "number") {
      throw new Error("window-resize-height delta must be a number");
    }

    const delta = deltaValue.value;
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

    return createNil();
  });

  /**
   * Resize current window width by delta
   * Usage: (window-resize-width delta)
   */
  ops.set("window-resize-width", (args: TLispValue[]) => {
    if (args.length !== 1) {
      throw new Error("window-resize-width requires one argument: delta");
    }

    const deltaValue = args[0];
    if (deltaValue.type !== "number") {
      throw new Error("window-resize-width delta must be a number");
    }

    const delta = deltaValue.value;
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

    return createNil();
  });

  return ops;
}
