/**
 * @file types.ts
 * @description Core type definitions for tmax editor
 */

/**
 * Position in a text buffer
 */
export interface Position {
  line: number;
  column: number;
}

/**
 * Range of text in a buffer
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Text buffer interface
 */
export interface TextBuffer {
  /** Get the entire buffer content */
  getContent(): string;
  
  /** Get content of a specific line */
  getLine(lineNumber: number): string;
  
  /** Get number of lines in buffer */
  getLineCount(): number;
  
  /** Insert text at position */
  insert(position: Position, text: string): void;
  
  /** Delete text in range */
  delete(range: Range): void;
  
  /** Replace text in range */
  replace(range: Range, text: string): void;
  
  /** Get text in range */
  getText(range: Range): string;
}

/**
 * Terminal dimensions
 */
export interface TerminalSize {
  width: number;
  height: number;
}

/**
 * Terminal I/O interface
 */
export interface TerminalIO {
  /** Get terminal dimensions */
  getSize(): TerminalSize;
  
  /** Clear the terminal */
  clear(): Promise<void>;
  
  /** Clear from cursor to end of line */
  clearToEndOfLine(): Promise<void>;
  
  /** Move cursor to position */
  moveCursor(position: Position): Promise<void>;
  
  /** Write text at current cursor position */
  write(text: string): Promise<void>;
  
  /** Read a single key press */
  readKey(): Promise<string>;
  
  /** Enter raw mode */
  enterRawMode(): Promise<void>;
  
  /** Exit raw mode */
  exitRawMode(): Promise<void>;
  
  /** Enter alternate screen buffer */
  enterAlternateScreen(): Promise<void>;
  
  /** Exit alternate screen buffer */
  exitAlternateScreen(): Promise<void>;
  
  /** Hide cursor */
  hideCursor(): Promise<void>;
  
  /** Show cursor */
  showCursor(): Promise<void>;
}

/**
 * File stats interface
 */
export interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  modified: Date;
}

/**
 * File system operations interface
 */
export interface FileSystem {
  /** Read file contents */
  readFile(path: string): Promise<string>;
  
  /** Write file contents */
  writeFile(path: string, content: string): Promise<void>;
  
  /** Check if file exists */
  exists(path: string): Promise<boolean>;
  
  /** Get file stats */
  stat(path: string): Promise<FileStats>;
}