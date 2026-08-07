/**
 * @file screen-buffer.ts
 * @description Virtual terminal screen buffer — a grid of cells that the ANSI
 * parser writes to and the renderer reads from.
 * @see SPEC-097 RFC-014A (shell-mode)
 */

/** A single character cell with text attributes. */
export interface Cell {
  char: string;
  fg: number; // 0 = default, 1-255 = palette, -1 = truecolor (use fgR/G/B)
  bg: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  reverse: boolean;
  // Truecolor (24-bit) — used when fg/bg is -1
  fgR?: number; fgG?: number; fgB?: number;
  bgR?: number; bgG?: number; bgB?: number;
}

/** A complete screen line (row of cells). */
export type Line = Cell[];

/** Operations that the ANSI parser emits; the screen buffer applies them. */
export type ScreenOp =
  | { type: "write"; char: string }
  | { type: "newline" }
  | { type: "cursorMove"; row: number; col: number }
  | { type: "cursorUp"; n: number }
  | { type: "cursorDown"; n: number }
  | { type: "cursorForward"; n: number }
  | { type: "cursorBack"; n: number }
  | { type: "eraseDisplay"; mode: number } // 0=cursor-to-end, 1=start-to-cursor, 2=all
  | { type: "eraseLine"; mode: number }
  | { type: "setSGR"; attrs: Partial<SGRState> }
  | { type: "scrollUp"; n: number }
  | { type: "scrollDown"; n: number }
  | { type: "setScrollRegion"; top: number; bottom: number }
  | { type: "altScreen"; enable: boolean }
  | { type: "cursorVisible"; visible: boolean };

/** Current SGR (Select Graphic Rendition) state. */
export interface SGRState {
  fg: number; bg: number;
  bold: boolean; italic: boolean; underline: boolean; reverse: boolean;
  fgR: number; fgG: number; fgB: number;
  bgR: number; bgG: number; bgB: number;
}

/** Default SGR state (no attributes, default colors). */
const defaultSGR = (): SGRState => ({
  fg: 0, bg: 0, bold: false, italic: false, underline: false, reverse: false,
  fgR: 0, fgG: 0, fgB: 0, bgR: 0, bgG: 0, bgB: 0,
});

/** Create a blank cell. */
function blankCell(sgr: SGRState): Cell {
  return {
    char: " ", fg: sgr.fg, bg: sgr.bg,
    bold: sgr.bold, italic: sgr.italic, underline: sgr.underline, reverse: sgr.reverse,
  };
}

/** Create a blank line. */
function blankLine(width: number, sgr: SGRState): Line {
  return Array.from({ length: width }, () => blankCell(sgr));
}

/** Maximum scrollback lines retained. */
const MAX_SCROLLBACK = 10000;

/**
 * A virtual screen buffer: a `rows × cols` grid of cells with a cursor,
 * scroll region, alternate screen, and scrollback ring.
 */
export class ScreenBuffer {
  rows: number;
  cols: number;
  cells: Line[];
  cursor: { row: number; col: number; visible: boolean };
  scrollRegion: { top: number; bottom: number };
  sgr: SGRState = defaultSGR();
  scrollback: Line[] = [];

  private altBuffer: ScreenBuffer | null = null;
  private primaryBuffer: ScreenBuffer | null = null;

  constructor(rows: number = 24, cols: number = 80) {
    this.rows = rows;
    this.cols = cols;
    this.cells = Array.from({ length: rows }, () => blankLine(cols, defaultSGR()));
    this.cursor = { row: 0, col: 0, visible: true };
    this.scrollRegion = { top: 0, bottom: rows - 1 };
  }

  /** Apply a screen operation from the ANSI parser. */
  apply(op: ScreenOp): void {
    switch (op.type) {
      case "write": this.writeChar(op.char); break;
      case "newline": this.lineFeed(); break;
      case "cursorMove": this.cursor.row = Math.min(op.row, this.rows - 1); this.cursor.col = Math.min(op.col, this.cols - 1); break;
      case "cursorUp": this.cursor.row = Math.max(this.scrollRegion.top, this.cursor.row - op.n); break;
      case "cursorDown": this.cursor.row = Math.min(this.scrollRegion.bottom, this.cursor.row + op.n); break;
      case "cursorForward": this.cursor.col = Math.min(this.cols - 1, this.cursor.col + op.n); break;
      case "cursorBack": this.cursor.col = Math.max(0, this.cursor.col - op.n); break;
      case "eraseDisplay": this.eraseDisplay(op.mode); break;
      case "eraseLine": this.eraseLine(op.mode); break;
      case "setSGR": Object.assign(this.sgr, op.attrs); break;
      case "scrollUp": this.scrollUp(op.n); break;
      case "scrollDown": this.scrollDown(op.n); break;
      case "setScrollRegion": this.scrollRegion = { top: op.top, bottom: op.bottom }; break;
      case "altScreen": this.toggleAltScreen(op.enable); break;
      case "cursorVisible": this.cursor.visible = op.visible; break;
    }
  }

  /** Write a character at the cursor position and advance. */
  private writeChar(char: string): void {
    if (this.cursor.col >= this.cols) { this.lineFeed(); }
    if (this.cursor.row > this.scrollRegion.bottom) { this.scrollUp(1); this.cursor.row = this.scrollRegion.bottom; }
    this.cells[this.cursor.row]![this.cursor.col] = {
      char,
      fg: this.sgr.fg, bg: this.sgr.bg,
      bold: this.sgr.bold, italic: this.sgr.italic,
      underline: this.sgr.underline, reverse: this.sgr.reverse,
    };
    this.cursor.col++;
  }

  /** Line feed: move cursor down (scroll if at bottom of scroll region). */
  private lineFeed(): void {
    this.cursor.col = 0;
    if (this.cursor.row >= this.scrollRegion.bottom) {
      this.scrollUp(1);
    } else {
      this.cursor.row++;
    }
  }

  /** Scroll the scroll region up by n lines (content moves up, blank lines at bottom). */
  private scrollUp(n: number): void {
    const { top, bottom } = this.scrollRegion;
    for (let i = 0; i < n; i++) {
      // Push top line to scrollback (only if primary buffer + full screen region)
      if (top === 0 && bottom === this.rows - 1 && !this.altBuffer) {
        this.scrollback.push(this.cells[top]!);
        if (this.scrollback.length > MAX_SCROLLBACK) this.scrollback.shift();
      }
      // Shift lines up within the scroll region
      for (let r = top; r < bottom; r++) {
        this.cells[r] = this.cells[r + 1]!;
      }
      this.cells[bottom] = blankLine(this.cols, this.sgr);
    }
  }

  /** Scroll the scroll region down by n lines (content moves down, blank lines at top). */
  private scrollDown(n: number): void {
    const { top, bottom } = this.scrollRegion;
    for (let i = 0; i < n; i++) {
      for (let r = bottom; r > top; r--) {
        this.cells[r] = this.cells[r - 1]!;
      }
      this.cells[top] = blankLine(this.cols, this.sgr);
    }
  }

  /** Erase part or all of the display. */
  private eraseDisplay(mode: number): void {
    switch (mode) {
      case 0: // cursor to end of screen
        this.eraseLineFrom(this.cursor.row, this.cursor.col);
        for (let r = this.cursor.row + 1; r < this.rows; r++) this.cells[r] = blankLine(this.cols, this.sgr);
        break;
      case 1: // start of screen to cursor
        for (let r = 0; r < this.cursor.row; r++) this.cells[r] = blankLine(this.cols, this.sgr);
        this.eraseLineTo(this.cursor.row, this.cursor.col);
        break;
      case 2: // entire screen
      case 3: // entire screen + scrollback
        this.cells = Array.from({ length: this.rows }, () => blankLine(this.cols, this.sgr));
        if (mode === 3) this.scrollback = [];
        break;
    }
  }

  /** Erase part or all of the cursor's line. */
  private eraseLine(mode: number): void {
    switch (mode) {
      case 0: this.eraseLineFrom(this.cursor.row, this.cursor.col); break;
      case 1: this.eraseLineTo(this.cursor.row, this.cursor.col); break;
      case 2: this.cells[this.cursor.row] = blankLine(this.cols, this.sgr); break;
    }
  }

  private eraseLineFrom(row: number, col: number): void {
    for (let c = col; c < this.cols; c++) this.cells[row]![c] = blankCell(this.sgr);
  }
  private eraseLineTo(row: number, col: number): void {
    for (let c = 0; c <= col; c++) this.cells[row]![c] = blankCell(this.sgr);
  }

  /** Toggle alternate screen (vim/less use this for full-screen mode). */
  private toggleAltScreen(enable: boolean): void {
    if (enable && !this.altBuffer) {
      this.altBuffer = new ScreenBuffer(this.rows, this.cols);
      this.altBuffer.cells = this.cells;
      this.altBuffer.cursor = this.cursor;
      this.altBuffer.scrollRegion = this.scrollRegion;
      this.cells = Array.from({ length: this.rows }, () => blankLine(this.cols, defaultSGR()));
      this.cursor = { row: 0, col: 0, visible: true };
    } else if (!enable && this.altBuffer) {
      this.cells = this.altBuffer.cells;
      this.cursor = this.altBuffer.cursor;
      this.scrollRegion = this.altBuffer.scrollRegion;
      this.altBuffer = null;
    }
  }

  /** Resize the screen buffer (preserves content, truncates/pads). */
  resize(rows: number, cols: number): void {
    const oldCells = this.cells;
    this.rows = rows;
    this.cols = cols;
    this.cells = Array.from({ length: rows }, (_, r) => {
      const old = oldCells[r] ?? blankLine(cols, this.sgr);
      if (old.length >= cols) return old.slice(0, cols);
      return [...old, ...Array.from({ length: cols - old.length }, () => blankCell(this.sgr))];
    });
    this.scrollRegion = { top: 0, bottom: rows - 1 };
    this.cursor.row = Math.min(this.cursor.row, rows - 1);
    this.cursor.col = Math.min(this.cursor.col, cols - 1);
  }

  /** Get a line as a plain string (for rendering/testing). */
  getLine(row: number): string {
    return (this.cells[row] ?? []).map((c) => c.char).join("");
  }

  /** Get scrollback lines (most recent first, up to count). */
  getScrollbackLines(offset: number, count: number): string[] {
    const start = Math.max(0, this.scrollback.length - offset - count);
    const end = Math.max(0, this.scrollback.length - offset);
    return this.scrollback.slice(start, end).map((line) => line.map((c) => c.char).join(""));
  }
}
