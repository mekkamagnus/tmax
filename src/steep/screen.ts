import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS } from "../constants/terminal.ts";
import type { TerminalDims } from "../frontend/frontends/types.ts";

export class Screen {
  enterAltScreen() {
    if (process.env.TMAX_TEST_MODE !== "true") {
      process.stdout.write("\x1b[?1049h");
    }
    this.clear();
  }

  exitAltScreen() {
    if (process.env.TMAX_TEST_MODE !== "true") {
      process.stdout.write("\x1b[?1049l");
    }
  }

  clear() {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  writeAt(row: number, col: number, text: string) {
    process.stdout.write(`\x1b[${row + 1};${col + 1}H${text}`);
  }

  moveTo(row: number, col: number) {
    process.stdout.write(`\x1b[${row + 1};${col + 1}H`);
  }

  hideCursor() {
    process.stdout.write("\x1b[?25l");
  }

  showCursor() {
    process.stdout.write("\x1b[?25h");
  }

  getDims(): TerminalDims {
    return {
      width: process.stdout.columns || DEFAULT_TERMINAL_COLS,
      height: process.stdout.rows || DEFAULT_TERMINAL_ROWS,
    };
  }

  onResize(callback: () => void): () => void {
    process.stdout.on("resize", callback);
    process.on("SIGWINCH", callback);

    return () => {
      process.stdout.off("resize", callback);
      process.off("SIGWINCH", callback);
    };
  }
}
