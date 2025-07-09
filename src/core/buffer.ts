/**
 * @file buffer.ts
 * @description Buffer management implementation for tmax editor
 */

import type { TextBuffer, Position, Range } from "./types.ts";

/**
 * Gap buffer implementation for efficient text editing
 * Based on the data structure used by Emacs and other editors
 */
export class GapBuffer {
  private buffer: (string | undefined)[];
  private gapStart: number;
  private gapEnd: number;
  private readonly initialSize = 64;

  /**
   * Create a new gap buffer
   * @param initialContent - Optional initial content
   */
  constructor(initialContent = "") {
    this.buffer = new Array(this.initialSize);
    this.gapStart = 0;
    this.gapEnd = this.initialSize;
    
    if (initialContent) {
      this.insert(0, initialContent);
    }
  }

  /**
   * Get the length of the buffer content (excluding gap)
   * @returns Buffer length
   */
  length(): number {
    return this.buffer.length - (this.gapEnd - this.gapStart);
  }

  /**
   * Insert text at the specified position
   * @param position - Position to insert at
   * @param text - Text to insert
   */
  insert(position: number, text: string): void {
    this.moveGap(position);
    
    // Ensure gap is large enough
    if (text.length > this.gapEnd - this.gapStart) {
      this.growGap(text.length);
    }
    
    // Insert characters into gap
    for (let i = 0; i < text.length; i++) {
      this.buffer[this.gapStart + i] = text[i]!;
    }
    
    this.gapStart += text.length;
  }

  /**
   * Delete text at the specified position
   * @param position - Position to delete from
   * @param length - Number of characters to delete
   */
  delete(position: number, length: number): void {
    this.moveGap(position);
    
    // Expand gap to include deleted characters
    this.gapEnd = Math.min(this.gapEnd + length, this.buffer.length);
  }

  /**
   * Get character at position
   * @param position - Position to get character from
   * @returns Character at position
   */
  charAt(position: number): string {
    if (position < 0 || position >= this.length()) {
      throw new Error("Position out of bounds");
    }
    
    if (position < this.gapStart) {
      return this.buffer[position] || "";
    } else {
      return this.buffer[position + (this.gapEnd - this.gapStart)] || "";
    }
  }

  /**
   * Get substring from buffer
   * @param start - Start position
   * @param end - End position
   * @returns Substring
   */
  substring(start: number, end: number): string {
    let result = "";
    for (let i = start; i < end; i++) {
      result += this.charAt(i);
    }
    return result;
  }

  /**
   * Convert buffer to string
   * @returns String representation of buffer
   */
  toString(): string {
    return this.substring(0, this.length());
  }

  /**
   * Move gap to specified position
   * @param position - Target position for gap
   */
  private moveGap(position: number): void {
    if (position < this.gapStart) {
      // Move gap left
      const moveCount = this.gapStart - position;
      for (let i = 0; i < moveCount; i++) {
        this.buffer[this.gapEnd - 1 - i] = this.buffer[this.gapStart - 1 - i];
      }
      this.gapStart -= moveCount;
      this.gapEnd -= moveCount;
    } else if (position > this.gapStart) {
      // Move gap right
      const moveCount = position - this.gapStart;
      for (let i = 0; i < moveCount; i++) {
        this.buffer[this.gapStart + i] = this.buffer[this.gapEnd + i];
      }
      this.gapStart += moveCount;
      this.gapEnd += moveCount;
    }
  }

  /**
   * Grow gap to accommodate more text
   * @param minSize - Minimum size needed
   */
  private growGap(minSize: number): void {
    const newSize = Math.max(this.buffer.length * 2, this.buffer.length + minSize);
    const newBuffer = new Array(newSize);
    
    // Copy content before gap
    for (let i = 0; i < this.gapStart; i++) {
      newBuffer[i] = this.buffer[i];
    }
    
    // Copy content after gap
    const afterGapStart = newSize - (this.buffer.length - this.gapEnd);
    for (let i = this.gapEnd; i < this.buffer.length; i++) {
      newBuffer[afterGapStart + (i - this.gapEnd)] = this.buffer[i];
    }
    
    this.buffer = newBuffer;
    this.gapEnd = afterGapStart;
  }
}

/**
 * Text buffer implementation using gap buffer
 * Handles line-based operations and position/range conversions
 */
export class TextBufferImpl implements TextBuffer {
  private gapBuffer: GapBuffer;
  private lines: string[];

  /**
   * Create a new text buffer
   * @param content - Initial content
   */
  constructor(content = "") {
    this.gapBuffer = new GapBuffer(content);
    this.lines = this.splitLines(content);
  }

  /**
   * Get the entire buffer content
   * @returns Buffer content as string
   */
  getContent(): string {
    return this.gapBuffer.toString();
  }

  /**
   * Get content of a specific line
   * @param lineNumber - Line number (0-indexed)
   * @returns Line content
   */
  getLine(lineNumber: number): string {
    if (lineNumber < 0 || lineNumber >= this.lines.length) {
      throw new Error("Line number out of bounds");
    }
    return this.lines[lineNumber]!;
  }

  /**
   * Get number of lines in buffer
   * @returns Line count
   */
  getLineCount(): number {
    return this.lines.length;
  }

  /**
   * Insert text at position
   * @param position - Position to insert at
   * @param text - Text to insert
   */
  insert(position: Position, text: string): void {
    const offset = this.positionToOffset(position);
    this.gapBuffer.insert(offset, text);
    this.rebuildLines();
  }

  /**
   * Delete text in range
   * @param range - Range to delete
   */
  delete(range: Range): void {
    const startOffset = this.positionToOffset(range.start);
    const endOffset = this.positionToOffset(range.end);
    const length = endOffset - startOffset;
    
    this.gapBuffer.delete(startOffset, length);
    this.rebuildLines();
  }

  /**
   * Replace text in range
   * @param range - Range to replace
   * @param text - Replacement text
   */
  replace(range: Range, text: string): void {
    this.delete(range);
    this.insert(range.start, text);
  }

  /**
   * Get text in range
   * @param range - Range to get text from
   * @returns Text in range
   */
  getText(range: Range): string {
    const startOffset = this.positionToOffset(range.start);
    const endOffset = this.positionToOffset(range.end);
    return this.gapBuffer.substring(startOffset, endOffset);
  }

  /**
   * Get entire buffer content
   * @returns Complete buffer content
   */
  getCompleteContent(): string {
    return this.gapBuffer.toString();
  }

  /**
   * Convert position to buffer offset
   * @param position - Position to convert
   * @returns Buffer offset
   */
  private positionToOffset(position: Position): number {
    let offset = 0;
    
    // Add characters from previous lines
    for (let i = 0; i < position.line; i++) {
      offset += this.lines[i]!.length + 1; // +1 for newline
    }
    
    // Add characters from current line
    offset += Math.min(position.column, this.lines[position.line]?.length || 0);
    
    return offset;
  }

  /**
   * Split content into lines
   * @param content - Content to split
   * @returns Array of lines
   */
  private splitLines(content: string): string[] {
    if (!content) return [""];
    const lines = content.split("\n");
    return lines.length > 0 ? lines : [""];
  }

  /**
   * Rebuild lines array from gap buffer
   */
  private rebuildLines(): void {
    const content = this.gapBuffer.toString();
    this.lines = this.splitLines(content);
  }
}