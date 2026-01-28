/**
 * @file ink-adapter.ts
 * @description Deno-ink adapter that implements FunctionalTerminalIO interface
 * This allows the editor to use React-based UI with Deno-ink while maintaining
 * functional programming patterns through TaskEither.
 */

import { TaskEither, Either } from "../utils/task-either.ts";
import { FunctionalTerminalIO, TerminalSize, Position, TerminalError } from "../core/types.ts";
import { ErrorFactory, TmaxError } from "../utils/error-manager.ts";
import { log } from "../utils/logger.ts";

/**
 * InkTerminalIO - Implements FunctionalTerminalIO using Deno-ink
 * This adapter bridges the functional terminal interface with Deno-ink's React-based rendering
 */
export class InkTerminalIO implements FunctionalTerminalIO {
  private logger = log.module("InkTerminalIO");

  // Store terminal size - will be updated by Deno-ink when available
  private _size: TerminalSize = { width: 80, height: 24 };

  // Track terminal state
  private _isRawMode = false;
  private _isAlternateScreen = false;
  private _isCursorHidden = false;

  // Callback for size change notifications
  private _onSizeChangeCallback?: (size: TerminalSize) => void;

  /**
   * Get terminal dimensions
   * Note: In Deno-ink, this will be provided by the render function context
   */
  getSize(): Either<TerminalError, TerminalSize> {
    const fnLogger = this.logger.fn("getSize");

    try {
      fnLogger.debug("Retrieved terminal size", {
        operation: "get_size"
      }, this._size);

      return Either.right(this._size);
    } catch (error) {
      // Return fallback size for non-TTY environments
      const fallbackSize = {
        width: 80,
        height: 24,
      };

      fnLogger.warn("Using fallback terminal size", {
        operation: "get_size",
        metadata: { reason: "console_size_failed" }
      }, { fallback: fallbackSize, originalError: error });

      return Either.right(fallbackSize);
    }
  }

  /**
   * Set callback to be notified of terminal size changes
   */
  onSizeChange(callback: (size: TerminalSize) => void): void {
    this._onSizeChangeCallback = callback;
  }

  /**
   * Update terminal size - called by React components when resize occurs
   */
  updateSize(width: number, height: number): void {
    const fnLogger = this.logger.fn("updateSize");
    const newSize = { width, height };

    fnLogger.debug(`Updating terminal size to ${width}x${height}`, {
      operation: "update_terminal_size"
    });

    this._size = newSize;

    // Notify listeners of size change
    if (this._onSizeChangeCallback) {
      try {
        this._onSizeChangeCallback(newSize);
      } catch (error) {
        fnLogger.warn("Size change callback threw an error", {
          operation: "notify_size_change",
          metadata: { error: error instanceof Error ? error.message : String(error) }
        });
      }
    }
  }

  /**
   * Clear the terminal screen
   * In Deno-ink, clearing is handled by React rendering
   */
  clear(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("clear");
    const correlationId = fnLogger.startOperation("clear_screen");

    return TaskEither.of(void 0); // Handled by React rendering
  }

  /**
   * Clear from cursor to end of line
   * In Deno-ink, this is handled by React rendering
   */
  clearToEndOfLine(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("clearToEndOfLine");
    const correlationId = fnLogger.startOperation("clear_to_eol");

    return TaskEither.of(void 0); // Handled by React rendering
  }

  /**
   * Move cursor to position
   * In Deno-ink, cursor positioning is handled by React components
   */
  moveCursor(position: Position): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("moveCursor");
    const correlationId = fnLogger.startOperation("move_cursor");

    // In Deno-ink, cursor positioning is handled by React components
    // We'll store the position for reference by the UI components
    fnLogger.debug(`Cursor moved to position ${position.line},${position.column}`, {
      operation: "move_cursor",
      correlationId
    });

    return TaskEither.of(void 0);
  }

  /**
   * Write text at current cursor position
   * In Deno-ink, writing is handled by React components
   */
  write(text: string): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("write");
    const correlationId = fnLogger.startOperation("write_text");

    fnLogger.debug(`Writing text: ${text.substring(0, 20)}${text.length > 20 ? '...' : ''}`, {
      operation: "write_text",
      correlationId,
      metadata: { textLength: text.length }
    });

    // In Deno-ink, writing is handled by React components
    return TaskEither.of(void 0);
  }

  /**
   * Read a single key press
   * In Deno-ink, we'll use a promise-based approach that resolves when a key is pressed
   * This will be integrated with React component event handlers
   */
  readKey(): TaskEither<TerminalError, string> {
    const fnLogger = this.logger.fn("readKey");
    const correlationId = fnLogger.startOperation("read_key");

    return TaskEither.tryCatch(
      () => {
        // In a real Deno-ink implementation, this would connect to keyboard events
        // For now, we'll create a promise that would be resolved by external input handling
        return new Promise<string>((resolve, reject) => {
          // This is a simplified version - in practice, this would be connected
          // to React component keyboard event handlers

          // For now, we'll simulate by attaching to a global handler
          // that would be triggered by React components
          const handleKeyPress = (key: string) => {
            resolve(key);
          };

          // Store the resolver so it can be called from React components
          // This is a simplified approach - in reality, we'd have a more sophisticated
          // event system connecting React components to this adapter
          (globalThis as any).__tmax_key_resolver = handleKeyPress;
        });
      },
      (error) => {
        const tmaxError = ErrorFactory.runtime(
          `Failed to read key: ${error instanceof Error ? error.message : String(error)}`,
          "read_key",
          error instanceof Error ? error : undefined,
          {
            module: "InkTerminalIO",
            function: "readKey",
            operation: "read_key",
            correlationId
          }
        );

        fnLogger.failOperation("read_key", correlationId, tmaxError);
        return tmaxError;
      }
    );
  }

  /**
   * Enter raw mode
   * In Deno-ink, raw mode is handled by the framework
   */
  enterRawMode(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("enterRawMode");
    const correlationId = fnLogger.startOperation("enter_raw_mode");

    fnLogger.debug("Entering raw mode", {
      operation: "enter_raw_mode",
      correlationId
    });

    this._isRawMode = true;
    return TaskEither.of(void 0);
  }

  /**
   * Exit raw mode
   * In Deno-ink, raw mode is handled by the framework
   */
  exitRawMode(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("exitRawMode");
    const correlationId = fnLogger.startOperation("exit_raw_mode");

    fnLogger.debug("Exiting raw mode", {
      operation: "exit_raw_mode",
      correlationId
    });

    this._isRawMode = false;
    return TaskEither.of(void 0);
  }

  /**
   * Enter alternate screen buffer
   * In Deno-ink, this is handled by React rendering
   */
  enterAlternateScreen(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("enterAlternateScreen");
    const correlationId = fnLogger.startOperation("enter_alternate_screen");

    fnLogger.debug("Entering alternate screen", {
      operation: "enter_alternate_screen",
      correlationId
    });

    this._isAlternateScreen = true;
    return TaskEither.of(void 0);
  }

  /**
   * Exit alternate screen buffer
   * In Deno-ink, this is handled by React rendering
   */
  exitAlternateScreen(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("exitAlternateScreen");
    const correlationId = fnLogger.startOperation("exit_alternate_screen");

    fnLogger.debug("Exiting alternate screen", {
      operation: "exit_alternate_screen",
      correlationId
    });

    this._isAlternateScreen = false;
    return TaskEither.of(void 0);
  }

  /**
   * Hide cursor
   * In Deno-ink, cursor visibility is controlled by React components
   */
  hideCursor(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("hideCursor");
    const correlationId = fnLogger.startOperation("hide_cursor");

    fnLogger.debug("Hiding cursor", {
      operation: "hide_cursor",
      correlationId
    });

    this._isCursorHidden = true;
    return TaskEither.of(void 0);
  }

  /**
   * Show cursor
   * In Deno-ink, cursor visibility is controlled by React components
   */
  showCursor(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("showCursor");
    const correlationId = fnLogger.startOperation("show_cursor");

    fnLogger.debug("Showing cursor", {
      operation: "show_cursor",
      correlationId
    });

    this._isCursorHidden = false;
    return TaskEither.of(void 0);
  }

  /**
   * Check if stdin is a TTY
   */
  isStdinTTY(): Either<TerminalError, boolean> {
    const fnLogger = this.logger.fn("isStdinTTY");

    try {
      // In some environments, Deno.stdin might not be available
      if (typeof Deno === 'undefined' || !Deno?.stdin) {
        fnLogger.warn("Deno.stdin not available, assuming non-TTY environment", {
          operation: "check_tty",
          metadata: { reason: "deno_stdin_unavailable" }
        });
        return Either.right(false);
      }

      const isTTY = Deno.stdin.isTerminal();

      fnLogger.debug("Checked TTY status", {
        operation: "check_tty",
        metadata: { isTTY }
      });

      return Either.right(isTTY);
    } catch (error) {
      // Handle cases where isTerminal() throws an error
      const tmaxError = ErrorFactory.io(
        "Failed to check TTY status",
        "stdin",
        "check_tty",
        error instanceof Error ? error : new Error(String(error)),
        {
          module: "InkTerminalIO",
          function: "isStdinTTY",
          operation: "check_tty"
        }
      );

      fnLogger.error("Failed to check TTY status, falling back to non-TTY", {
        operation: "check_tty",
        metadata: { fallback: false }
      }, tmaxError);

      // Return false as a safe fallback for non-TTY environments
      return Either.right(false);
    }
  }
}