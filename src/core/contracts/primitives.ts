/**
 * @file primitives.ts
 * @description Canonical core primitive contracts shared across buffer,
 * terminal, filesystem, editor, and workspace contracts.
 *
 * These were previously interleaved with interface definitions in the
 * 777-line `src/core/types.ts`. They have no behavior and no dependencies.
 */

/**
 * Position in a text buffer (zero-indexed line and column).
 */
export interface Position {
  line: number;
  column: number;
}

/**
 * Half-open range of text in a buffer: `[start, end)`.
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Terminal dimensions in columns and rows.
 */
export interface TerminalSize {
  width: number;
  height: number;
}

/**
 * Filesystem stat payload returned by `FileSystem.stat`.
 */
export interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  modified: Date;
}

/**
 * String aliases used as error channels by the canonical contracts.
 * Kept here so callers can name the error type without importing the
 * contract that defines the operation.
 */
export type FileSystemError = string;
export type TerminalError = string;
export type BufferError = string;
