/**
 * @file ansi-parser.ts
 * @description ANSI escape-sequence parser — parses raw PTY output into a stream
 * of ScreenOp operations that the screen buffer applies. xterm-compatible subset.
 * @see SPEC-097 RFC-014A (shell-mode)
 */

import type { ScreenOp, SGRState } from "../core/screen-buffer.ts";

const defaultSGR = (): SGRState => ({
  fg: 0, bg: 0, bold: false, italic: false, underline: false, reverse: false,
  fgR: 0, fgG: 0, fgB: 0, bgR: 0, bgG: 0, bgB: 0,
});

// SGR color palette (16 basic + 216 cube + 24 grayscale = 256)
// Maps SGR color codes 30-37 (fg) / 40-47 (bg) to palette indices
const BASIC_COLORS = [0, 1, 2, 3, 4, 5, 6, 7]; // black, red, green, yellow, blue, magenta, cyan, white

/**
 * The ANSI parser. Feed it raw bytes via `feed()`; it calls the output callback
 * with ScreenOp operations. Handles incomplete sequences across chunks.
 *
 * Supports: CSI cursor movement (CUU/CUD/CUF/CUB/CUP/CHA), erase (ED/EL),
 * SGR colors/attributes (basic, 256-color, truecolor), scroll regions (DECSTBM),
 * scroll (SU/SD/IND/RI), alternate screen (?1049h/l), cursor visibility (?25h/l),
 * OSC window title (stripped), and plain text with newline/carriage-return.
 */
export class ANSIParser {
  private buffer = "";
  private outputCb: (op: ScreenOp) => void;
  private sgr = defaultSGR();

  constructor(outputCallback: (op: ScreenOp) => void) {
    this.outputCb = outputCallback;
  }

  /** Feed raw text from the PTY. Calls outputCallback for each parsed operation. */
  feed(data: string): void {
    this.buffer += data;
    this.processBuffer();
  }

  private processBuffer(): void {
    let i = 0;
    while (i < this.buffer.length) {
      // #202: iterate by CODE POINT, not UTF-16 unit — surrogate pairs
      // (emoji, CJK ext) were torn across two cells/writes, splitting the
      // glyph when a wrap intervened.
      const cp = this.buffer.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      const chLen = ch.length;

      if (ch === "\x1b") {
        // Escape sequence — try to parse it
        const consumed = this.tryParseEscape(this.buffer, i);
        if (consumed === 0) {
          // Incomplete sequence — wait for more data
          break;
        }
        i += consumed;
      } else if (ch === "\r") {
        // Carriage return — move cursor to column 0
        this.outputCb({ type: "cursorMove", row: -1, col: 0 }); // row -1 = current row
        i++;
      } else if (ch === "\n") {
        this.outputCb({ type: "newline" });
        i++;
      } else if (ch === "\b") {
        this.outputCb({ type: "cursorBack", n: 1 });
        i++;
      } else if (ch === "\t") {
        // Tab — advance to next 8-column tab stop
        this.outputCb({ type: "cursorForward", n: 8 });
        i++;
      } else if (ch >= " ") {
        // Printable character (possibly a full surrogate-pair code point)
        this.outputCb({ type: "write", char: ch });
        i += chLen;
      } else {
        // Other control char — skip
        i++;
      }
    }
    // Keep unparsed remainder
    this.buffer = this.buffer.slice(i);
  }

  /**
   * Try to parse an escape sequence starting at buffer[i].
   * Returns the number of characters consumed, or 0 if incomplete.
   */
  private tryParseEscape(buf: string, start: number): number {
    if (start + 1 >= buf.length) return 0; // need at least ESC + something

    const next = buf[start + 1]!;

    // CSI: ESC [
    if (next === "[") {
      return this.parseCSI(buf, start);
    }
    // OSC: ESC ]
    if (next === "]") {
      return this.parseOSC(buf, start);
    }
    // ESC c — reset
    if (next === "c") {
      this.sgr = defaultSGR();
      this.outputCb({ type: "eraseDisplay", mode: 2 });
      this.outputCb({ type: "cursorMove", row: 0, col: 0 });
      return 2;
    }
    // ESC M — reverse index (scroll down 1)
    if (next === "M") {
      this.outputCb({ type: "scrollDown", n: 1 });
      return 2;
    }
    // ESC D — index (scroll up 1 = line feed equivalent)
    if (next === "D") {
      this.outputCb({ type: "newline" });
      return 2;
    }
    // ESC E — next line
    if (next === "E") {
      this.outputCb({ type: "cursorMove", row: -1, col: 0 });
      this.outputCb({ type: "newline" });
      return 2;
    }
    // ESC 7 / ESC 8 — save/restore cursor (no-op for now, acknowledge)
    if (next === "7" || next === "8") return 2;
    // ESC ( B — designate charset (skip)
    if (next === "(" || next === ")") {
      if (start + 2 >= buf.length) return 0;
      return 3;
    }
    // ESC = / ESC > — keypad mode (skip)
    if (next === "=" || next === ">") return 2;

    // Unknown 2-byte escape — skip
    return 2;
  }

  /** Parse a CSI sequence: ESC [ params... final-byte */
  private parseCSI(buf: string, start: number): number {
    // Find the final byte ([\x40-\x7e])
    let i = start + 2; // skip ESC [
    let privateMarker = "";

    // Optional private marker (? < > =)
    if (i < buf.length && "?<=>".includes(buf[i]!)) {
      privateMarker = buf[i]!;
      i++;
    }

    const paramStart = i;
    // Parameters: digits and semicolons
    while (i < buf.length && /[\d;]/.test(buf[i]!)) i++;

    if (i >= buf.length) return 0; // incomplete

    const finalByte = buf[i]!;
    if (!/[\x40-\x7e]/.test(finalByte)) return i - start; // not a valid final byte

    const paramStr = buf.slice(paramStart, i);
    const params = paramStr.split(";").map((p) => parseInt(p) || 0);
    const consumed = i - start + 1;

    this.handleCSI(privateMarker, params, finalByte);
    return consumed;
  }

  /** Handle a parsed CSI sequence. */
  private handleCSI(priv: string, params: number[], final: string): void {
    if (priv === "?") {
      // Private mode set/reset
      this.handlePrivateMode(params, final);
      return;
    }

    switch (final) {
      // Cursor movement
      case "A": this.outputCb({ type: "cursorUp", n: params[0] || 1 }); break;
      case "B": this.outputCb({ type: "cursorDown", n: params[0] || 1 }); break;
      case "C": this.outputCb({ type: "cursorForward", n: params[0] || 1 }); break;
      case "D": this.outputCb({ type: "cursorBack", n: params[0] || 1 }); break;
      case "H": // CUP — cursor position
      case "f": // HVP — horizontal vertical position (same as CUP)
        this.outputCb({ type: "cursorMove", row: (params[0] || 1) - 1, col: (params[1] || 1) - 1 });
        break;
      case "G": // CHA — cursor horizontal absolute
        this.outputCb({ type: "cursorMove", row: -1, col: (params[0] || 1) - 1 });
        break;
      case "d": // VPA — vertical position absolute
        this.outputCb({ type: "cursorMove", row: (params[0] || 1) - 1, col: -1 });
        break;
      // Erase
      case "J": this.outputCb({ type: "eraseDisplay", mode: params[0] || 0 }); break;
      case "K": this.outputCb({ type: "eraseLine", mode: params[0] || 0 }); break;
      // Scroll
      case "S": this.outputCb({ type: "scrollUp", n: params[0] || 1 }); break;
      case "T": this.outputCb({ type: "scrollDown", n: params[0] || 1 }); break;
      case "r": // DECSTBM — set scroll region
        this.outputCb({ type: "setScrollRegion", top: (params[0] || 1) - 1, bottom: (params[1] || 24) - 1 });
        this.outputCb({ type: "cursorMove", row: 0, col: 0 });
        break;
      // SGR — colors/attributes
      case "m": this.handleSGR(params); break;
      // Others (no-op for now)
      case "h":
      case "l":
        // Standard mode set/reset (not private) — skip
        break;
      case "L": // Insert lines — approximate as scroll down
        this.outputCb({ type: "scrollDown", n: params[0] || 1 }); break;
      case "M": // Delete lines — approximate as scroll up
        this.outputCb({ type: "scrollUp", n: params[0] || 1 }); break;
      case "P": // Delete characters — approximate as erase
        this.outputCb({ type: "eraseLine", mode: 0 }); break;
      case "@": // Insert characters — skip
        break;
      case "n": // Device status report — skip
        break;
    }
  }

  /** Handle private mode set/reset (? h / ? l). */
  private handlePrivateMode(params: number[], final: string): void {
    if (final !== "h" && final !== "l") return;
    const enable = final === "h";
    for (const p of params) {
      switch (p) {
        case 25: this.outputCb({ type: "cursorVisible", visible: enable }); break;
        case 1049: // Alternate screen
        case 1047:
        case 1048:
          this.outputCb({ type: "altScreen", enable }); break;
        // Others (bracketed paste, mouse, etc.) — skip
      }
    }
  }

  /** Handle SGR (Select Graphic Rendition) — colors and attributes. */
  private handleSGR(params: number[]): void {
    if (params.length === 0) params = [0];
    const attrs: Partial<SGRState> = {};
    let i = 0;
    while (i < params.length) {
      const p = params[i]!;
      switch (p) {
        case 0: Object.assign(attrs, defaultSGR()); break;
        case 1: attrs.bold = true; break;
        case 3: attrs.italic = true; break;
        case 4: attrs.underline = true; break;
        case 7: attrs.reverse = true; break;
        case 22: attrs.bold = false; break;
        case 23: attrs.italic = false; break;
        case 24: attrs.underline = false; break;
        case 27: attrs.reverse = false; break;
        // Basic foreground colors (30-37)
        case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
          attrs.fg = BASIC_COLORS[p - 30]! + 1; break; // +1 so 0=default, 1-8=basic
        // Basic background colors (40-47)
        case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
          attrs.bg = BASIC_COLORS[p - 40]! + 1; break;
        case 39: attrs.fg = 0; break; // default fg
        case 49: attrs.bg = 0; break; // default bg
        // Bright foreground (90-97)
        case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97:
          attrs.fg = BASIC_COLORS[p - 90]! + 9; break;
        // Bright background (100-107)
        case 100: case 101: case 102: case 103: case 104: case 105: case 106: case 107:
          attrs.bg = BASIC_COLORS[p - 100]! + 9; break;
        // 256-color: 38;5;N or 48;5;N
        case 38:
          if (params[i + 1] === 5) { attrs.fg = params[i + 2]! + 1; i += 2; }
          else if (params[i + 1] === 2) { attrs.fg = -1; attrs.fgR = params[i + 2]!; attrs.fgG = params[i + 3]!; attrs.fgB = params[i + 4]!; i += 4; }
          break;
        case 48:
          if (params[i + 1] === 5) { attrs.bg = params[i + 2]! + 1; i += 2; }
          else if (params[i + 1] === 2) { attrs.bg = -1; attrs.bgR = params[i + 2]!; attrs.bgG = params[i + 3]!; attrs.bgB = params[i + 4]!; i += 4; }
          break;
      }
      i++;
    }
    Object.assign(this.sgr, attrs);
    this.outputCb({ type: "setSGR", attrs });
  }

  /** Parse OSC sequence: ESC ] ... BEL or ST. Returns consumed length or 0. */
  private parseOSC(buf: string, start: number): number {
    // OSC ends with BEL (\x07) or ST (ESC \)
    let i = start + 2;
    while (i < buf.length) {
      if (buf[i] === "\x07") return i - start + 1;
      if (buf[i] === "\x1b" && buf[i + 1] === "\\") return i - start + 2;
      i++;
    }
    return 0; // incomplete
  }
}
