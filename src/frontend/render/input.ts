/**
 * Split batched input chunks from Ink into single-key events for T-Lisp.
 */
export const splitInputForTlisp = (input: string): string[] => Array.from(input);

const escapeSequenceMap: Readonly<Record<string, string>> = {
  "\x1b[A": "Up",
  "\x1b[B": "Down",
  "\x1b[C": "Right",
  "\x1b[D": "Left",
  "\x1b[5~": "PageUp",
  "\x1b[6~": "PageDown",
  "\x1b[3~": "\x7f",
};

export interface TerminalInputTokens {
  readonly keys: string[];
  readonly pending: string;
}

/**
 * Tokenize a terminal input chunk into editor keys while retaining an
 * incomplete escape sequence for the next chunk.
 */
export const tokenizeTerminalInput = (
  chunk: string,
  pending: string = "",
): TerminalInputTokens => {
  const input = pending + chunk;
  const keys: string[] = [];
  let index = 0;

  while (index < input.length) {
    const remaining = input.slice(index);
    const sequence = Object.keys(escapeSequenceMap).find(candidate =>
      remaining.startsWith(candidate)
    );
    if (sequence) {
      keys.push(escapeSequenceMap[sequence]!);
      index += sequence.length;
      continue;
    }

    if (
      remaining.length > 1 &&
      Object.keys(escapeSequenceMap).some(candidate => candidate.startsWith(remaining))
    ) {
      return { keys, pending: remaining };
    }

    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) break;
    const key = String.fromCodePoint(codePoint);
    index += key.length;

    if (key === "\r" || key === "\n") {
      keys.push("\n");
    } else if (key === "\b" || key === "\x7f") {
      keys.push("\x7f");
    } else {
      keys.push(key);
    }
  }

  return { keys, pending: "" };
};
