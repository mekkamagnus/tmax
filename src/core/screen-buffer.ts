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
  | { type: "insertLines"; n: number }
  | { type: "deleteLines"; n: number }
  | { type: "deleteChars"; n: number }
  | { type: "insertChars"; n: number }
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

/** #202: code points that occupy two terminal columns (East-Asian Wide +
 *  Fullwidth ranges + emoji-presentation blocks). NOTE: mistyping NARROW is
 *  NOT harmless — it reintroduces the 1-column drift the continuation cell
 *  exists to prevent (verify-gate #202 retry 1: the transport-emoji gap
 *  mistyped 🚀 narrow). When in doubt for an emoji-adjacent block, include
 *  it — real terminals render these wide. */
export function isWideChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x1100 && cp <= 0x115f)      // Hangul Jamo
    || (cp >= 0x2e80 && cp <= 0xa4cf)        // CJK radicals..Yi
    || (cp >= 0xac00 && cp <= 0xd7a3)        // Hangul syllables
    || (cp >= 0xf900 && cp <= 0xfaff)        // CJK compat ideographs
    || (cp >= 0xfe30 && cp <= 0xfe6f)        // CJK compat forms
    || (cp >= 0xff00 && cp <= 0xff60)        // Fullwidth forms
    || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x1f300 && cp <= 0x1faff)      // ALL emoji blocks (incl. transport 🚀 + extended)
    || (cp >= 0x2b00 && cp <= 0x2bff)        // arrows/stars (emoji-presentation)
    || (cp >= 0x20000 && cp <= 0x3fffd);     // CJK ext B+
}

/** #202: the SGR parameter string reproducing a cell's attributes ("" =
 *  default — emits nothing). Stable ordering keeps run-dedup exact. */
function cellSGRCode(c: Cell): string {
  const parts: string[] = [];
  if (c.bold) parts.push("1");
  if (c.italic) parts.push("3");
  if (c.underline) parts.push("4");
  if (c.reverse) parts.push("7");
  // The parser stores palette colors +1-BIASED (0 = default; 1-256 = palette
  // index + 1) — decode with -1 when re-emitting (the #202 off-by-one that
  // rendered SGR 31 red as palette-2 green).
  if (c.fg === -1) parts.push(`38;2;${c.fgR ?? 0};${c.fgG ?? 0};${c.fgB ?? 0}`);
  else if (c.fg > 0) parts.push(`38;5;${c.fg - 1}`);
  if (c.bg === -1) parts.push(`48;2;${c.bgR ?? 0};${c.bgG ?? 0};${c.bgB ?? 0}`);
  else if (c.bg > 0) parts.push(`48;5;${c.bg - 1}`);
  return parts.join(";");
}

/** Create a blank cell. */
function blankCell(sgr: SGRState): Cell {
  // #202: RGB fields included — a truecolor background must paint blanks too
  // (pre-existing #164 gap: blanks dropped their RGB).
  return {
    char: " ", fg: sgr.fg, bg: sgr.bg,
    bold: sgr.bold, italic: sgr.italic, underline: sgr.underline, reverse: sgr.reverse,
    fgR: sgr.fgR, fgG: sgr.fgG, fgB: sgr.fgB,
    bgR: sgr.bgR, bgG: sgr.bgG, bgB: sgr.bgB,
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
      case "insertLines": this.insertLines(op.n); break;
      case "deleteLines": this.deleteLines(op.n); break;
      case "deleteChars": this.deleteChars(op.n); break;
      case "insertChars": this.insertChars(op.n); break;
      // #204: bottom === -1 means "last row" (DECSTBM with an omitted bottom
      // — the parser cannot know the row count).
      case "setScrollRegion":
        this.scrollRegion = { top: op.top, bottom: op.bottom === -1 ? this.rows - 1 : op.bottom };
        break;
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
      // #202: RGB fields — truecolor text was losing its color (#164 gap).
      fgR: this.sgr.fgR, fgG: this.sgr.fgG, fgB: this.sgr.fgB,
      bgR: this.sgr.bgR, bgG: this.sgr.bgG, bgB: this.sgr.bgB,
    };
    // #202 (gate): East-Asian-wide and emoji glyphs render 2 columns in a
    // real terminal — occupy the continuation cell too so columns after the
    // glyph align (pre-existing #164 drift; claude/codex UIs are wide-char
    // heavy, and the zsh prompt carries emoji).
    this.cursor.col++;
    // Continuation cell only when one FITS: a wide glyph at the LAST column
    // leaves cursor.col === cols with no continuation written — the row
    // never exceeds cols, and the next writeChar's `col >= cols` check
    // wraps to the next line (matching a real terminal's deferred wrap).
    if (isWideChar(char) && this.cursor.col < this.cols) {
      this.cells[this.cursor.row]![this.cursor.col] = blankCell(this.sgr);
      this.cursor.col++;
    }
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

  /** #204: IL — insert n blank lines AT THE CURSOR ROW, shifting lines from
   *  the cursor down to the scroll-region bottom DOWN by n (content above the
   *  cursor and below the region is untouched). */
  private insertLines(n: number): void {
    const top = this.cursor.row;
    const bottom = this.scrollRegion.bottom;
    if (top > bottom || top < this.scrollRegion.top) return;
    this.cursor.col = 0; // xterm: IL/DL move the cursor to column 1
    const count = Math.min(n, bottom - top + 1);
    const region = this.cells.slice(top, bottom + 1);
    const kept = region.slice(0, region.length - count);
    this.cells.splice(top, region.length,
      ...Array.from({ length: count }, () => blankLine(this.cols, this.sgr)),
      ...kept);
  }

  /** #204: DL — delete n lines AT THE CURSOR ROW, shifting lines below UP
   *  within the scroll region (blanks appear at the region bottom). */
  private deleteLines(n: number): void {
    const top = this.cursor.row;
    const bottom = this.scrollRegion.bottom;
    if (top > bottom || top < this.scrollRegion.top) return;
    this.cursor.col = 0; // xterm: IL/DL move the cursor to column 1
    const count = Math.min(n, bottom - top + 1);
    const region = this.cells.slice(top, bottom + 1);
    const kept = region.slice(count);
    this.cells.splice(top, region.length,
      ...kept,
      ...Array.from({ length: count }, () => blankLine(this.cols, this.sgr)));
  }

  /** #204: DCH — delete n cells AT THE CURSOR on the cursor's row; the rest
   *  of the line shifts LEFT, blanks pad the end. */
  private deleteChars(n: number): void {
    const row = this.cells[this.cursor.row];
    if (!row) return;
    const count = Math.min(n, this.cols - this.cursor.col);
    row.splice(this.cursor.col, count);
    while (row.length < this.cols) row.push(blankCell(this.sgr));
  }

  /** #204: ICH — insert n blank cells AT THE CURSOR; the rest of the line
   *  shifts RIGHT (cells pushed past the edge are lost). */
  private insertChars(n: number): void {
    const row = this.cells[this.cursor.row];
    if (!row) return;
    const count = Math.min(n, this.cols - this.cursor.col);
    const blanks = Array.from({ length: count }, () => blankCell(this.sgr));
    row.splice(this.cursor.col, 0, ...blanks);
    row.length = this.cols;
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

  /**
   * #202: the row as an ANSI-STYLED string — consecutive cells with equal
   * attributes emit one SGR prefix (deduped); an all-default row is plain
   * text. This is the color path the renderer consumes (getLine stays plain
   * for T-Lisp/text consumers).
   */
  getStyledLine(row: number): string {
    let cells = this.cells[row] ?? [];
    // Trim trailing fully-default BLANK cells — they are row padding, not
    // content (renderers position rows absolutely). A colored cell (e.g. a
    // full-row background) stops the trim.
    let end = cells.length;
    while (end > 0 && cells[end - 1]!.char === " " && cellSGRCode(cells[end - 1]!) === "") end--;
    cells = cells.slice(0, end);
    let out = "";
    let prev: string | null = null;
    for (const c of cells) {
      const code = cellSGRCode(c);
      if (code !== prev) {
        if (code === "") {
          // styled → default REQUIRES an explicit reset — emitting nothing
          // would let the previous style bleed over the plain text.
          // (prev === null: the line starts default — nothing to reset.)
          if (prev !== null) out += "\x1b[0m";
        } else {
          out += `\x1b[${code}m`;
        }
        prev = code;
      }
      out += c.char;
    }
    // Close any lingering style: ANSI state persists across writes, so a
    // styled row must not bleed into the next row or the status line.
    return prev === null || prev === "" ? out : out + "\x1b[0m";
  }

  /** Get scrollback lines (most recent first, up to count). */
  getScrollbackLines(offset: number, count: number): string[] {
    const start = Math.max(0, this.scrollback.length - offset - count);
    const end = Math.max(0, this.scrollback.length - offset);
    return this.scrollback.slice(start, end).map((line) => line.map((c) => c.char).join(""));
  }
}
