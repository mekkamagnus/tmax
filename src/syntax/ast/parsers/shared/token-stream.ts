/**
 * @file token-stream.ts
 * @description CHORE-44 Change 11 AC11.4 — generic lookahead/advance/match/expect
 * mechanics for the native recursive-descent parsers.
 *
 * Each parser previously open-coded the same `peek/advance/match/expect/at/atEnd`
 * quartet over its own token array. This module factors that mechanic into a
 * minimal, generic `TokenStream<T>` parameterized by the language's own token
 * shape. It deliberately does NOT:
 *   - define a shared token enum (AC11.6 — each language keeps its own kinds),
 *   - prescribe how `start`/`end` are represented (some parsers use byte
 *     offsets, one uses `SourcePosition`; both fit because the stream only
 *     touches `text`/`kind` for matching),
 *   - introduce a grammar abstraction or parser combinator framework.
 *
 * The contract a parser must satisfy to use the stream:
 *   - `tokenKind(t)` returns a stringly-typed kind for `atKind` checks,
 *   - `tokenText(t)` returns the literal source text for `at`/`match`/`expect`,
 *   - `isEofToken(t)` returns true for the sentinel end-of-input token.
 *
 * Each language provides these three accessors; everything else (cursor,
 * one-token lookahead, optional `previous()`, advance-with-clamping) lives here.
 */

/**
 * Minimal generic token contract. Concrete parsers extend this with their own
 * fields (e.g. a `type` alias for `kind`, or `SourcePosition` bounds instead
 * of byte offsets). Only `kind` and `text` are required by the stream itself.
 */
export interface GenericToken {
  /** Stringly-typed discriminator — see each language's own token enum. */
  readonly kind: string;
  /** The literal source slice the token covers (used for `at`/`match`/`expect`). */
  readonly text: string;
}

/** Three pure accessors a language provides to adapt its tokens to the stream. */
export interface TokenAdapter<T extends GenericToken> {
  /** String kind for `atKind(...)` checks. Defaults to `t.kind`. */
  readonly kindOf?: (t: T) => string;
  /** Literal text for `at(...)`/`match(...)`/`expect(...)`. Defaults to `t.text`. */
  readonly textOf?: (t: T) => string;
  /** Recognize the end-of-input sentinel. Required (no default). */
  readonly isEof: (t: T) => boolean;
}

/**
 * Generic lookahead/advance/match/expect stream over a fixed token array.
 *
 * The stream holds a cursor; `peek()` returns the current token (clamped to
 * the last token so callers never see `undefined`), `advance()` returns the
 * current token and steps forward (clamped to the last index, matching every
 * prior parser's behavior). All matching helpers (`at`/`match`/`expect`/`atKind`)
 * operate on `peek()` and never advance past EOF.
 */
export class TokenStream<T extends GenericToken> {
  private readonly tokens: readonly T[];
  private readonly adapter: Required<TokenAdapter<T>>;
  private idx = 0;

  constructor(tokens: readonly T[], adapter: TokenAdapter<T>) {
    this.tokens = tokens;
    this.adapter = {
      kindOf: adapter.kindOf ?? ((t: T) => t.kind),
      textOf: adapter.textOf ?? ((t: T) => t.text),
      isEof: adapter.isEof,
    };
  }

  /** Current cursor position (0-based). Useful for backtracking via `reset`. */
  get position(): number {
    return this.idx;
  }

  /** Restore the cursor to a previously captured `position`. */
  reset(to: number): void {
    this.idx = to;
  }

  /** The token at the cursor; never advances. Always returns a non-undefined token. */
  peek(): T {
    return this.tokens[this.idx] ?? this.tokens[this.tokens.length - 1]!;
  }

  /** Lookahead by `n` tokens (default 1 = next token). Clamps to last token. */
  lookahead(n: number = 1): T {
    const at = this.idx + n;
    if (at < this.tokens.length) return this.tokens[at]!;
    return this.tokens[this.tokens.length - 1]!;
  }

  /** Literal text of the current token. */
  peekText(): string {
    return this.adapter.textOf(this.peek());
  }

  /** String kind of the current token. */
  peekKind(): string {
    return this.adapter.kindOf(this.peek());
  }

  /** Return the current token and step the cursor forward (clamped to last). */
  advance(): T {
    const tok = this.tokens[this.idx]!;
    if (this.idx < this.tokens.length - 1) this.idx++;
    return tok;
  }

  /** True iff the current token's text equals `text`. */
  at(text: string): boolean {
    return this.peekText() === text;
  }

  /** True iff the current token's kind equals `kind`. */
  atKind(kind: string): boolean {
    return this.peekKind() === kind;
  }

  /** True iff the current token is the end-of-input sentinel. */
  atEnd(): boolean {
    return this.adapter.isEof(this.peek());
  }

  /** If the current token's text equals `text`, advance and return it; else null. */
  match(text: string): T | null {
    if (this.peekText() === text) return this.advance();
    return null;
  }

  /** If the current token's kind equals `kind`, advance and return it; else null. */
  matchKind(kind: string): T | null {
    if (this.peekKind() === kind) return this.advance();
    return null;
  }

  /**
   * Require the current token to have text `text`, else throw with the message
   * produced by `makeError(actualToken)`. On success, advances and returns the token.
   * Mirrors the `expect` helper every parser carried.
   */
  expect(text: string, makeError: (actual: T) => Error): T {
    const tok = this.peek();
    if (this.adapter.textOf(tok) !== text) throw makeError(tok);
    return this.advance();
  }
}
