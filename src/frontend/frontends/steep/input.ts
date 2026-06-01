import type { KeyMsg } from "../types.ts";
import { splitInputForTlisp } from "../../render/input.ts";

type KeyHandler = (msg: KeyMsg) => void | Promise<void>;

const escapeSequenceMap: Record<string, KeyMsg> = {
  "\x1b[A": { key: "k", upArrow: true },
  "\x1b[B": { key: "j", downArrow: true },
  "\x1b[C": { key: "l", rightArrow: true },
  "\x1b[D": { key: "h", leftArrow: true },
  "\x1b[3~": { key: "\x7f", delete: true },
};

export class Input {
  private handler?: KeyHandler;
  private running = false;
  private previousRawMode?: boolean;

  onKey(handler: KeyHandler) {
    this.handler = handler;
  }

  start() {
    this.running = true;
    this.previousRawMode = process.stdin.isRaw ?? false;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.handleData);
  }

  stop() {
    this.running = false;
    process.stdin.off("data", this.handleData);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(this.previousRawMode ?? false);
    }
  }

  private handleData = (chunk: string) => {
    if (!this.running || !this.handler) return;

    const mapped = escapeSequenceMap[chunk];
    if (mapped) {
      void this.handler({ ...mapped, raw: chunk, escape: chunk.startsWith("\x1b") });
      return;
    }

    if (chunk === "\x03") {
      void this.handler({ key: "\x03", raw: chunk, ctrl: true });
      return;
    }

    if (chunk === "\x1b") {
      void this.handler({ key: "\x1b", raw: chunk, escape: true });
      return;
    }

    if (chunk === "\r" || chunk === "\n") {
      void this.handler({ key: "\n", raw: chunk, return: true });
      return;
    }

    if (chunk === "\x7f" || chunk === "\b") {
      void this.handler({ key: "\x7f", raw: chunk, backspace: true });
      return;
    }

    for (const key of splitInputForTlisp(chunk)) {
      void this.handler({ key, raw: key });
    }
  };
}
