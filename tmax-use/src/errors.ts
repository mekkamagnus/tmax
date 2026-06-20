/**
 * @file errors.ts
 * @description Tagged-union domain errors for the tmax-use control library.
 *
 * Every failure that crosses the public TaskEither boundary is one of these
 * variants. Use `matchTmaxUseError` to switch on the variant safely.
 */

export type TmaxUseError =
  | { readonly _tag: 'DaemonNotResponsive'; readonly message: string; readonly socketPath: string }
  | { readonly _tag: 'CaptureFailed'; readonly message: string; readonly cause?: unknown }
  | { readonly _tag: 'KeySendFailed'; readonly message: string; readonly sequence?: string }
  | { readonly _tag: 'EvalError'; readonly message: string; readonly expression?: string }
  | { readonly _tag: 'AssertionFailed'; readonly message: string; readonly actual?: string; readonly expected?: string }
  | { readonly _tag: 'BaselineMismatch'; readonly message: string; readonly baselinePath: string; readonly diff: string }
  | { readonly _tag: 'BaselineMissing'; readonly message: string; readonly baselinePath: string }
  | { readonly _tag: 'PlaybookParseFailed'; readonly message: string; readonly path: string; readonly issues: readonly string[] }
  | { readonly _tag: 'SubprocessFailed'; readonly message: string; readonly command?: string; readonly stderr?: string }
  | { readonly _tag: 'Timeout'; readonly message: string; readonly timeoutMs: number };

export const TmaxUseError = {
  daemonNotResponsive: (socketPath: string, detail = ''): TmaxUseError => ({
    _tag: 'DaemonNotResponsive',
    socketPath,
    message: `daemon not responsive on ${socketPath}${detail ? `: ${detail}` : ''}`,
  }),
  captureFailed: (message: string, cause?: unknown): TmaxUseError => ({
    _tag: 'CaptureFailed',
    message,
    cause,
  }),
  keySendFailed: (message: string, sequence?: string): TmaxUseError => ({
    _tag: 'KeySendFailed',
    message,
    sequence,
  }),
  evalError: (message: string, expression?: string): TmaxUseError => ({
    _tag: 'EvalError',
    message,
    expression,
  }),
  assertionFailed: (message: string, actual?: string, expected?: string): TmaxUseError => ({
    _tag: 'AssertionFailed',
    message,
    actual,
    expected,
  }),
  baselineMismatch: (baselinePath: string, diff: string, message = 'baseline mismatch'): TmaxUseError => ({
    _tag: 'BaselineMismatch',
    baselinePath,
    diff,
    message,
  }),
  baselineMissing: (baselinePath: string): TmaxUseError => ({
    _tag: 'BaselineMissing',
    baselinePath,
    message: `baseline missing: ${baselinePath}`,
  }),
  playbookParseFailed: (path: string, issues: readonly string[]): TmaxUseError => ({
    _tag: 'PlaybookParseFailed',
    path,
    issues,
    message: `playbook ${path} failed to parse:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
  }),
  subprocessFailed: (message: string, command?: string, stderr?: string): TmaxUseError => ({
    _tag: 'SubprocessFailed',
    message,
    command,
    stderr,
  }),
  timeout: (timeoutMs: number, what: string): TmaxUseError => ({
    _tag: 'Timeout',
    timeoutMs,
    message: `timed out after ${timeoutMs}ms waiting for ${what}`,
  }),
};

/**
 * Structural pattern-match over a `TmaxUseError`. Returns the value of the
 * matching arm. The fallback arm (`_`) is required so adding a new variant
 * produces a compile error in every consumer (exhaustiveness check).
 */
export function matchTmaxUseError<R>(
  error: TmaxUseError,
  arms: {
    DaemonNotResponsive: (e: Extract<TmaxUseError, { _tag: 'DaemonNotResponsive' }>) => R;
    CaptureFailed: (e: Extract<TmaxUseError, { _tag: 'CaptureFailed' }>) => R;
    KeySendFailed: (e: Extract<TmaxUseError, { _tag: 'KeySendFailed' }>) => R;
    EvalError: (e: Extract<TmaxUseError, { _tag: 'EvalError' }>) => R;
    AssertionFailed: (e: Extract<TmaxUseError, { _tag: 'AssertionFailed' }>) => R;
    BaselineMismatch: (e: Extract<TmaxUseError, { _tag: 'BaselineMismatch' }>) => R;
    BaselineMissing: (e: Extract<TmaxUseError, { _tag: 'BaselineMissing' }>) => R;
    PlaybookParseFailed: (e: Extract<TmaxUseError, { _tag: 'PlaybookParseFailed' }>) => R;
    SubprocessFailed: (e: Extract<TmaxUseError, { _tag: 'SubprocessFailed' }>) => R;
    Timeout: (e: Extract<TmaxUseError, { _tag: 'Timeout' }>) => R;
  },
): R {
  switch (error._tag) {
    case 'DaemonNotResponsive': return arms.DaemonNotResponsive(error);
    case 'CaptureFailed': return arms.CaptureFailed(error);
    case 'KeySendFailed': return arms.KeySendFailed(error);
    case 'EvalError': return arms.EvalError(error);
    case 'AssertionFailed': return arms.AssertionFailed(error);
    case 'BaselineMismatch': return arms.BaselineMismatch(error);
    case 'BaselineMissing': return arms.BaselineMissing(error);
    case 'PlaybookParseFailed': return arms.PlaybookParseFailed(error);
    case 'SubprocessFailed': return arms.SubprocessFailed(error);
    case 'Timeout': return arms.Timeout(error);
  }
}

/** Human-readable description used by reporters and CLI output. */
export function describeTmaxUseError(error: TmaxUseError): string {
  return matchTmaxUseError(error, {
    DaemonNotResponsive: (e) => e.message,
    CaptureFailed: (e) => `capture failed: ${e.message}`,
    KeySendFailed: (e) => `key send failed: ${e.message}${e.sequence ? ` (sequence: ${JSON.stringify(e.sequence)})` : ''}`,
    EvalError: (e) => `eval failed: ${e.message}${e.expression ? ` (expression: ${e.expression})` : ''}`,
    AssertionFailed: (e) => e.message,
    BaselineMismatch: (e) => `baseline mismatch (${e.baselinePath}):\n${e.diff}`,
    BaselineMissing: (e) => e.message,
    PlaybookParseFailed: (e) => e.message,
    SubprocessFailed: (e) => e.message,
    Timeout: (e) => e.message,
  });
}

// ---------------------------------------------------------------------------
// TaskEither convenience constructors with TmaxUseError fixed as the Left.
//
// The base class has inconsistent type-arg order: `right<R, L>` vs `left<L, R>`.
// These helpers give the control library a single consistent shape.
// ---------------------------------------------------------------------------

import { TaskEither, Either } from '../../src/utils/task-either.ts';

export const rightT = <T>(value: T): TaskEither<TmaxUseError, T> =>
  TaskEither.right<T, TmaxUseError>(value);

export const leftT = <T = never>(error: TmaxUseError): TaskEither<TmaxUseError, T> =>
  TaskEither.left<TmaxUseError, T>(error);

export const rightE = <T>(value: T): Either<TmaxUseError, T> =>
  Either.right<T, TmaxUseError>(value);

export const leftE = <T = never>(error: TmaxUseError): Either<TmaxUseError, T> =>
  Either.left<TmaxUseError, T>(error);
