/**
 * @file frame.ts
 * @description Frame — the editor control API. Each method returns a TaskEither
 *   so failures compose with the rest of the control library.
 *
 * Wraps:
 *   - `bin/tmaxclient --keys` and `--eval` for input/eval (via `TmaxClient`)
 *   - the daemon's `capture` JSON-RPC for ANSI/HTML/plain capture (preserves
 *     `width` and `height`, unlike the CLI flags)
 *   - T-Lisp state queries: mode, cursor, buffer text, buffer name, status line
 *
 * Wait helpers poll the daemon state until a predicate holds or the timeout
 * fires (modeled as a retry loop).
 */

import { TaskEither, Either } from '../../src/utils/task-either.ts';
import { TmaxUseError, leftT, rightT, rightE } from './errors.ts';
import { TmaxClient } from './client.ts';
import * as keyParser from './keys.ts';
import * as captureMod from './capture.ts';
import type { CaptureClient, CaptureResult, HtmlResult, CaptureOptions } from './capture.ts';

// Re-export types so consumers can `import type { CaptureResult } from "../src/frame"`.
export type { CaptureResult, HtmlResult, CaptureOptions } from './capture.ts';

export interface CursorPosition {
  readonly line: number;
  readonly col: number;
}

export interface FrameOptions {
  /** Label used in reporter output (defaults to `frame`). */
  readonly name?: string;
  /** Maximum wait iterations for `waitFor*` helpers (each iteration is ~100ms). */
  readonly waitIterations?: number;
  /** Default capture dimensions; per-call `opts` overrides. */
  readonly width?: number;
  readonly height?: number;
}

const DEFAULT_WAIT_ITERATIONS = 50; // 50 × 100ms = 5s default.

/**
 * Frame binds a name + a control surface to a daemon client. Multiple frames
 * may share one client (one daemon); they're stateless wrappers.
 */
export class Frame {
  readonly name: string;
  private readonly waitIterations: number;
  private readonly defaultWidth: number | undefined;
  private readonly defaultHeight: number | undefined;

  constructor(
    private readonly client: TmaxClient,
    nameOrOpts?: string | FrameOptions,
    maybeOpts?: FrameOptions,
  ) {
    if (typeof nameOrOpts === 'string') {
      this.name = nameOrOpts;
      this.waitIterations = maybeOpts?.waitIterations ?? DEFAULT_WAIT_ITERATIONS;
      this.defaultWidth = maybeOpts?.width;
      this.defaultHeight = maybeOpts?.height;
    } else {
      this.name = nameOrOpts?.name ?? 'frame';
      this.waitIterations = nameOrOpts?.waitIterations ?? DEFAULT_WAIT_ITERATIONS;
      this.defaultWidth = nameOrOpts?.width;
      this.defaultHeight = nameOrOpts?.height;
    }
  }

  /** Resolve capture opts by merging frame defaults with per-call overrides. */
  private captureOpts(opts?: CaptureOptions): CaptureOptions {
    return {
      width: opts?.width ?? this.defaultWidth,
      height: opts?.height ?? this.defaultHeight,
    };
  }

  // --- File ops -----------------------------------------------------------

  /** Open a file in the daemon's current buffer (CLI parity via positional arg). */
  openFile(path: string): TaskEither<TmaxUseError, void> {
    return this.client.open(path);
  }

  /** Kill the current buffer (`(kill-buffer)`). */
  closeBuffer(): TaskEither<TmaxUseError, void> {
    return this.client.eval('(kill-buffer)').map(() => undefined);
  }

  // --- Input --------------------------------------------------------------

  /**
   * Parse and send a key sequence. Special syntax is translated via
   * `parseKeys` (`<Esc>`, `<C-a>`, `<M-x>`, …). Each parsed token is sent
   * as its own `keypress` JSON-RPC call so semantic names like `Up`,
   * `Down`, `Left`, `Right`, `S-Up` reach the editor intact (the CLI's
   * `--keys` consumer would split multi-byte sequences into per-byte
   * keypresses and break arrow bindings).
   */
  keys(sequence: string): TaskEither<TmaxUseError, void> {
    return TaskEither.from(async () => {
      const compiled = keyParser.compileHeadless(sequence);
      if (Either.isLeft(compiled)) return compiled;
      return rightE(compiled.right);
    }).flatMap((values) => this.client.keys(values));
  }

  /**
   * Evaluate a T-Lisp expression (NOT JavaScript `eval`). The expression is
   * shipped to the daemon's T-Lisp interpreter via JSON-RPC; this is the same
   * trusted surface `bin/tmaxclient --eval` exposes.
   */
  eval(expr: string): TaskEither<TmaxUseError, string> {
    return this.client.eval(expr);
  }

  // --- State queries ------------------------------------------------------

  /** `(editor-mode)` — major mode name. */
  mode(): TaskEither<TmaxUseError, string> {
    return this.client.eval('(editor-mode)');
  }

  /** `(major-mode-get)` — major mode name (alias of mode()). */
  majorMode(): TaskEither<TmaxUseError, string> {
    return this.client.eval('(major-mode-get)');
  }

  /** Cursor position as `{ line, col }`. */
  cursor(): TaskEither<TmaxUseError, CursorPosition> {
    return this.client.eval('(cursor-line)').flatMap((lineStr) =>
      this.client.eval('(cursor-column)').flatMap((colStr) => {
        const line = Number.parseInt(lineStr.trim(), 10);
        const col = Number.parseInt(colStr.trim(), 10);
        if (!Number.isInteger(line) || !Number.isInteger(col)) {
          return leftT<CursorPosition>(
            TmaxUseError.assertionFailed(
              `cursor position not numeric: line=${JSON.stringify(lineStr)}, col=${JSON.stringify(colStr)}`,
            ),
          );
        }
        return rightT<CursorPosition>({ line, col });
      }),
    );
  }

  /** Full buffer text. */
  bufferText(): TaskEither<TmaxUseError, string> {
    return this.client.eval('(buffer-text)');
  }

  /** Name of the current buffer. */
  bufferName(): TaskEither<TmaxUseError, string> {
    return this.client.eval('(buffer-name)');
  }

  /** Status line / editor status text. */
  statusLine(): TaskEither<TmaxUseError, string> {
    return this.client.eval('(editor-status)');
  }

  // --- Capture ------------------------------------------------------------

  /** Capture the rendered frame as ANSI lines + dimensions. */
  capture(opts?: CaptureOptions): TaskEither<TmaxUseError, CaptureResult> {
    return captureMod.captureFrame(this.client as unknown as CaptureClient, this.captureOpts(opts));
  }

  /** Capture the rendered frame as a standalone HTML document + dimensions. */
  captureHtml(opts?: CaptureOptions): TaskEither<TmaxUseError, HtmlResult> {
    return captureMod.captureHtml(this.client as unknown as CaptureClient, this.captureOpts(opts));
  }

  /** Capture plain (ANSI-stripped) lines for substring matching. */
  capturePlain(opts?: CaptureOptions): TaskEither<TmaxUseError, string[]> {
    return captureMod.captureFrame(this.client as unknown as CaptureClient, this.captureOpts(opts)).map((r) =>
      captureMod.capturePlain(r.lines),
    );
  }

  // --- Wait helpers -------------------------------------------------------

  /** Poll `(editor-mode)` until it equals `expected` or timeout. */
  waitForMode(expected: string, iterations = this.waitIterations): TaskEither<TmaxUseError, void> {
    return waitFor(iterations, () =>
      this.mode().flatMap((m) =>
        m === expected
          ? rightT<void>(undefined)
          : leftT<void>(TmaxUseError.timeout(iterations * 100, `mode === ${JSON.stringify(expected)} (last seen: ${JSON.stringify(m)})`)),
      ),
    );
  }

  /**
   * Poll until any capture plain line contains `text` or timeout. The render
   * pipeline is asynchronous; `waitForRender(text)` is the deterministic way to
   * confirm a UI change actually painted.
   */
  waitForTextContains(text: string, iterations = this.waitIterations): TaskEither<TmaxUseError, void> {
    return waitFor(iterations, () =>
      this.capturePlain().flatMap((lines) =>
        lines.some((l) => l.includes(text))
          ? rightT<void>(undefined)
          : leftT<void>(TmaxUseError.timeout(iterations * 100, `screen to contain ${JSON.stringify(text)}`)),
      ),
    );
  }

  /** Poll until a capture returns at least one non-empty line. */
  waitForRender(iterations = this.waitIterations): TaskEither<TmaxUseError, CaptureResult> {
    return waitForResult<CaptureResult>(iterations, () =>
      this.capture().flatMap((r) =>
        r.lines.some((l) => l.replace(/\s/g, '').length > 0)
          ? rightT<CaptureResult>(r)
          : leftT<CaptureResult>(TmaxUseError.timeout(iterations * 100, 'non-empty render')),
      ),
    );
  }
}

/**
 * Poll a TaskEither-producing predicate. Returns Right(undefined) as soon as it
 * succeeds, otherwise retries up to `iterations` × 100ms. Surfaces the last
 * error as a `Timeout`.
 */
function waitFor(
  iterations: number,
  attempt: () => TaskEither<TmaxUseError, void>,
): TaskEither<TmaxUseError, void> {
  return TaskEither.from(async () => {
    let last: TmaxUseError | null = null;
    for (let i = 0; i < iterations; i++) {
      const r = await attempt().run();
      if (Either.isRight(r)) return r;
      last = r.left;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return Either.left<TmaxUseError, void>(last ?? TmaxUseError.timeout(iterations * 100, 'unknown condition'));
  });
}

/** Variant of `waitFor` that carries the predicate's Right value out. */
function waitForResult<T>(
  iterations: number,
  attempt: () => TaskEither<TmaxUseError, T>,
): TaskEither<TmaxUseError, T> {
  return TaskEither.from(async () => {
    let last: TmaxUseError | null = null;
    for (let i = 0; i < iterations; i++) {
      const r = await attempt().run();
      if (Either.isRight(r)) return r;
      last = r.left;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return Either.left<TmaxUseError, T>(last ?? TmaxUseError.timeout(iterations * 100, 'unknown condition'));
  });
}
