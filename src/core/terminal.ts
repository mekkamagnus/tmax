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
    await Deno.stdout.write(new TextEncoder().encode("\x1b[K"));
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
    await Deno.stdout.write(new TextEncoder().encode(escapeSequence));
  }

  /**
   * Write text at current cursor position
   * @param text - Text to write
   */
  async write(text: string): Promise<void> {
    await Deno.stdout.write(new TextEncoder().encode(text));
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
   * Enter raw mode for character-by-character input
   */
  async enterRawMode(): Promise<void> {
    if (this.rawMode) return;
    
    Deno.stdin.setRaw(true);
    this.rawMode = true;
    await this.enterAlternateScreen();
    await this.hideCursor();
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