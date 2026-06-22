/**
 * @file keys.ts
 * @description Translate `<Esc>`, `<Enter>`, `<C-a>`, `<M-x>` … into
 *   protocol-compatible key tokens for the headless daemon path and into
 *   `tmux send-keys` dispatch tokens for the headed path.
 *
 * Two parallel tables, one per dispatch backend:
 *
 *   - HEADLESS: each token becomes the value the daemon's `keypress`
 *     JSON-RPC method expects. The server passes the value straight to
 *     `editor.handleKey()`, which normalizes single control bytes and
 *     semantic key names but does NOT tokenize ANSI CSI sequences — so
 *     arrow keys MUST be sent as their semantic names (`Up`, `Down`,
 *     `Left`, `Right`), not `\x1b[A`. The CLI's `--keys` consumer
 *     (`bin/tmaxclient` `parseKeySequence`) splits multi-byte sequences
 *     into per-byte keypresses, so the control library sends each token
 *     as its own JSON-RPC `keypress` call rather than concatenating.
 *   - HEADED:   each token becomes a `tmux send-keys` argument (e.g.
 *     `<Esc>` → `Escape`); plain literals are sent via `send-keys -l`.
 *
 * Unsupported `<S-...>` forms must fail parsing with position details rather
 * than being passed through silently — otherwise a typo silently sends garbage
 * to the daemon and a test passes for the wrong reason.
 */

import { Either } from '../../src/utils/task-either.ts';
import { TmaxUseError } from './errors.ts';

/** A single token of a parsed sequence, with backend-specific dispatch payloads. */
export interface KeyToken {
  /** The raw source slice, e.g. `<C-a>`, `i`, `<S-Up>`. */
  readonly source: string;
  /**
   * Value to send via the daemon `keypress` RPC (headless). Either a
   * single-character control byte/literal (`\x1b`, `i`, …) or a semantic
   * name (`Up`, `Down`, `Left`, `Right`, `S-Up`, `S-Tab`, …) that the
   * editor already binds.
   */
  readonly headless: string;
  /** `tmux send-keys` argument for headed dispatch (without `-l`). Plain literals use the `literal` field. */
  readonly tmuxName?: string;
  /** Plain literal value to send via `tmux send-keys -l` (headed). Mutually exclusive with `tmuxName`. */
  readonly tmuxLiteral?: string;
  /** Byte offset of `source` within the original sequence string. */
  readonly offset: number;
}

/** Parse a key sequence string into individual tokens. */
export function parseKeys(sequence: string): Either<TmaxUseError, KeyToken[]> {
  const tokens: KeyToken[] = [];
  let i = 0;
  while (i < sequence.length) {
    const ch = sequence[i]!;
    if (ch === '<') {
      const end = sequence.indexOf('>', i);
      if (end === -1) {
        return Either.left(TmaxUseError.keySendFailed(
          `unterminated '<' at offset ${i} in key sequence ${JSON.stringify(sequence)}`,
          sequence,
        ));
      }
      const name = sequence.substring(i + 1, end);
      const parsed = parseSpecial(name, i, sequence);
      if (Either.isLeft(parsed)) return parsed;
      tokens.push(parsed.right);
      i = end + 1;
      continue;
    }
    tokens.push({
      source: ch,
      headless: ch,
      tmuxLiteral: ch,
      offset: i,
    });
    i++;
  }
  return Either.right(tokens);
}

/**
 * Flatten parsed tokens into the list of key values the daemon `keypress`
 * JSON-RPC method expects. Each entry is sent as a separate keypress call so
 * multi-character values (e.g. `Up`, `S-Up`) are not split into per-byte
 * requests by `bin/tmaxclient`'s `parseKeySequence`.
 *
 * Meta letters (`<M-x>` → `\x1bx`) are split into TWO values — the ESC byte
 * then the bare letter — because the daemon dispatches each `keypress` value
 * as a separate input event. Sending `\x1bx` as one value would be parsed as
 * a single control sequence by the editor.
 */
export function headlessValues(tokens: readonly KeyToken[]): readonly string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.headless.length === 2 && t.headless[0] === ESC) {
      out.push(ESC, t.headless[1]!);
    } else {
      out.push(t.headless);
    }
  }
  return out;
}

/**
 * @deprecated Use {@link headlessValues} and dispatch each value as its own
 *   JSON-RPC `keypress` call. Concatenated byte strings only work for
 *   single-byte tokens (letters, control bytes); semantic key names
 *   (`Up`, `Down`, `S-Up`, …) MUST be sent individually.
 *
 * Kept for tests that assert byte-level compilation of single-character
 * sequences (`<C-a>` → `\x01`, `<Esc>` → `\x1b`, plain text).
 */
export function headlessBytes(tokens: readonly KeyToken[]): string {
  return tokens.map((t) => t.headless).join('');
}

/** Per-token tmux dispatch instruction: either a named key or a literal string. */
export type TmuxKey =
  | { readonly kind: 'named'; readonly value: string }
  | { readonly kind: 'literal'; readonly value: string };

/** Convert parsed tokens to tmux dispatch instructions. */
export function tmuxDispatch(tokens: readonly KeyToken[]): TmuxKey[] {
  return tokens.map((t) => {
    if (t.tmuxName !== undefined) return { kind: 'named', value: t.tmuxName } as TmuxKey;
    return { kind: 'literal', value: t.tmuxLiteral ?? t.source } as TmuxKey;
  });
}

// ---------------------------------------------------------------------------
// Special-key translation tables
// ---------------------------------------------------------------------------

interface SpecialMapping {
  headless: string;
  tmuxName?: string;
  tmuxLiteral?: string;
}

const ESC = '\x1b';

const HEADLESS_NAMED: Record<string, string> = {
  Esc: ESC,
  Escape: ESC,
  ESC: ESC,
  Enter: '\r',
  RET: '\r',
  Return: '\r',
  Tab: '\t',
  TAB: '\t',
  BS: '\x7f',
  Backspace: '\x7f',
  DEL: '\x7f',
  Space: ' ',
  SPC: ' ',
  // Semantic names — `editor.handleKey()` does not tokenize ANSI CSI sequences,
  // so arrows MUST be sent by name. Bindings live in src/tlisp/core/bindings/.
  Up: 'Up',
  Down: 'Down',
  Right: 'Right',
  Left: 'Left',
};

const TMUX_NAMED: Record<string, string> = {
  Esc: 'Escape',
  Escape: 'Escape',
  ESC: 'Escape',
  Enter: 'C-m',
  RET: 'C-m',
  Return: 'C-m',
  Tab: 'Tab',
  TAB: 'Tab',
  BS: 'BSpace',
  Backspace: 'BSpace',
  DEL: 'Delete',
  Space: 'Space',
  SPC: 'Space',
  Up: 'Up',
  Down: 'Down',
  Right: 'Right',
  Left: 'Left',
};

// Shifted arrow / tab sequences. Headless emits the semantic name the editor
// binds (`S-Up`, `S-Down`, `S-Left`, `S-Right`, `S-Tab`); tmux emits the
// corresponding `send-keys` token.
const SHIFT_HEADLESS: Record<string, string> = {
  Up: 'S-Up',
  Down: 'S-Down',
  Right: 'S-Right',
  Left: 'S-Left',
  Tab: 'S-Tab',
};

const SHIFT_TMUX: Record<string, string> = {
  Up: 'S-Up',
  Down: 'S-Down',
  Right: 'S-Right',
  Left: 'S-Left',
  Tab: 'BTab',
};

function parseSpecial(name: string, offset: number, full: string): Either<TmaxUseError, KeyToken> {
  const source = `<${name}>`;

  // 1. C-[ : both an Escape alias and the prefix of the control table.
  if (name === 'C-[') {
    return Either.right({ source, headless: ESC, tmuxName: 'Escape', offset });
  }
  // 2. C-m : Enter alias (also matches the generic control table below, but
  //    named tables take precedence for clarity).
  if (name === 'C-m') {
    return Either.right({ source, headless: '\r', tmuxName: 'C-m', offset });
  }
  if (name === 'C-i') {
    return Either.right({ source, headless: '\t', tmuxName: 'Tab', offset });
  }

  // 3. Plain named specials.
  if (name in HEADLESS_NAMED) {
    return Either.right({
      source,
      headless: HEADLESS_NAMED[name]!,
      tmuxName: TMUX_NAMED[name],
      offset,
    });
  }

  // 4. Control letter: <C-a> through <C-z>.
  const ctrl = /^C-([a-zA-Z])$/.exec(name);
  if (ctrl) {
    const letter = ctrl[1]!;
    const lower = letter.toLowerCase();
    const byte = String.fromCharCode(lower.charCodeAt(0) - 96);
    return Either.right({ source, headless: byte, tmuxName: `C-${lower}`, offset });
  }

  // 5. Meta letter: <M-x> → ESC + x. Preserve case for <M-X> → ESC + X.
  const meta = /^M-([a-zA-Z])$/.exec(name);
  if (meta) {
    const letter = meta[1]!;
    return Either.right({ source, headless: `${ESC}${letter}`, tmuxName: `M-${letter}`, offset });
  }

  // 6. Shift letter: <S-a> through <S-z> → uppercase literal.
  const shiftLetter = /^S-([a-zA-Z])$/.exec(name);
  if (shiftLetter) {
    const letter = shiftLetter[1]!;
    const upper = letter.toUpperCase();
    return Either.right({ source, headless: upper, tmuxLiteral: upper, offset });
  }

  // 7. Shifted arrow / tab.
  const shiftArrow = /^S-(Up|Down|Right|Left|Tab)$/.exec(name);
  if (shiftArrow) {
    const which = shiftArrow[1]!;
    return Either.right({
      source,
      headless: SHIFT_HEADLESS[which]!,
      tmuxName: SHIFT_TMUX[which]!,
      offset,
    });
  }

  // 8. Unknown <S-...> forms must fail (don't pass through).
  if (name.startsWith('S-')) {
    return Either.left(TmaxUseError.keySendFailed(
      `unsupported shift key <${name}> at offset ${offset} in ${JSON.stringify(full)}`,
      full,
    ));
  }

  // 9. Unknown <C-...> / <M-...> forms must fail too.
  if (name.startsWith('C-') || name.startsWith('M-')) {
    return Either.left(TmaxUseError.keySendFailed(
      `unsupported special key <${name}> at offset ${offset} in ${JSON.stringify(full)}`,
      full,
    ));
  }

  // 10. Fallback: bare <X> for an unknown name. Treat as a literal single char
  //     (lets users write `<x>` if they really need a literal `<x>` — rare but
  //     useful for non-printable testing).
  return Either.right({ source, headless: name, tmuxLiteral: name, offset });
}

/**
 * Convenience: parse + flatten to the list of headless keypress values. Each
 * returned string is one `keypress` JSON-RPC call. Use this for protocol-level
 * dispatch (single source of truth for what the daemon receives).
 */
export function compileHeadless(sequence: string): Either<TmaxUseError, readonly string[]> {
  const parsed = parseKeys(sequence);
  if (Either.isLeft(parsed)) return Either.left(parsed.left);
  return Either.right(headlessValues(parsed.right));
}
