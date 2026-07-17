/**
 * @file terminal.ts
 * @description Canonical terminal I/O runtime contract.
 *
 * This is the ONE canonical `TerminalIO` interface for the tmax editor
 * (CHORE-44 Change 9). The interface is promise-based: it is the shape used
 * by `Editor`, `TmaxServer`, Steep, and the test mocks. The internal engine
 * (`TerminalIOImpl` in `src/core/terminal.ts`) may compose `TaskEither`
 * helpers privately, but exposes only this promise contract publicly.
 *
 * The previous parallel TaskEither-returning terminal interface and its
 * wrapper class have been removed.
 */

import type { Position, TerminalSize } from "./primitives.ts";

/**
 * Canonical terminal I/O contract (promise-based).
 */
export interface TerminalIO {
  /** Get terminal dimensions. */
  getSize(): TerminalSize;

  /** Clear the terminal. */
  clear(): Promise<void>;

  /** Clear from cursor to end of line. */
  clearToEndOfLine(): Promise<void>;

  /** Move cursor to position. */
  moveCursor(position: Position): Promise<void>;

  /** Write text at current cursor position. */
  write(text: string): Promise<void>;

  /** Read a single key press. */
  readKey(): Promise<string>;

  /** Enter raw mode. */
  enterRawMode(): Promise<void>;

  /** Exit raw mode. */
  exitRawMode(): Promise<void>;

  /** Enter alternate screen buffer. */
  enterAlternateScreen(): Promise<void>;

  /** Exit alternate screen buffer. */
  exitAlternateScreen(): Promise<void>;

  /** Hide cursor. */
  hideCursor(): Promise<void>;

  /** Show cursor. */
  showCursor(): Promise<void>;
}
