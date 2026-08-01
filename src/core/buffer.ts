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
 * Immutable gap buffer implementation for functional text editing.
 *
 * Copy-on-write string-backed design (issue #43): the buffer content is held
 * as two immutable strings — `beforeGap` and `afterGap`. The implicit "gap"
 * sits at position `beforeGap.length`. Editing at the cursor (the common
 * case) only touches one string: `beforeGap += text` is O(text.length)
 * amortized because V8 builds a cons-string rather than copying the whole
 * string. Moving the gap shifts characters between the two strings, again
 * without touching the unchanged prefix/suffix of either. Each instance is
 * immutable; old engines are never mutated.
 */
class GapBufferEngine {
  constructor(
    private readonly beforeGap: string,
    private readonly afterGap: string,
  ) {}

  static create(initialContent = ""): GapBufferEngine {
    return new GapBufferEngine(initialContent, "");
  }

  length(): number {
    return this.beforeGap.length + this.afterGap.length;
  }

  insert(position: number, text: string): Either<string, GapBufferEngine> {
    if (position < 0 || position > this.length()) {
      return Either.left(`Insert position ${position} is out of bounds (0-${this.length()})`);
    }
    if (position !== this.beforeGap.length) {
      const moved = this.moveGap(position);
      if (Either.isLeft(moved)) return moved;
      return moved.right.insertIntoGap(text);
    }
    return this.insertIntoGap(text);
  }

  delete(position: number, length: number): Either<string, GapBufferEngine> {
    if (position < 0 || position >= this.length()) {
      return Either.left(`Delete position ${position} is out of bounds (0-${this.length() - 1})`);
    }
    if (length <= 0) return Either.right(this);
    // Move gap to position if needed
    if (position !== this.beforeGap.length) {
      const moved = this.moveGap(position);
      if (Either.isLeft(moved)) return moved;
      return moved.right.delete(position, length);
    }
    // Gap is at position — delete from afterGap
    const actualLength = Math.min(length, this.afterGap.length);
    return Either.right(new GapBufferEngine(this.beforeGap, this.afterGap.slice(actualLength)));
  }

  charAt(position: number): Either<string, string> {
    if (position < 0 || position >= this.length()) {
      return Either.left(`Position ${position} is out of bounds (0-${this.length() - 1})`);
    }
    if (position < this.beforeGap.length) {
      return Either.right(this.beforeGap[position] ?? "");
    }
    return Either.right(this.afterGap[position - this.beforeGap.length] ?? "");
  }

  substring(start: number, end: number): Either<string, string> {
    if (start < 0 || end < 0 || start > end || end > this.length()) {
      return Either.left(`Invalid substring range: ${start}-${end} (buffer length: ${this.length()})`);
    }
    const beforeLen = this.beforeGap.length;
    if (end <= beforeLen) {
      return Either.right(this.beforeGap.substring(start, end));
    }
    if (start >= beforeLen) {
      return Either.right(this.afterGap.substring(start - beforeLen, end - beforeLen));
    }
    // Cross-gap
    return Either.right(this.beforeGap.substring(start) + this.afterGap.substring(0, end - beforeLen));
  }

  toString(): Either<string, string> {
    // O(1) with V8 cons-strings (beforeGap + afterGap creates a rope, no copy)
    return Either.right(this.beforeGap + this.afterGap);
  }

  private moveGap(position: number): Either<string, GapBufferEngine> {
    const currentGapPos = this.beforeGap.length;
    if (position === currentGapPos) return Either.right(this);
    if (position < 0 || position > this.length()) {
      return Either.left(`Gap move position ${position} is out of bounds`);
    }
    if (position < currentGapPos) {
      // Move gap left: transfer chars from end of beforeGap to start of afterGap
      const newBefore = this.beforeGap.substring(0, position);
      const transferred = this.beforeGap.substring(position);
      return Either.right(new GapBufferEngine(newBefore, transferred + this.afterGap));
    } else {
      // Move gap right: transfer chars from start of afterGap to end of beforeGap
      const offset = position - currentGapPos;
      const transferred = this.afterGap.substring(0, offset);
      return Either.right(new GapBufferEngine(this.beforeGap + transferred, this.afterGap.substring(offset)));
    }
  }

  private insertIntoGap(text: string): Either<string, GapBufferEngine> {
    // Gap is always at beforeGap.length — just append. O(text.length) amortized.
    return Either.right(new GapBufferEngine(this.beforeGap + text, this.afterGap));
  }
}

/**
 * Functional text buffer implementation using gap buffer
 */
export class TextBufferImpl implements TextBuffer {
  /**
   * Splash text shown in *scratch* when the editor opens with no file.
   * Similar to vim's intro screen. Cleared on first keystroke (insert-handler
   * checks for this sentinel).
   */
  static readonly SPLASH_TEXT = [
    "  tmax — extensible terminal editor",
    "  T-Lisp at the core · zero dependencies · runs on Bun",
    "",
    "  i        Start typing (insert mode)",
    "  :e FILE  Open a file",
    "  :q       Quit",
    "  SPC ;    M-x command palette",
    "  :w       Save",
    "",
    "  Version 0.2.0 (Alpha)",
  ].join("\n");

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
