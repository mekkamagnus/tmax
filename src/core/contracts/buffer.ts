/**
 * @file buffer.ts
 * @description Canonical persistent text buffer contract.
 *
 * This is the ONE canonical `TextBuffer` interface for the tmax editor
 * (CHORE-44 Change 9). Operations are synchronous, immutable, and return
 * `Either<BufferError, T>` so callers handle errors explicitly without
 * exceptions. The class implementing this contract is `TextBufferImpl`
 * in `src/core/buffer.ts`.
 */

import type { Either } from "../../utils/task-either.ts";
import type {
  Position,
  Range,
  BufferError,
} from "./primitives.ts";

/**
 * Canonical persistent text buffer.
 *
 * Invariants:
 *  - all operations return a fresh `TextBuffer` (or value) wrapped in `Either`;
 *  - the receiver is never mutated;
 *  - the gap-buffer algorithm and performance invariants are owned by
 *    `TextBufferImpl` and are preserved byte-for-byte from the prior
 *    Either-returning buffer semantics.
 */
export interface TextBuffer {
  /** Get the entire buffer content. */
  getContent(): Either<BufferError, string>;

  /** Get content of a specific line. */
  getLine(lineNumber: number): Either<BufferError, string>;

  /** Get number of lines in buffer. */
  getLineCount(): Either<BufferError, number>;

  /** Insert text at position (returns new buffer). */
  insert(position: Position, text: string): Either<BufferError, TextBuffer>;

  /** Delete text in range (returns new buffer). */
  delete(range: Range): Either<BufferError, TextBuffer>;

  /** Replace text in range (returns new buffer). */
  replace(range: Range, text: string): Either<BufferError, TextBuffer>;

  /** Get text in range. */
  getText(range: Range): Either<BufferError, string>;

  /** Get buffer statistics. */
  getStats(): Either<BufferError, { lines: number; characters: number; words: number }>;
}
