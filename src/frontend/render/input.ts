/**
 * Split batched input chunks from Ink into single-key events for T-Lisp.
 */
export const splitInputForTlisp = (input: string): string[] => Array.from(input);

const escapeSequenceMap: Readonly<Record<string, string>> = {
  // Arrows + navigation (CSI).
  "\x1b[A": "Up",
  "\x1b[B": "Down",
  "\x1b[C": "Right",
  "\x1b[D": "Left",
  "\x1b[5~": "PageUp",
  "\x1b[6~": "PageDown",
  "\x1b[3~": "\x7f",
  // Home / End (CSI + SS3 variants). #62 / BUG-50.
  "\x1b[H": "Home",
  "\x1b[F": "End",
  "\x1bOH": "Home",
  "\x1bOF": "End",
  // Ctrl-arrows (modifier 5).
  "\x1b[1;5A": "Ctrl-Up",
  "\x1b[1;5B": "Ctrl-Down",
  "\x1b[1;5C": "Ctrl-Right",
  "\x1b[1;5D": "Ctrl-Left",
  // Shift-arrows (modifier 2).
  "\x1b[1;2A": "Shift-Up",
  "\x1b[1;2B": "Shift-Down",
  "\x1b[1;2C": "Shift-Right",
  "\x1b[1;2D": "Shift-Left",
  // F-keys (F1-F4 SS3; F5-F12 CSI). #62 / BUG-50.
  "\x1bOP": "F1",
  "\x1bOQ": "F2",
  "\x1bOR": "F3",
  "\x1bOS": "F4",
  "\x1b[15~": "F5",
  "\x1b[17~": "F6",
  "\x1b[18~": "F7",
  "\x1b[19~": "F8",
  "\x1b[20~": "F9",
  "\x1b[21~": "F10",
  "\x1b[23~": "F11",
  "\x1b[24~": "F12",
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
