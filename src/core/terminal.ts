/**
 * @file terminal.ts
 * @description Functional terminal I/O operations using TaskEither for tmax editor
 * Cross-platform implementation for Bun/Node
 */

import type { TerminalSize, Position, TerminalIO } from "./types.ts";
import { TaskEither, Either } from "../utils/task-either.ts";
import { log } from "../utils/logger.ts";
import { ErrorFactory, TmaxError, ErrorCategory } from "../utils/error-manager.ts";
import * as readline from 'readline';
import { stdin as stdin, stdout as stdout } from 'process';

/**
 * Terminal operation result types
 */
export type TerminalError = TmaxError;

/**
 * Functional terminal operations interface using TaskEither
 */
export interface FunctionalTerminalIO {
  /** Get terminal dimensions */
  getSize(): Either<TerminalError, TerminalSize>;
  
  /** Clear the terminal */
  clear(): TaskEither<TerminalError, void>;
  
  /** Clear from cursor to end of line */
  clearToEndOfLine(): TaskEither<TerminalError, void>;
  
  /** Move cursor to position */
  moveCursor(position: Position): TaskEither<TerminalError, void>;
  
  /** Write text at current cursor position */
  write(text: string): TaskEither<TerminalError, void>;
  
  /** Read a single key press */
  readKey(): TaskEither<TerminalError, string>;
  
  /** Enter raw mode */
  enterRawMode(): TaskEither<TerminalError, void>;
  
  /** Exit raw mode */
  exitRawMode(): TaskEither<TerminalError, void>;
  
  /** Enter alternate screen buffer */
  enterAlternateScreen(): TaskEither<TerminalError, void>;
  
  /** Exit alternate screen buffer */
  exitAlternateScreen(): TaskEither<TerminalError, void>;
  
  /** Hide cursor */
  hideCursor(): TaskEither<TerminalError, void>;
  
  /** Show cursor */
  showCursor(): TaskEither<TerminalError, void>;
  
  /** Check if stdin is a TTY */
  isStdinTTY(): Either<TerminalError, boolean>;
}

/**
 * Functional terminal I/O implementation using TaskEither
 */
export class FunctionalTerminalIOImpl implements FunctionalTerminalIO {
  private rawMode = false;
  private logger = log.module("Terminal");
  
  constructor(private developmentMode = false) {}

  /**
   * Get terminal dimensions with functional error handling
   */
  getSize(): Either<TerminalError, TerminalSize> {
    const fnLogger = this.logger.fn("getSize");

    try {
      const terminalSize = {
        width: stdout.columns || 80,
        height: stdout.rows || 24,
      };

      fnLogger.debug("Retrieved terminal size", {
        operation: "get_size"
      }, terminalSize);

      return Either.right(terminalSize);
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
   * Clear the terminal screen
   */
  clear(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("clear");
    const correlationId = fnLogger.startOperation("clear_screen");
    
    return this.writeEscapeSequence("\x1b[2J\x1b[H", "clear screen", correlationId)
      .map(() => {
        fnLogger.completeOperation("clear_screen", correlationId);
        return void 0;
      })
      .mapLeft((error) => {
        fnLogger.failOperation("clear_screen", correlationId, error);
        return error;
      });
  }

  /**
   * Clear from cursor to end of line
   */
  clearToEndOfLine(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("clearToEndOfLine");
    const correlationId = fnLogger.startOperation("clear_to_eol");
    
    return this.writeEscapeSequence("\x1b[K", "clear to end of line", correlationId)
      .map(() => {
        fnLogger.completeOperation("clear_to_eol", correlationId);
        return void 0;
      })
      .mapLeft((error) => {
        fnLogger.failOperation("clear_to_eol", correlationId, error);
        return error;
      });
  }

  /**
   * Move cursor to specified position
   */
  moveCursor(position: Position): TaskEither<TerminalError, void> {
    const escapeSequence = `\x1b[${position.line + 1};${position.column + 1}H`;
    return this.writeEscapeSequence(escapeSequence, `move cursor to ${position.line},${position.column}`);
  }

  /**
   * Write text at current cursor position
   */
  write(text: string): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("write");
    const correlationId = fnLogger.startOperation("write_text");
    
    return TaskEither.tryCatch(
      async () => {
        const encoded = new TextEncoder().encode(text);
        try {
          stdout.write(encoded);
        } catch {
          // Async write as fallback
          await new Promise<void>((resolve, reject) => {
            stdout.write(encoded, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
        fnLogger.completeOperation("write_text", correlationId);
      },
      (error) => {
        const tmaxError = ErrorFactory.io(
          "Failed to write text",
          "stdout",
          "write_text",
          error instanceof Error ? error : new Error(String(error)),
          {
            module: "Terminal",
            function: "write",
            operation: "write_text",
            correlationId,
            metadata: { textLength: text.length }
          }
        );
        fnLogger.failOperation("write_text", correlationId, tmaxError);
        return tmaxError;
      }
    );
  }

  /**
   * Read a single key press
   */
  readKey(): TaskEither<TerminalError, string> {
    const fnLogger = this.logger.fn("readKey");
    const correlationId = fnLogger.startOperation("read_key");
    
    return TaskEither.tryCatch(
      async () => {
        if (!this.rawMode && !this.developmentMode) {
          throw ErrorFactory.validation(
            "Terminal must be in raw mode to read keys",
            "terminal_mode",
            this.rawMode,
            "raw_mode",
            {
              module: "Terminal",
              function: "readKey",
              operation: "read_key",
              correlationId,
              suggestions: ["Call enterRawMode() before reading keys"]
            }
          );
        }
        
        // In development mode, simulate key reading with a mock
        if (this.developmentMode) {
          fnLogger.debug("Development mode: Simulating key read", { correlationId });
          fnLogger.completeOperation("read_key", correlationId);
          // Simulate 'q' key to exit gracefully for testing
          return 'q';
        }

        fnLogger.debug("Reading key from stdin", { 
          operation: "read_key",
          correlationId 
        });

                const buffer = new Uint8Array(8);

        // Read single keypress from stdin
        const bytesRead = await new Promise<number>((resolve, reject) => {
          stdin.readOnce(buffer, (err, bytesRead) => {
            if (err) {
              reject(err);
            } else {
              resolve(bytesRead);
            }
          });
        });

        if (bytesRead === null) {
          throw ErrorFactory.io(
            "Failed to read from stdin",
            "stdin",
            "read_key",
            undefined,
            {
              module: "Terminal",
              function: "readKey",
              operation: "read_key",
              correlationId,
              suggestions: ["Check if terminal is properly initialized", "Ensure stdin is available"]
            }
          );
        }

        const key = new TextDecoder().decode(buffer.subarray(0, bytesRead));
        fnLogger.completeOperation("read_key", correlationId, { key: key.replace(/\x1b/g, '\\x1b'), bytesRead });

        return key;
      },
      (error) => {
        if (error instanceof TmaxError) {
          fnLogger.failOperation("read_key", correlationId, error);
          return error;
        }
        
        const tmaxError = ErrorFactory.runtime(
          `Failed to read key: ${error instanceof Error ? error.message : String(error)}`,
          "read_key",
          error instanceof Error ? error : undefined,
          {
            module: "Terminal",
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
   * Enter raw mode for character-by-character input
   */
  enterRawMode(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("enterRawMode");
    const correlationId = fnLogger.startOperation("enter_raw_mode");
    
    return TaskEither.tryCatch(
      async () => {
        if (this.rawMode) {
          fnLogger.debug("Already in raw mode", { 
            operation: "enter_raw_mode",
            correlationId 
          });
          return;
        }
        
        if (!this.developmentMode && !this.isStdinTTYInternal()) {
          throw ErrorFactory.validation(
            "Cannot enter raw mode: stdin is not a TTY. tmax must be run in a terminal.",
            "stdin_tty",
            false,
            true,
            {
              module: "Terminal",
              function: "enterRawMode",
              operation: "enter_raw_mode",
              correlationId,
              category: ErrorCategory.CONFIGURATION,
              suggestions: [
                "Run tmax from a real terminal (not through pipes, redirects, or non-interactive environments)",
                "If developing with AI coding assistants, use: deno task start --dev",
                "Check if you're in a proper terminal emulator that supports raw mode",
                "For CI/CD or automated testing, consider headless mode options"
              ]
            }
          );
        }
        
        // Skip raw mode setup in development mode
        if (this.developmentMode) {
          fnLogger.debug("Development mode: Skipping raw mode setup", { correlationId });
          fnLogger.completeOperation("enter_raw_mode", correlationId);
          return;
        }
        
        fnLogger.debug("Setting raw mode", {
          operation: "enter_raw_mode",
          correlationId
        });

        // Set raw mode using Bun's setRaw (cross-platform)
        if (typeof Bun !== 'undefined' && (Bun as any).setRaw) {
          (Bun as any).setRaw(true);
        } else {
          // Fallback for Node.js
          readline.emitKeypressEvents(stdin, true);
          stdin.setRawMode(true);
        }
        this.rawMode = true;
        
        // Initialize alternate screen and hide cursor
        const alternateResult = await this.enterAlternateScreen().run();
        if (Either.isLeft(alternateResult)) {
          fnLogger.warn("Failed to enter alternate screen", {
            operation: "enter_raw_mode",
            correlationId
          }, alternateResult.left);
        }
        
        const hideCursorResult = await this.hideCursor().run();
        if (Either.isLeft(hideCursorResult)) {
          fnLogger.warn("Failed to hide cursor", {
            operation: "enter_raw_mode", 
            correlationId
          }, hideCursorResult.left);
        }
        
        fnLogger.completeOperation("enter_raw_mode", correlationId);
      },
      (error) => {
        if (error instanceof TmaxError) {
          fnLogger.failOperation("enter_raw_mode", correlationId, error);
          return error;
        }
        
        const tmaxError = ErrorFactory.runtime(
          `Failed to enter raw mode: ${error instanceof Error ? error.message : String(error)}`,
          "enter_raw_mode",
          error instanceof Error ? error : undefined,
          {
            module: "Terminal",
            function: "enterRawMode",
            operation: "enter_raw_mode",
            correlationId
          }
        );
        
        fnLogger.failOperation("enter_raw_mode", correlationId, tmaxError);
        return tmaxError;
      }
    );
  }

  /**
   * Exit raw mode and restore normal terminal behavior
   */
  exitRawMode(): TaskEither<TerminalError, void> {
    const fnLogger = this.logger.fn("exitRawMode");
    const correlationId = fnLogger.startOperation("exit_raw_mode");
    
    return TaskEither.tryCatch(
      async () => {
        if (!this.rawMode) {
          fnLogger.debug("Already not in raw mode", { 
            operation: "exit_raw_mode",
            correlationId 
          });
          return;
        }
        
        // In development mode, we may not have entered raw mode
        if (this.developmentMode) {
          fnLogger.debug("Development mode: Skipping raw mode exit", { correlationId });
          fnLogger.completeOperation("exit_raw_mode", correlationId);
          return;
        }
        
        await this.showCursor().run();
        await this.exitAlternateScreen().run();

        // Exit raw mode
        if (typeof Bun !== 'undefined' && (Bun as any).setRaw) {
          (Bun as any).setRaw(false);
        } else {
          // Fallback for Node.js
          stdin.setRawMode(false);
          readline.emitKeypressEvents(stdin, false);
        }
        this.rawMode = false;
        
        fnLogger.completeOperation("exit_raw_mode", correlationId);
      },
      (error) => {
        const tmaxError = ErrorFactory.runtime(
          "Failed to exit raw mode",
          "exit_raw_mode",
          error instanceof Error ? error : new Error(String(error)),
          {
            module: "Terminal",
            function: "exitRawMode",
            operation: "exit_raw_mode",
            correlationId
          }
        );
        fnLogger.failOperation("exit_raw_mode", correlationId, tmaxError);
        return tmaxError;
      }
    );
  }

  /**
   * Enter alternate screen buffer
   */
  enterAlternateScreen(): TaskEither<TerminalError, void> {
    return this.writeEscapeSequence("\x1b[?1049h", "enter alternate screen");
  }

  /**
   * Exit alternate screen buffer
   */
  exitAlternateScreen(): TaskEither<TerminalError, void> {
    return this.writeEscapeSequence("\x1b[?1049l", "exit alternate screen");
  }

  /**
   * Hide cursor
   */
  hideCursor(): TaskEither<TerminalError, void> {
    return this.writeEscapeSequence("\x1b[?25l", "hide cursor");
  }

  /**
   * Show cursor
   */
  showCursor(): TaskEither<TerminalError, void> {
    return this.writeEscapeSequence("\x1b[?25h", "show cursor");
  }

  /**
   * Check if stdin is a TTY
   */
  isStdinTTY(): Either<TerminalError, boolean> {
    const result = Either.tryCatch(() => this.isStdinTTYInternal());
    if (Either.isLeft(result)) {
      return Either.left(ErrorFactory.io(
        "Failed to check TTY status",
        "stdin",
        "check_tty",
        result.left,
        {
          module: "Terminal",
          function: "isStdinTTY",
          operation: "check_tty"
        }
      ));
    }
    return result;
  }

  /**
   * Internal helper to check if stdin is a TTY
   */
  private isStdinTTYInternal(): boolean {
    return stdin.isTTY;
  }

  /**
   * Helper to write escape sequences with error handling
   */
  private writeEscapeSequence(sequence: string, operation: string, correlationId?: string): TaskEither<TerminalError, void> {
    return TaskEither.tryCatch(
      async () => {
        const encoded = new TextEncoder().encode(sequence);
        try {
          stdout.write(encoded);
        } catch {
          // Async write as fallback
          await new Promise<void>((resolve, reject) => {
            stdout.write(encoded, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      },
      (error) => ErrorFactory.io(
        `Failed to ${operation}`,
        "stdout",
        operation,
        error instanceof Error ? error : new Error(String(error)),
        {
          module: "Terminal",
          function: "writeEscapeSequence",
          operation,
          correlationId,
          metadata: { sequence: sequence.replace(/\x1b/g, '\\x1b') }
        }
      )
    );
  }
}

/**
 * Terminal utility functions using functional patterns
 */
export const TerminalUtils = {
  /**
   * Write multiple lines with proper positioning
   */
  writeLines: (terminal: FunctionalTerminalIO, lines: string[], startPosition: Position): TaskEither<TerminalError, void> => {
    const writeOperations = lines.map((line, index) => {
      const position: Position = {
        line: startPosition.line + index,
        column: startPosition.column
      };
      
      return terminal.moveCursor(position)
        .flatMap(() => terminal.clearToEndOfLine())
        .flatMap(() => terminal.write(line));
    });
    
    return TaskEither.sequence(writeOperations).map(() => void 0);
  },

  /**
   * Clear a rectangular area of the terminal
   */
  clearArea: (terminal: FunctionalTerminalIO, topLeft: Position, width: number, height: number): TaskEither<TerminalError, void> => {
    const clearOperations = [];
    
    for (let i = 0; i < height; i++) {
      const position: Position = {
        line: topLeft.line + i,
        column: topLeft.column
      };
      
      clearOperations.push(
        terminal.moveCursor(position)
          .flatMap(() => terminal.write(" ".repeat(width)))
      );
    }
    
    return TaskEither.sequence(clearOperations).map(() => void 0);
  },

  /**
   * Write text with word wrapping
   */
  writeWrapped: (terminal: FunctionalTerminalIO, text: string, startPosition: Position, maxWidth: number): TaskEither<TerminalError, Position> => {
    const words = text.split(/\s+/);
    let currentLine = startPosition.line;
    let currentColumn = startPosition.column;
    
    const writeOperations: TaskEither<TerminalError, void>[] = [];
    
    for (const word of words) {
      if (currentColumn + word.length > maxWidth && currentColumn > startPosition.column) {
        // Word doesn't fit, move to next line
        currentLine++;
        currentColumn = startPosition.column;
      }
      
      const position: Position = { line: currentLine, column: currentColumn };
      writeOperations.push(
        terminal.moveCursor(position)
          .flatMap(() => terminal.write(word + " "))
      );
      
      currentColumn += word.length + 1;
    }
    
    return TaskEither.sequence(writeOperations)
      .map(() => ({ line: currentLine, column: currentColumn }));
  },

  /**
   * Setup terminal for editor use
   */
  setupEditorTerminal: (terminal: FunctionalTerminalIO): TaskEither<TerminalError, void> =>
    terminal.enterRawMode()
      .flatMap(() => terminal.enterAlternateScreen())
      .flatMap(() => terminal.hideCursor())
      .flatMap(() => terminal.clear())
      .mapLeft(error => ErrorFactory.runtime(
        "Failed to setup editor terminal",
        "setup_editor",
        error instanceof Error ? error : undefined,
        {
          module: "Terminal",
          function: "setupEditorTerminal",
          operation: "setup_editor"
        }
      )),

  /**
   * Cleanup terminal after editor use
   */
  cleanupEditorTerminal: (terminal: FunctionalTerminalIO): TaskEither<TerminalError, void> =>
    terminal.showCursor()
      .flatMap(() => terminal.exitAlternateScreen())
      .flatMap(() => terminal.exitRawMode())
      .mapLeft(error => ErrorFactory.runtime(
        "Failed to cleanup editor terminal",
        "cleanup_editor",
        error instanceof Error ? error : undefined,
        {
          module: "Terminal",
          function: "cleanupEditorTerminal",
          operation: "cleanup_editor"
        }
      )),

  /**
   * Get terminal capabilities
   */
  getCapabilities: (terminal: FunctionalTerminalIO): Either<TerminalError, { size: TerminalSize; isTTY: boolean }> => {
    const sizeResult = terminal.getSize();
    const ttyResult = terminal.isStdinTTY();
    
    if (Either.isLeft(sizeResult)) {
      return Either.left(ErrorFactory.io(
        "Failed to get terminal size",
        undefined,
        "get_size",
        sizeResult.left instanceof Error ? sizeResult.left : new Error(String(sizeResult.left)),
        {
          module: "Terminal",
          function: "getCapabilities",
          operation: "get_size"
        }
      ));
    }
    
    if (Either.isLeft(ttyResult)) {
      return Either.left(ErrorFactory.io(
        "Failed to get TTY status",
        "stdin",
        "get_tty",
        ttyResult.left instanceof Error ? ttyResult.left : new Error(String(ttyResult.left)),
        {
          module: "Terminal",
          function: "getCapabilities",
          operation: "get_tty"
        }
      ));
    }
    
    return Either.right({
      size: sizeResult.right,
      isTTY: ttyResult.right
    });
  }
};

/**
 * Backward compatibility wrapper for TerminalIOImpl
 * Provides the expected Promise-based interface while using functional implementation internally
 */
export class TerminalIOImpl implements TerminalIO {
  private functionalTerminal: FunctionalTerminalIOImpl;

  constructor(developmentMode = false) {
    this.functionalTerminal = new FunctionalTerminalIOImpl(developmentMode);
  }

  /**
   * Get terminal dimensions
   */
  getSize(): TerminalSize {
    const result = this.functionalTerminal.getSize();
    if (Either.isLeft(result)) {
      throw result.left;
    }
    return result.right;
  }

  /**
   * Clear the terminal
   */
  async clear(): Promise<void> {
    const result = await this.functionalTerminal.clear().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Clear from cursor to end of line
   */
  async clearToEndOfLine(): Promise<void> {
    const result = await this.functionalTerminal.clearToEndOfLine().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Move cursor to position
   */
  async moveCursor(position: Position): Promise<void> {
    const result = await this.functionalTerminal.moveCursor(position).run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Write text at current cursor position
   */
  async write(text: string): Promise<void> {
    const result = await this.functionalTerminal.write(text).run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Read a single key press
   */
  async readKey(): Promise<string> {
    const result = await this.functionalTerminal.readKey().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
    return result.right;
  }

  /**
   * Enter raw mode
   */
  async enterRawMode(): Promise<void> {
    const result = await this.functionalTerminal.enterRawMode().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Exit raw mode
   */
  async exitRawMode(): Promise<void> {
    const result = await this.functionalTerminal.exitRawMode().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Enter alternate screen buffer
   */
  async enterAlternateScreen(): Promise<void> {
    const result = await this.functionalTerminal.enterAlternateScreen().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Exit alternate screen buffer
   */
  async exitAlternateScreen(): Promise<void> {
    const result = await this.functionalTerminal.exitAlternateScreen().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Hide cursor
   */
  async hideCursor(): Promise<void> {
    const result = await this.functionalTerminal.hideCursor().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }

  /**
   * Show cursor
   */
  async showCursor(): Promise<void> {
    const result = await this.functionalTerminal.showCursor().run();
    if (Either.isLeft(result)) {
      throw result.left;
    }
  }
}

// Export utils with functional prefix to avoid conflicts
export { TerminalUtils as FunctionalTerminalUtils };