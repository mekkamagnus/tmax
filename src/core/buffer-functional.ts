/**
 * @file buffer-functional.ts
 * @description Functional buffer operations using Either for tmax editor
 */

import type { Position, Range } from "./types.ts";
import { Either } from "../utils/task-either.ts";

/**
 * Buffer operation error types
 */
export type BufferError = string;

/**
 * Buffer operation result types
 */
export type BufferResult<T> = Either<BufferError, T>;

/**
 * Functional text buffer interface using Either
 */
export interface FunctionalTextBuffer {
  /** Get the entire buffer content */
  getContent(): BufferResult<string>;
  
  /** Get content of a specific line */
  getLine(lineNumber: number): BufferResult<string>;
  
  /** Get number of lines in buffer */
  getLineCount(): BufferResult<number>;
  
  /** Insert text at position */
  insert(position: Position, text: string): BufferResult<FunctionalTextBuffer>;
  
  /** Delete text in range */
  delete(range: Range): BufferResult<FunctionalTextBuffer>;
  
  /** Replace text in range */
  replace(range: Range, text: string): BufferResult<FunctionalTextBuffer>;
  
  /** Get text in range */
  getText(range: Range): BufferResult<string>;
  
  /** Get buffer statistics */
  getStats(): BufferResult<{ lines: number; characters: number; words: number }>;
}

/**
 * Immutable gap buffer implementation for functional text editing
 */
class FunctionalGapBuffer {
  constructor(
    private readonly buffer: ReadonlyArray<string | undefined>,
    private readonly gapStart: number,
    private readonly gapEnd: number
  ) {}

  /**
   * Create a new gap buffer
   */
  static create(initialContent = ""): FunctionalGapBuffer {
    const initialSize = 64;
    const buffer = new Array(initialSize);
    
    if (initialContent) {
      for (let i = 0; i < initialContent.length; i++) {
        buffer[i] = initialContent[i];
      }
      return new FunctionalGapBuffer(buffer, initialContent.length, initialSize);
    }
    
    return new FunctionalGapBuffer(buffer, 0, initialSize);
  }

  /**
   * Get the length of the buffer content (excluding gap)
   */
  length(): number {
    return this.buffer.length - (this.gapEnd - this.gapStart);
  }

  /**
   * Insert text at the specified position (returns new buffer)
   */
  insert(position: number, text: string): Either<string, FunctionalGapBuffer> {
    if (position < 0 || position > this.length()) {
      return Either.left(`Insert position ${position} is out of bounds (0-${this.length()})`);
    }

    const movedBuffer = this.moveGap(position);
    if (Either.isLeft(movedBuffer)) {
      return movedBuffer;
    }

    const buffer = movedBuffer.right;
    
    // Check if gap is large enough
    const gapSize = buffer.gapEnd - buffer.gapStart;
    if (text.length > gapSize) {
      const grownBuffer = buffer.growGap(text.length);
      if (Either.isLeft(grownBuffer)) {
        return grownBuffer;
      }
      return grownBuffer.right.insertIntoGap(text);
    }
    
    return buffer.insertIntoGap(text);
  }

  /**
   * Delete text at the specified position (returns new buffer)
   */
  delete(position: number, length: number): Either<string, FunctionalGapBuffer> {
    if (position < 0 || position >= this.length()) {
      return Either.left(`Delete position ${position} is out of bounds (0-${this.length() - 1})`);
    }
    
    if (length <= 0) {
      return Either.right(this);
    }

    const actualLength = Math.min(length, this.length() - position);
    const movedBuffer = this.moveGap(position);
    if (Either.isLeft(movedBuffer)) {
      return movedBuffer;
    }

    const buffer = movedBuffer.right;
    const newGapEnd = Math.min(buffer.gapEnd + actualLength, buffer.buffer.length);
    
    return Either.right(new FunctionalGapBuffer(
      buffer.buffer,
      buffer.gapStart,
      newGapEnd
    ));
  }

  /**
   * Get character at position
   */
  charAt(position: number): Either<string, string> {
    if (position < 0 || position >= this.length()) {
      return Either.left(`Position ${position} is out of bounds (0-${this.length() - 1})`);
    }
    
    if (position < this.gapStart) {
      return Either.right(this.buffer[position] || "");
    } else {
      const adjustedPosition = position + (this.gapEnd - this.gapStart);
      return Either.right(this.buffer[adjustedPosition] || "");
    }
  }

  /**
   * Get substring from buffer
   */
  substring(start: number, end: number): Either<string, string> {
    if (start < 0 || end < 0 || start > end || end > this.length()) {
      return Either.left(`Invalid substring range: ${start}-${end} (buffer length: ${this.length()})`);
    }

    let result = "";
    for (let i = start; i < end; i++) {
      const char = this.charAt(i);
      if (Either.isLeft(char)) {
        return char;
      }
      result += char.right;
    }
    return Either.right(result);
  }

  /**
   * Convert buffer to string
   */
  toString(): Either<string, string> {
    return this.substring(0, this.length());
  }

  /**
   * Move gap to specified position (returns new buffer)
   */
  private moveGap(position: number): Either<string, FunctionalGapBuffer> {
    if (position < 0 || position > this.length()) {
      return Either.left(`Gap move position ${position} is out of bounds`);
    }

    if (position === this.gapStart) {
      return Either.right(this);
    }

    const newBuffer = [...this.buffer];
    let newGapStart = this.gapStart;
    let newGapEnd = this.gapEnd;

    if (position < this.gapStart) {
      // Move gap left
      const moveCount = this.gapStart - position;
      for (let i = 0; i < moveCount; i++) {
        newBuffer[newGapEnd - 1 - i] = newBuffer[newGapStart - 1 - i];
        newBuffer[newGapStart - 1 - i] = undefined;
      }
      newGapStart -= moveCount;
      newGapEnd -= moveCount;
    } else if (position > this.gapStart) {
      // Move gap right
      const moveCount = position - this.gapStart;
      for (let i = 0; i < moveCount; i++) {
        newBuffer[newGapStart + i] = newBuffer[newGapEnd + i];
        newBuffer[newGapEnd + i] = undefined;
      }
      newGapStart += moveCount;
      newGapEnd += moveCount;
    }

    return Either.right(new FunctionalGapBuffer(newBuffer, newGapStart, newGapEnd));
  }

  /**
   * Grow gap to accommodate more text (returns new buffer)
   */
  private growGap(minSize: number): Either<string, FunctionalGapBuffer> {
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
    
    return Either.right(new FunctionalGapBuffer(newBuffer, this.gapStart, afterGapStart));
  }

  /**
   * Insert text into the gap (returns new buffer)
   */
  private insertIntoGap(text: string): Either<string, FunctionalGapBuffer> {
    if (text.length > this.gapEnd - this.gapStart) {
      return Either.left("Gap is too small for insertion");
    }

    const newBuffer = [...this.buffer];
    
    // Insert characters into gap
    for (let i = 0; i < text.length; i++) {
      newBuffer[this.gapStart + i] = text[i];
    }
    
    return Either.right(new FunctionalGapBuffer(
      newBuffer,
      this.gapStart + text.length,
      this.gapEnd
    ));
  }
}

/**
 * Functional text buffer implementation using gap buffer
 */
export class FunctionalTextBufferImpl implements FunctionalTextBuffer {
  constructor(
    private readonly gapBuffer: FunctionalGapBuffer,
    private readonly lines: ReadonlyArray<string>
  ) {}

  /**
   * Create a new text buffer
   */
  static create(content = ""): FunctionalTextBufferImpl {
    const gapBuffer = FunctionalGapBuffer.create(content);
    const lines = FunctionalTextBufferImpl.splitLines(content);
    return new FunctionalTextBufferImpl(gapBuffer, lines);
  }

  /**
   * Get the entire buffer content
   */
  getContent(): BufferResult<string> {
    return this.gapBuffer.toString();
  }

  /**
   * Get content of a specific line
   */
  getLine(lineNumber: number): BufferResult<string> {
    if (lineNumber < 0 || lineNumber >= this.lines.length) {
      return Either.left(`Line number ${lineNumber} is out of bounds (0-${this.lines.length - 1})`);
    }
    return Either.right(this.lines[lineNumber]!);
  }

  /**
   * Get number of lines in buffer
   */
  getLineCount(): BufferResult<number> {
    return Either.right(this.lines.length);
  }

  /**
   * Insert text at position (returns new buffer)
   */
  insert(position: Position, text: string): BufferResult<FunctionalTextBuffer> {
    const offsetResult = this.positionToOffset(position);
    if (Either.isLeft(offsetResult)) {
      return offsetResult;
    }

    const newGapBuffer = this.gapBuffer.insert(offsetResult.right, text);
    if (Either.isLeft(newGapBuffer)) {
      return Either.left(`Insert failed: ${newGapBuffer.left}`);
    }

    const contentResult = newGapBuffer.right.toString();
    if (Either.isLeft(contentResult)) {
      return contentResult;
    }

    const newLines = FunctionalTextBufferImpl.splitLines(contentResult.right);
    return Either.right(new FunctionalTextBufferImpl(newGapBuffer.right, newLines));
  }

  /**
   * Delete text in range (returns new buffer)
   */
  delete(range: Range): BufferResult<FunctionalTextBuffer> {
    const startOffsetResult = this.positionToOffset(range.start);
    if (Either.isLeft(startOffsetResult)) {
      return startOffsetResult;
    }

    const endOffsetResult = this.positionToOffset(range.end);
    if (Either.isLeft(endOffsetResult)) {
      return endOffsetResult;
    }

    const length = endOffsetResult.right - startOffsetResult.right;
    const newGapBuffer = this.gapBuffer.delete(startOffsetResult.right, length);
    if (Either.isLeft(newGapBuffer)) {
      return Either.left(`Delete failed: ${newGapBuffer.left}`);
    }

    const contentResult = newGapBuffer.right.toString();
    if (Either.isLeft(contentResult)) {
      return contentResult;
    }

    const newLines = FunctionalTextBufferImpl.splitLines(contentResult.right);
    return Either.right(new FunctionalTextBufferImpl(newGapBuffer.right, newLines));
  }

  /**
   * Replace text in range (returns new buffer)
   */
  replace(range: Range, text: string): BufferResult<FunctionalTextBuffer> {
    const deletedBuffer = this.delete(range);
    if (Either.isLeft(deletedBuffer)) {
      return deletedBuffer;
    }
    
    return deletedBuffer.right.insert(range.start, text);
  }

  /**
   * Get text in range
   */
  getText(range: Range): BufferResult<string> {
    const startOffsetResult = this.positionToOffset(range.start);
    if (Either.isLeft(startOffsetResult)) {
      return startOffsetResult;
    }

    const endOffsetResult = this.positionToOffset(range.end);
    if (Either.isLeft(endOffsetResult)) {
      return endOffsetResult;
    }

    return this.gapBuffer.substring(startOffsetResult.right, endOffsetResult.right);
  }

  /**
   * Get buffer statistics
   */
  getStats(): BufferResult<{ lines: number; characters: number; words: number }> {
    const contentResult = this.getContent();
    if (Either.isLeft(contentResult)) {
      return contentResult;
    }

    const content = contentResult.right;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    
    return Either.right({
      lines: this.lines.length,
      characters: content.length,
      words
    });
  }

  /**
   * Convert position to buffer offset
   */
  private positionToOffset(position: Position): BufferResult<number> {
    if (position.line < 0 || position.line >= this.lines.length) {
      return Either.left(`Line ${position.line} is out of bounds (0-${this.lines.length - 1})`);
    }

    if (position.column < 0) {
      return Either.left(`Column ${position.column} cannot be negative`);
    }

    let offset = 0;
    
    // Add characters from previous lines
    for (let i = 0; i < position.line; i++) {
      offset += this.lines[i]!.length + 1; // +1 for newline
    }
    
    // Add characters from current line
    const currentLine = this.lines[position.line]!;
    const column = Math.min(position.column, currentLine.length);
    offset += column;
    
    return Either.right(offset);
  }

  /**
   * Split content into lines
   */
  private static splitLines(content: string): ReadonlyArray<string> {
    if (!content) return [""];
    const lines = content.split("\n");
    return lines.length > 0 ? lines : [""];
  }
}

/**
 * Buffer utility functions using functional patterns
 */
export const BufferUtils = {
  /**
   * Create buffer from file content with validation
   */
  fromContent: (content: string): BufferResult<FunctionalTextBuffer> => {
    try {
      const buffer = FunctionalTextBufferImpl.create(content);
      return Either.right(buffer);
    } catch (error) {
      return Either.left(`Failed to create buffer: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  /**
   * Get word at position
   */
  getWordAt: (buffer: FunctionalTextBuffer, position: Position): BufferResult<string> => {
    const contentResult = buffer.getContent();
    if (Either.isLeft(contentResult)) {
      return contentResult;
    }

    const content = contentResult.right;
    const lines = content.split('\n');
    
    if (position.line >= lines.length) {
      return Either.left(`Line ${position.line} is out of bounds`);
    }

    const line = lines[position.line]!;
    if (position.column >= line.length) {
      return Either.right("");
    }

    // Find word boundaries
    const wordRegex = /\w+/g;
    let match;
    while ((match = wordRegex.exec(line)) !== null) {
      const start = match.index;
      const end = match.index + match[0]!.length;
      
      if (position.column >= start && position.column <= end) {
        return Either.right(match[0]!);
      }
    }

    return Either.right("");
  },

  /**
   * Find all occurrences of text
   */
  findAll: (buffer: FunctionalTextBuffer, searchText: string): BufferResult<Position[]> => {
    const contentResult = buffer.getContent();
    if (Either.isLeft(contentResult)) {
      return contentResult;
    }

    const content = contentResult.right;
    const lines = content.split('\n');
    const positions: Position[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      let columnIndex = 0;
      
      while (true) {
        const foundIndex = line.indexOf(searchText, columnIndex);
        if (foundIndex === -1) break;
        
        positions.push({ line: lineIndex, column: foundIndex });
        columnIndex = foundIndex + 1;
      }
    }

    return Either.right(positions);
  },

  /**
   * Validate buffer integrity
   */
  validate: (buffer: FunctionalTextBuffer): BufferResult<{ valid: boolean; issues: string[] }> => {
    const issues: string[] = [];

    // Check line count consistency
    const lineCountResult = buffer.getLineCount();
    if (Either.isLeft(lineCountResult)) {
      issues.push(`Line count error: ${lineCountResult.left}`);
    }

    // Check content accessibility
    const contentResult = buffer.getContent();
    if (Either.isLeft(contentResult)) {
      issues.push(`Content access error: ${contentResult.left}`);
    }

    // Check stats computation
    const statsResult = buffer.getStats();
    if (Either.isLeft(statsResult)) {
      issues.push(`Stats computation error: ${statsResult.left}`);
    }

    return Either.right({
      valid: issues.length === 0,
      issues
    });
  }
};