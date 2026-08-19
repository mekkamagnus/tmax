/**
 * @file terminal-manager.ts
 * @description Manages PTY-backed terminal instances for shell-mode.
 * Each terminal = PTY (Bun.spawn terminal) + ANSI parser + screen buffer + scrollback.
 * @see SPEC-097 RFC-014A
 */

import { spawn, type PTYHandle } from "./pty.ts";
import { ScreenBuffer, type ScreenOp } from "./screen-buffer.ts";
import { ANSIParser } from "../syntax/ansi-parser.ts";
import { createScrollbackBuffer, addLine, getVisibleLines, type ScrollbackBufferState } from "./scrollback.ts";

/** A managed terminal instance (PTY + screen buffer + scrollback). */
export interface TerminalInstance {
  id: string;
  pty: PTYHandle;
  screen: ScreenBuffer;
  scrollback: ScrollbackBufferState;
  parser: ANSIParser;
  alive: boolean;
}

/**
 * Manages terminal instances. One per terminal window.
 * The editor creates one via createTerminal(), feeds keys via write(),
 * reads rendered output via getVisibleLines(), and destroys via destroy().
 */
export class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();

  /** Create a new terminal (spawns $SHELL in a PTY). Returns the terminal ID. */
  createTerminal(opts?: { cols?: number; rows?: number; cwd?: string }): string {
    // Security: use random ID (not predictable counter) + only spawn $SHELL
    // (no arbitrary command parameter) — see ADR-0195.
    const id = `term-${crypto.randomUUID().slice(0, 8)}`;
    const cols = opts?.cols ?? 80;
    const rows = opts?.rows ?? 24;

    const screen = new ScreenBuffer(rows, cols);
    const scrollback = createScrollbackBuffer(50000);

    // The ANSI parser writes parsed ops to the screen buffer
    const parser = new ANSIParser((op: ScreenOp) => {
      // Handle cursorMove with row=-1 (current row, from CR/CHA) or col=-1
      // (current col, from VPA). The screen buffer can't handle -1 values.
      if (op.type === "cursorMove") {
        screen.apply({
          type: "cursorMove",
          row: op.row === -1 ? screen.cursor.row : op.row,
          col: op.col === -1 ? screen.cursor.col : op.col,
        });
        return;
      }
      screen.apply(op);
    });

    // Security (#164 review): only spawn the user's $SHELL — no arbitrary command.
    // If a custom command is needed in future, gate behind an allowlist.
    const pty = spawn({
      cwd: opts?.cwd,
      cols,
      rows,
    });

    const instance: TerminalInstance = {
      id,
      pty,
      screen,
      scrollback,
      parser,
      alive: true,
    };

    // Wire PTY output → ANSI parser → screen buffer
    pty.onOutput((data: string) => {
      parser.feed(data);
      // Also feed scrollback (line-based history for search/scrollback view)
      const newLines = data.split("\n");
      for (const line of newLines) {
        if (line.trim()) addLine(scrollback, line);
      }
    });

    pty.onExit((_code) => {
      instance.alive = false;
    });

    this.terminals.set(id, instance);
    return id;
  }

  /** Write input to a terminal's PTY. */
  write(id: string, data: string): void {
    const term = this.terminals.get(id);
    if (term?.alive) term.pty.write(data);
  }

  /** Resize a terminal's PTY + screen buffer. */
  resize(id: string, cols: number, rows: number): void {
    const term = this.terminals.get(id);
    if (term?.alive) {
      term.pty.resize(cols, rows);
      term.screen.resize(rows, cols);
    }
  }

  /** Kill a terminal's process. */
  kill(id: string, signal?: string): void {
    const term = this.terminals.get(id);
    if (term) {
      term.pty.kill(signal);
      term.alive = false;
    }
  }

  /** Destroy a terminal (kill + cleanup). */
  destroy(id: string): void {
    const term = this.terminals.get(id);
    if (term) {
      if (term.alive) term.pty.kill();
      this.terminals.delete(id);
    }
  }

  /** Get a terminal instance. */
  get(id: string): TerminalInstance | undefined {
    return this.terminals.get(id);
  }

  /** Get visible screen lines as PLAIN text (T-Lisp/text consumers). */
  getVisibleLines(id: string): string[] {
    const term = this.terminals.get(id);
    if (!term) return [];
    const lines: string[] = [];
    for (let r = 0; r < term.screen.rows; r++) {
      lines.push(term.screen.getLine(r));
    }
    return lines;
  }

  /** #202: visible screen lines as ANSI-styled strings (the render path —
   *  colors survive exactly as the child program wrote them). */
  getVisibleStyledLines(id: string): string[] {
    const term = this.terminals.get(id);
    if (!term) return [];
    const lines: string[] = [];
    for (let r = 0; r < term.screen.rows; r++) {
      lines.push(term.screen.getStyledLine(r));
    }
    return lines;
  }

  /** Get scrollback lines (for terminal-normal mode scrollback view). */
  getScrollbackLines(id: string, offset: number, count: number): string[] {
    const term = this.terminals.get(id);
    if (!term) return [];
    return getVisibleLines(term.scrollback, count);
  }

  /** Check if a terminal is alive. */
  isAlive(id: string): boolean {
    const term = this.terminals.get(id);
    return term?.alive ?? false;
  }

  /** List all terminal IDs. */
  list(): string[] {
    return [...this.terminals.keys()];
  }

  /** Destroy all terminals (cleanup on shutdown). */
  destroyAll(): void {
    for (const id of this.terminals.keys()) {
      this.destroy(id);
    }
  }
}
