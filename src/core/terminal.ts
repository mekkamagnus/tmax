/**
 * @file terminal.ts
 * @description Terminal I/O implementation for tmax editor
 */

import type { TerminalIO, TerminalSize, Position } from "./types.ts";

/**
 * Terminal I/O implementation using Deno's terminal APIs
 */
export class TerminalIOImpl implements TerminalIO {
  private rawMode = false;

  /**
   * Get terminal dimensions
   * @returns Terminal size object
   */
  getSize(): TerminalSize {
    try {
      const size = Deno.consoleSize();
      return {
        width: size.columns,
        height: size.rows,
      };
    } catch {
      // Fallback for non-TTY environments (like tests)
      return {
        width: 80,
        height: 24,
      };
    }
  }

  /**
   * Enter alternate screen buffer and take over terminal
   */
  async enterAlternateScreen(): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode("\x1b[?1049h"));
  }

  /**
   * Exit alternate screen buffer and restore original terminal
   */
  async exitAlternateScreen(): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode("\x1b[?1049l"));
  }

  /**
   * Clear the terminal screen
   */
  async clear(): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode("\x1b[2J\x1b[H"));
  }

  /**
   * Clear from cursor to end of line
   */
  async clearToEndOfLine(): Promise<void> {
    const encoded = new TextEncoder().encode("\x1b[K");
    try {
      Deno.stdout.writeSync(encoded);
    } catch {
      await Deno.stdout.write(encoded);
    }
  }

  /**
   * Hide cursor
   */
  async hideCursor(): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode("\x1b[?25l"));
  }

  /**
   * Show cursor
   */
  async showCursor(): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode("\x1b[?25h"));
  }

  /**
   * Move cursor to specified position
   * @param position - Target position (1-indexed for terminal)
   */
  async moveCursor(position: Position): Promise<void> {
    const escapeSequence = `\x1b[${position.line + 1};${position.column + 1}H`;
    const encoded = new TextEncoder().encode(escapeSequence);
    try {
      Deno.stdout.writeSync(encoded);
    } catch {
      await Deno.stdout.write(encoded);
    }
  }

  /**
   * Write text at current cursor position
   * @param text - Text to write
   */
  async write(text: string): Promise<void> {
    const encoded = new TextEncoder().encode(text);
    // Use synchronous write to force immediate output
    try {
      Deno.stdout.writeSync(encoded);
    } catch {
      // Fallback to async write if sync fails
      await Deno.stdout.write(encoded);
    }
  }

  /**
   * Read a single key press
   * @returns Promise resolving to key string
   */
  async readKey(): Promise<string> {
    if (!this.rawMode) {
      throw new Error("Terminal must be in raw mode to read keys");
    }

    const buffer = new Uint8Array(8);
    const bytesRead = await Deno.stdin.read(buffer);
    
    if (bytesRead === null) {
      throw new Error("Failed to read from stdin");
    }

    return new TextDecoder().decode(buffer.subarray(0, bytesRead));
  }

  /**
   * Check if stdin is a TTY (terminal)
   */
  private isStdinTTY(): boolean {
    return Deno.stdin.isTerminal && Deno.stdin.isTerminal();
  }

  /**
   * Enter raw mode for character-by-character input
   */
  async enterRawMode(): Promise<void> {
    if (this.rawMode) return;
    
    if (!this.isStdinTTY()) {
      throw new Error("Cannot enter raw mode: stdin is not a TTY. tmax must be run in a terminal.");
    }
    
    try {
      Deno.stdin.setRaw(true);
      this.rawMode = true;
      await this.enterAlternateScreen();
      await this.hideCursor();
    } catch (error) {
      throw new Error(`Failed to enter raw mode: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Exit raw mode and restore normal terminal behavior
   */
  async exitRawMode(): Promise<void> {
    if (!this.rawMode) return;
    
    await this.showCursor();
    await this.exitAlternateScreen();
    Deno.stdin.setRaw(false);
    this.rawMode = false;
  }
}