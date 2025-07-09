/**
 * @file terminal.ts
 * @description Mock terminal implementation for testing
 */

import type { TerminalIO } from "../../src/core/types.ts";

/**
 * Mock terminal implementation for testing
 */
export class MockTerminal implements TerminalIO {
  private output: string[] = [];
  private keyQueue: string[] = [];
  private isRawMode = false;

  /**
   * Read a single key from input
   * @returns Promise that resolves to the key pressed
   */
  async readKey(): Promise<string> {
    if (this.keyQueue.length > 0) {
      return this.keyQueue.shift()!;
    }
    
    // Return a default key if queue is empty
    return "q";
  }

  /**
   * Write text to the terminal
   * @param text - Text to write
   */
  async write(text: string): Promise<void> {
    this.output.push(text);
  }

  /**
   * Clear the terminal screen
   */
  async clear(): Promise<void> {
    this.output = [];
  }

  /**
   * Clear from cursor to end of line
   */
  async clearToEndOfLine(): Promise<void> {
    // Mock implementation
  }

  /**
   * Enter alternate screen buffer
   */
  async enterAlternateScreen(): Promise<void> {
    // Mock implementation
  }

  /**
   * Exit alternate screen buffer
   */
  async exitAlternateScreen(): Promise<void> {
    // Mock implementation
  }

  /**
   * Hide cursor
   */
  async hideCursor(): Promise<void> {
    // Mock implementation
  }

  /**
   * Show cursor
   */
  async showCursor(): Promise<void> {
    // Mock implementation
  }

  /**
   * Get terminal size
   * @returns Terminal dimensions
   */
  getSize(): { width: number; height: number } {
    return { width: 80, height: 24 };
  }

  /**
   * Move cursor to position
   * @param position - Position to move to
   */
  async moveCursor(position: { line: number; column: number }): Promise<void> {
    // Mock implementation - just store the position
  }

  /**
   * Enter raw mode
   */
  async enterRawMode(): Promise<void> {
    this.isRawMode = true;
  }

  /**
   * Exit raw mode
   */
  async exitRawMode(): Promise<void> {
    this.isRawMode = false;
  }

  // Test helper methods
  
  /**
   * Get all output written to the terminal
   * @returns Array of output strings
   */
  getOutput(): string[] {
    return [...this.output];
  }

  /**
   * Get all output as a single string
   * @returns Concatenated output
   */
  getOutputString(): string {
    return this.output.join("");
  }

  /**
   * Add keys to the input queue
   * @param keys - Keys to add to the queue
   */
  addKeysToQueue(keys: string[]): void {
    this.keyQueue.push(...keys);
  }

  /**
   * Clear the output buffer
   */
  clearOutput(): void {
    this.output = [];
  }

  /**
   * Check if terminal is in raw mode
   * @returns True if in raw mode
   */
  isInRawMode(): boolean {
    return this.isRawMode;
  }
}