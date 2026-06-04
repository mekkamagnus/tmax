import type { KeyMsg } from "../types.ts";
import {
  tokenizeTerminalInput,
  type TerminalInputTokens,
} from "../../render/input.ts";

type KeyHandler = (msg: KeyMsg) => void | Promise<void>;

const toKeyMsg = (key: string): KeyMsg => {
  if (key === "\x03") return { key, raw: key, ctrl: true };
  if (key === "\x1b") return { key, raw: key, escape: true };
  if (key === "\n") return { key, raw: key, return: true };
  if (key === "\x7f") return { key, raw: key, backspace: true };
  return { key, raw: key };
};

export interface SteepInputTokens extends TerminalInputTokens {
  readonly messages: KeyMsg[];
}

/** Parse one Steep input chunk into normalized key messages. */
export const tokenizeSteepInput = (
  chunk: string,
  pending: string = "",
): SteepInputTokens => {
  const result = tokenizeTerminalInput(chunk, pending);
  return {
    ...result,
    messages: result.keys.map(toKeyMsg),
  };
};

export class Input {
  private handler?: KeyHandler;
  private running = false;
  private previousRawMode?: boolean;
  private pendingInput = "";

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
    this.pendingInput = "";
    process.stdin.off("data", this.handleData);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(this.previousRawMode ?? false);
    }
  }

  private handleData = (chunk: string) => {
    if (!this.running || !this.handler) return;

    const result = tokenizeSteepInput(chunk, this.pendingInput);
    this.pendingInput = result.pending;
    for (const message of result.messages) {
      void this.handler(message);
    }
  };
}
