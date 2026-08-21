import type { KeyMsg } from "../frontend/frontends/types.ts";
import {
  tokenizeTerminalInput,
  type TerminalInputTokens,
} from "../frontend/render/input.ts";

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

/**
 * Serialize key-message dispatch onto a promise chain: each handler call runs
 * to completion before the next begins, both within one chunk and across
 * overlapping chunks (#195 / BUG-81). The terminal coalesces fast keystrokes
 * into a single stdin chunk ("SPC ;" arrives as " ;") — concurrent dispatch
 * let the second key read leader/prefix state (spacePressed) before the first
 * key's async handleKey had set it, so "SPC ;" fell through as bare ";".
 *
 * Handler contract: onKey handlers handle their own errors (SteepFrontend
 * catches EDITOR_QUIT_SIGNAL and render errors). The catch only keeps the
 * chain alive if that contract is violated — surfaced on stderr, never
 * silently swallowed.
 */
export const dispatchSerialized = (
  messages: readonly KeyMsg[],
  handler: KeyHandler,
  tail: Promise<void>,
): Promise<void> => {
  let queue = tail;
  for (const message of messages) {
    queue = queue
      .then(() => handler(message))
      .catch((error: unknown) => {
        console.error("input dispatch error:", error);
      });
  }
  return queue;
};

export class Input {
  private handler?: KeyHandler;
  private running = false;
  private previousRawMode?: boolean;
  private pendingInput = "";
  private dispatchTail: Promise<void> = Promise.resolve();

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

    // Ordering invariant: tokenizer state (pendingInput) is updated
    // synchronously here, while dispatch is chained asynchronously. This is
    // safe because tokenization is pure over (chunk, pending) — it never
    // re-enters the handler — so the next data event always tokenizes
    // against the complete residue of the last one. Keys already queued
    // still dispatch even if stop() runs mid-chain (running only gates NEW
    // chunks); handlers are expected to be no-op-safe during teardown.
    const result = tokenizeSteepInput(chunk, this.pendingInput);
    this.pendingInput = result.pending;
    this.dispatchTail = dispatchSerialized(result.messages, this.handler, this.dispatchTail);
  };
}
