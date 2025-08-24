/**
 * @file terminal.ts
 * @description Functional terminal I/O operations using TaskEither for tmax editor
 */

import type { TerminalSize, Position, TerminalIO } from "./types.ts";
import { TaskEither, Either } from "../utils/task-either.ts";

/**
 * Terminal operation result types
 */
export type TerminalError = string;

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

  /**
   * Get terminal dimensions with functional error handling
   */
  getSize(): Either<TerminalError, TerminalSize> {
    const result = Either.tryCatch(() => {
      const size = Deno.consoleSize();
      return {
        width: size.columns,
        height: size.rows,
      };
    });
    
    if (Either.isLeft(result)) {
      // Return fallback size for non-TTY environments
      return Either.right({
        width: 80,
        height: 24,
      });
    }
    
    return result;
  }

  /**
   * Clear the terminal screen
   */
  clear(): TaskEither<TerminalError, void> {
    return this.writeEscapeSequence("\x1b[2J\x1b[H", "clear screen");
  }

  /**
   * Clear from cursor to end of line
   */
  clearToEndOfLine(): TaskEither<TerminalError, void> {
    return this.writeEscapeSequence("\x1b[K", "clear to end of line");
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
    return TaskEither.tryCatch(
      async () => {
        const encoded = new TextEncoder().encode(text);
        try {
          Deno.stdout.writeSync(encoded);
        } catch {
          await Deno.stdout.write(encoded);
        }
      },
      (error) => `Failed to write text: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Read a single key press
   */
  readKey(): TaskEither<TerminalError, string> {
    return TaskEither.tryCatch(
      async () => {
        if (!this.rawMode) {
          throw new Error("Terminal must be in raw mode to read keys");
        }

        const buffer = new Uint8Array(8);
        const bytesRead = await Deno.stdin.read(buffer);
        
        if (bytesRead === null) {
          throw new Error("Failed to read from stdin");
        }

        return new TextDecoder().decode(buffer.subarray(0, bytesRead));
      },
      (error) => `Failed to read key: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Enter raw mode for character-by-character input
   */
  enterRawMode(): TaskEither<TerminalError, void> {
    return TaskEither.tryCatch(
      async () => {
        if (this.rawMode) return;
        
        if (!this.isStdinTTYInternal()) {
          throw new Error("Cannot enter raw mode: stdin is not a TTY. tmax must be run in a terminal.");
        }
        
        Deno.stdin.setRaw(true);
        this.rawMode = true;
        await this.enterAlternateScreen().run();
        await this.hideCursor().run();
      },
      (error) => `Failed to enter raw mode: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Exit raw mode and restore normal terminal behavior
   */
  exitRawMode(): TaskEither<TerminalError, void> {
    return TaskEither.tryCatch(
      async () => {
        if (!this.rawMode) return;
        
        await this.showCursor().run();
        await this.exitAlternateScreen().run();
        Deno.stdin.setRaw(false);
        this.rawMode = false;
      },
      (error) => `Failed to exit raw mode: ${error instanceof Error ? error.message : String(error)}`
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
      return Either.left(`Failed to check TTY status: ${result.left.message}`);
    }
    return result;
  }

  /**
   * Internal helper to check if stdin is a TTY
   */
  private isStdinTTYInternal(): boolean {
    return Deno.stdin.isTerminal && Deno.stdin.isTerminal();
  }

  /**
   * Helper to write escape sequences with error handling
   */
  private writeEscapeSequence(sequence: string, operation: string): TaskEither<TerminalError, void> {
    return TaskEither.tryCatch(
      async () => {
        const encoded = new TextEncoder().encode(sequence);
        try {
          Deno.stdout.writeSync(encoded);
        } catch {
          await Deno.stdout.write(encoded);
        }
      },
      (error) => `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`
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
      .mapLeft(error => `Failed to setup editor terminal: ${error}`),

  /**
   * Cleanup terminal after editor use
   */
  cleanupEditorTerminal: (terminal: FunctionalTerminalIO): TaskEither<TerminalError, void> =>
    terminal.showCursor()
      .flatMap(() => terminal.exitAlternateScreen())
      .flatMap(() => terminal.exitRawMode())
      .mapLeft(error => `Failed to cleanup editor terminal: ${error}`),

  /**
   * Get terminal capabilities
   */
  getCapabilities: (terminal: FunctionalTerminalIO): Either<TerminalError, { size: TerminalSize; isTTY: boolean }> => {
    const sizeResult = terminal.getSize();
    const ttyResult = terminal.isStdinTTY();
    
    if (Either.isLeft(sizeResult)) {
      return Either.left(`Failed to get size: ${sizeResult.left}`);
    }
    
    if (Either.isLeft(ttyResult)) {
      return Either.left(`Failed to get TTY status: ${ttyResult.left}`);
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

  constructor() {
    this.functionalTerminal = new FunctionalTerminalIOImpl();
  }

  /**
   * Get terminal dimensions
   */
  getSize(): TerminalSize {
    const result = this.functionalTerminal.getSize();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
    return result.right;
  }

  /**
   * Clear the terminal
   */
  async clear(): Promise<void> {
    const result = await this.functionalTerminal.clear().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Clear from cursor to end of line
   */
  async clearToEndOfLine(): Promise<void> {
    const result = await this.functionalTerminal.clearToEndOfLine().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Move cursor to position
   */
  async moveCursor(position: Position): Promise<void> {
    const result = await this.functionalTerminal.moveCursor(position).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Write text at current cursor position
   */
  async write(text: string): Promise<void> {
    const result = await this.functionalTerminal.write(text).run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Read a single key press
   */
  async readKey(): Promise<string> {
    const result = await this.functionalTerminal.readKey().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
    return result.right;
  }

  /**
   * Enter raw mode
   */
  async enterRawMode(): Promise<void> {
    const result = await this.functionalTerminal.enterRawMode().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Exit raw mode
   */
  async exitRawMode(): Promise<void> {
    const result = await this.functionalTerminal.exitRawMode().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Enter alternate screen buffer
   */
  async enterAlternateScreen(): Promise<void> {
    const result = await this.functionalTerminal.enterAlternateScreen().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Exit alternate screen buffer
   */
  async exitAlternateScreen(): Promise<void> {
    const result = await this.functionalTerminal.exitAlternateScreen().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Hide cursor
   */
  async hideCursor(): Promise<void> {
    const result = await this.functionalTerminal.hideCursor().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }

  /**
   * Show cursor
   */
  async showCursor(): Promise<void> {
    const result = await this.functionalTerminal.showCursor().run();
    if (Either.isLeft(result)) {
      throw new Error(result.left);
    }
  }
}

// Export utils with functional prefix to avoid conflicts
export { TerminalUtils as FunctionalTerminalUtils };