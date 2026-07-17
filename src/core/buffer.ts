/**
 * @file buffer.ts
 * @description Canonical persistent text buffer implementation using a gap buffer.
 *
 * The `TextBuffer` contract (Either-returning immutable operations) lives in
 * `./contracts/buffer.ts`; this module owns the gap-buffer algorithm and the
 * `TextBufferImpl` class that implements it.
 */

import type { Position, Range, BufferError } from "./contracts/primitives.ts";
import type { TextBuffer } from "./contracts/buffer.ts";
import { Either } from "../utils/task-either.ts";
import { DEFAULT_BUFFER_SIZE, BUFFER_GROWTH_FACTOR } from "../constants/buffer.ts";

/**
 * Re-export so existing `import { BufferError } from "./buffer.ts"` callers
 * keep compiling. The canonical home is `./contracts/primitives.ts`.
 */
export type { BufferError } from "./contracts/primitives.ts";

/**
 * Buffer operation result type.
 */
export type BufferResult<T> = Either<BufferError, T>;

/**
 * Immutable gap buffer implementation for functional text editing
 */
class GapBufferEngine {
  constructor(
    private readonly buffer: ReadonlyArray<string | undefined>,
    private readonly gapStart: number,
    private readonly gapEnd: number
  ) {}

  /**
   * Create a new gap buffer
   */
  static create(initialContent = ""): GapBufferEngine {
    // Calculate initial size - ensure it's large enough for content plus some gap space
    const minSize = initialContent.length + DEFAULT_BUFFER_SIZE;
    const initialSize = Math.max(DEFAULT_BUFFER_SIZE, minSize);
    const buffer = new Array(initialSize);

    if (initialContent) {
      for (let i = 0; i < initialContent.length; i++) {
        buffer[i] = initialContent[i];
      }
      return new GapBufferEngine(buffer, initialContent.length, initialSize);
    }

    return new GapBufferEngine(buffer, 0, initialSize);
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
  insert(position: number, text: string): Either<string, GapBufferEngine> {
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
  delete(position: number, length: number): Either<string, GapBufferEngine> {
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
    
    return Either.right(new GapBufferEngine(
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
    const beforeGap = this.buffer.slice(0, this.gapStart).join("");
    const afterGap = this.buffer.slice(this.gapEnd).join("");
    return Either.right(beforeGap + afterGap);
  }

  /**
   * Move gap to specified position (returns new buffer)
   */
  private moveGap(position: number): Either<string, GapBufferEngine> {
    if (position < 0 || position > this.length()) {
      return Either.left(`Gap move position ${position} is out of bounds`);
    }

    if (position === this.gapStart) {
      return Either.right(this);
    }

    // §1.3 (RFC-019): use slice() rather than spread — same immutable snapshot
    // semantics (new instance owns a distinct backing array; older instances
    // keep their original array), but avoids the iterator-protocol overhead of
    // [...this.buffer]. Still O(buffer capacity); the per-cell mutation below
    // only touches the moved region.
    const newBuffer = this.buffer.slice();
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

    return Either.right(new GapBufferEngine(newBuffer, newGapStart, newGapEnd));
  }

  /**
   * Grow gap to accommodate more text (returns new buffer)
   */
  private growGap(minSize: number): Either<string, GapBufferEngine> {
    const newSize = Math.max(this.buffer.length * BUFFER_GROWTH_FACTOR, this.buffer.length + minSize);
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
    
    return Either.right(new GapBufferEngine(newBuffer, this.gapStart, afterGapStart));
  }

  /**
   * Insert text into the gap (returns new buffer)
   */
  private insertIntoGap(text: string): Either<string, GapBufferEngine> {
    if (text.length > this.gapEnd - this.gapStart) {
      return Either.left("Gap is too small for insertion");
    }

    // §1.3 (RFC-019): slice() rather than spread — same snapshot semantics,
    // lower overhead. Still O(buffer capacity); only the inserted cells are
    // then mutated in place on the owned copy.
    const newBuffer = this.buffer.slice();

    // Insert characters into gap
    for (let i = 0; i < text.length; i++) {
      newBuffer[this.gapStart + i] = text[i];
    }
    
    return Either.right(new GapBufferEngine(
      newBuffer,
      this.gapStart + text.length,
      this.gapEnd
    ));
  }
}

/**
 * Functional text buffer implementation using gap buffer
 */
export class TextBufferImpl implements TextBuffer {
  constructor(
    private readonly gapBuffer: GapBufferEngine,
    private readonly lines: ReadonlyArray<string>,
    // §1.2 (RFC-019): prefix sums of line offsets. `cumulativeLineOffsets[L]`
    // is the byte offset of the start of line L in the flattened buffer text.
    // Makes `positionToOffset` O(1) instead of O(L).
    private readonly cumulativeLineOffsets: ReadonlyArray<number>
  ) {}

  /**
   * Create a new text buffer
   */
  static create(content = ""): TextBufferImpl {
    const gapBuffer = GapBufferEngine.create(content);
    const lines = TextBufferImpl.splitLines(content);
    const offsets = TextBufferImpl.computeOffsets(lines);
    return new TextBufferImpl(gapBuffer, lines, offsets);
  }

  /**
   * Compute cumulative line offsets from a lines array. Single source of truth
   * for the prefix-sum: offsets[L] = sum of (lines[i].length + 1) for i < L.
   */
  private static computeOffsets(lines: ReadonlyArray<string>): number[] {
    const offsets = new Array<number>(lines.length);
    let running = 0;
    for (let i = 0; i < lines.length; i++) {
      offsets[i] = running;
      running += lines[i]!.length + 1; // +1 for the newline separator
    }
    return offsets;
  }

  /**
   * Get the entire buffer content
   */
  getContent(): BufferResult<string> {
    return Either.right(this.lines.join("\n"));
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
   *
   * §1.1 (RFC-019): the previous implementation called `toString()` on the
   * whole gap buffer and re-split it on every edit. That rebuilt the entire
   * `lines` array even for a 1-char keystroke. The new path computes the
   * edited `lines` array incrementally: it rebuilds only the affected line
   * range and reuses the unchanged prefix/suffix by reference, then refreshes
   * `cumulativeLineOffsets` only from the first edited line onward.
   */
  insert(position: Position, text: string): BufferResult<TextBuffer> {
    const offsetResult = this.positionToOffset(position);
    if (Either.isLeft(offsetResult)) {
      return offsetResult;
    }

    const newGapBuffer = this.gapBuffer.insert(offsetResult.right, text);
    if (Either.isLeft(newGapBuffer)) {
      return Either.left(`Insert failed: ${newGapBuffer.left}`);
    }

    if (text.length === 0) {
      // No content change — keep offsets and lines identical, just hand back
      // a buffer that shares them with this instance.
      return Either.right(new TextBufferImpl(
        newGapBuffer.right,
        this.lines,
        this.cumulativeLineOffsets
      ));
    }

    // Rebuild only line `position.line`. The original line is split at the
    // clamped column; the inserted text fills the gap between prefix/suffix.
    const originalLine = this.lines[position.line] ?? "";
    const clampedColumn = Math.min(position.column, originalLine.length);
    const prefix = originalLine.slice(0, clampedColumn);
    const suffix = originalLine.slice(clampedColumn);

    const segments = TextBufferImpl.splitLines(text);
    let rebuilt: string[];
    if (segments.length === 1) {
      // Single-line insert: just one line is replaced.
      rebuilt = [prefix + segments[0]! + suffix];
    } else {
      // Multi-line insert: K newlines produce K+1 affected lines. The first
      // segment carries the original prefix; the last carries the suffix;
      // any middle segments are whole lines.
      rebuilt = new Array<string>(segments.length);
      rebuilt[0] = prefix + segments[0]!;
      for (let i = 1; i < segments.length - 1; i++) {
        rebuilt[i] = segments[i]!;
      }
      rebuilt[segments.length - 1] = segments[segments.length - 1]! + suffix;
    }

    const { lines: newLines, offsets: newOffsets } = TextBufferImpl.spliceLines(
      this.lines,
      this.cumulativeLineOffsets,
      position.line,
      position.line,
      rebuilt
    );
    return Either.right(new TextBufferImpl(newGapBuffer.right, newLines, newOffsets));
  }

  /**
   * Delete text in range (returns new buffer)
   *
   * §1.1 (RFC-019): same incremental-derivation strategy as `insert`. Only the
   * line range spanned by [range.start, range.end] is rebuilt; the prefix and
   * suffix line arrays are reused by reference.
   */
  delete(range: Range): BufferResult<TextBuffer> {
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

    // Zero-length deletes leave the line/offset caches unchanged. The gap
    // buffer still produced a new immutable instance, so wrap it with the
    // existing cache. `length <= 0` (negative length arises from invalid
    // ranges; the gap buffer already no-ops on those).
    if (length <= 0) {
      return Either.right(new TextBufferImpl(
        newGapBuffer.right,
        this.lines,
        this.cumulativeLineOffsets
      ));
    }

    const startLineIdx = range.start.line;
    const endLineIdx = range.end.line;
    const startLineText = this.lines[startLineIdx] ?? "";
    const startColumn = Math.min(range.start.column, startLineText.length);

    let rebuilt: string[];
    if (startLineIdx === endLineIdx) {
      // Same-line delete: drop [startColumn, endColumn) from the line.
      const endColumn = Math.min(range.end.column, startLineText.length);
      rebuilt = [startLineText.slice(0, startColumn) + startLineText.slice(endColumn)];
    } else {
      // Multi-line delete: collapse lines [startLineIdx, endLineIdx] into a
      // single line formed by joining the start-line prefix with the end-line
      // suffix. Intermediate lines are dropped entirely.
      const endLineText = this.lines[endLineIdx] ?? "";
      const endColumn = Math.min(range.end.column, endLineText.length);
      const prefix = startLineText.slice(0, startColumn);
      const suffix = endLineText.slice(endColumn);
      rebuilt = [prefix + suffix];
    }

    const { lines: newLines, offsets: newOffsets } = TextBufferImpl.spliceLines(
      this.lines,
      this.cumulativeLineOffsets,
      startLineIdx,
      endLineIdx,
      rebuilt
    );
    return Either.right(new TextBufferImpl(newGapBuffer.right, newLines, newOffsets));
  }

  /**
   * Splice a range of lines with new content, then refresh the prefix-sum
   * offsets from the first edited line onward. Used by both `insert` and
   * `delete`. Lines before `startReplace` are reused by reference; lines after
   * `endReplace` (inclusive) are reused by reference too. Only the edited
   * range is rebuilt, and only offsets from `startReplace` onward are
   * recomputed.
   */
  private static spliceLines(
    oldLines: ReadonlyArray<string>,
    oldOffsets: ReadonlyArray<number>,
    startReplace: number,
    endReplace: number,
    newMiddle: readonly string[]
  ): { lines: string[]; offsets: number[] } {
    const prefixCount = startReplace;
    const suffixCount = oldLines.length - (endReplace + 1);
    const newLineCount = prefixCount + newMiddle.length + suffixCount;

    const lines = new Array<string>(newLineCount);
    for (let i = 0; i < prefixCount; i++) lines[i] = oldLines[i]!;
    for (let i = 0; i < newMiddle.length; i++) lines[prefixCount + i] = newMiddle[i]!;
    for (let i = 0; i < suffixCount; i++) lines[prefixCount + newMiddle.length + i] = oldLines[endReplace + 1 + i]!;

    // Offsets: copy the unchanged prefix, then recompute every offset from
    // `startReplace` onward using the new lines array. The running
    // accumulator starts at 0 for line 0, or at `lastPrefixOffset +
    // lastPrefixLine.length + 1` for buffers with a non-empty prefix.
    const offsets = new Array<number>(newLineCount);
    let running = 0;
    if (prefixCount > 0) {
      for (let i = 0; i < prefixCount; i++) offsets[i] = oldOffsets[i]!;
      const lastPrefixIdx = prefixCount - 1;
      running = offsets[lastPrefixIdx]! + lines[lastPrefixIdx]!.length + 1;
    }
    for (let i = prefixCount; i < newLineCount; i++) {
      offsets[i] = running;
      running += lines[i]!.length + 1;
    }
    return { lines, offsets };
  }

  /**
   * Replace text in range (returns new buffer)
   */
  replace(range: Range, text: string): BufferResult<TextBuffer> {
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
   * Convert position to buffer offset. O(1) via the cumulative-line-offset cache.
   */
  private positionToOffset(position: Position): BufferResult<number> {
    if (position.line < 0 || position.line >= this.lines.length) {
      return Either.left(`Line ${position.line} is out of bounds (0-${this.lines.length - 1})`);
    }

    if (position.column < 0) {
      return Either.left(`Column ${position.column} cannot be negative`);
    }

    // §1.2 (RFC-019): prefix-sum lookup replaces the linear walk. The column
    // clamp behaviour is preserved exactly: columns past end-of-line resolve
    // to the line end, matching the previous implementation.
    const currentLine = this.lines[position.line]!;
    const column = Math.min(position.column, currentLine.length);
    return Either.right(this.cumulativeLineOffsets[position.line]! + column);
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
  fromContent: (content: string): BufferResult<TextBuffer> => {
    try {
      const buffer = TextBufferImpl.create(content);
      return Either.right(buffer);
    } catch (error) {
      return Either.left(`Failed to create buffer: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  /**
   * Get word at position
   */
  getWordAt: (buffer: TextBuffer, position: Position): BufferResult<string> => {
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
  findAll: (buffer: TextBuffer, searchText: string): BufferResult<Position[]> => {
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
  validate: (buffer: TextBuffer): BufferResult<{ valid: boolean; issues: string[] }> => {
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
