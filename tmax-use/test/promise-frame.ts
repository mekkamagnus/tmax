/**
 * @file promise-frame.ts
 * @description Promise-based wrappers around Frame and `expect(frame)`.
 *
 * `*.tmax-use.ts` test authors use these wrappers directly with `await`. The
 * runner wraps every Frame in `PromiseFrame` before passing it to user tests,
 * so test code stays clean:
 *
 *   await frame.openFile(path);
 *   await frame.keys('i');
 *   await expect(frame).toHaveMode('insert');
 *
 * The wrappers execute the underlying `TaskEither` and throw on `Left` (with
 * the human-readable description from `describeTmaxUseError`). That throw is
 * what surfaces in the test step as a normal failure.
 */

import { Either } from '../../src/utils/task-either.ts';
import { Frame, CaptureResult, HtmlResult, CursorPosition, CaptureOptions } from '../src/frame.ts';
import { TmaxUseError, describeTmaxUseError } from '../src/errors.ts';
import {
  expect as expectBuilder, ExpectBuilder, ExpectResult,
} from '../assert/index.ts';

/** Run a TaskEither and throw on Left (using describeTmaxUseError). */
async function unwrap<T>(task: { run: () => Promise<Either<TmaxUseError, T>> }): Promise<T> {
  const r = await task.run();
  if (Either.isLeft(r)) throw new Error(describeTmaxUseError(r.left));
  return r.right;
}

/**
 * Promise-returning view over a `Frame`. Every method runs the underlying
 * `TaskEither` and throws on `Left`. Errors thrown here become test step
 * failures inside the runner.
 */
export class PromiseFrame {
  constructor(private readonly inner: Frame) {}

  /** Underlying Frame, for advanced use (custom TaskEither composition). */
  get raw(): Frame { return this.inner; }

  /** Frame label (used by reporters). */
  get name(): string { return this.inner.name; }

  // --- File ops ----------------------------------------------------------
  openFile(path: string): Promise<void> { return unwrap(this.inner.openFile(path)); }
  closeBuffer(): Promise<void> { return unwrap(this.inner.closeBuffer()); }

  // --- Input -------------------------------------------------------------
  keys(sequence: string): Promise<void> { return unwrap(this.inner.keys(sequence)); }
  // NOTE: not JS eval — forwards a T-Lisp expression to the daemon via JSON-RPC.
  eval(expr: string): Promise<string> { return unwrap(this.inner.eval(expr)); }

  // --- State queries -----------------------------------------------------
  mode(): Promise<string> { return unwrap(this.inner.mode()); }
  majorMode(): Promise<string> { return unwrap(this.inner.majorMode()); }
  cursor(): Promise<CursorPosition> { return unwrap(this.inner.cursor()); }
  bufferText(): Promise<string> { return unwrap(this.inner.bufferText()); }
  bufferName(): Promise<string> { return unwrap(this.inner.bufferName()); }
  statusLine(): Promise<string> { return unwrap(this.inner.statusLine()); }

  // --- Capture -----------------------------------------------------------
  capture(opts?: CaptureOptions): Promise<CaptureResult> { return unwrap(this.inner.capture(opts)); }
  captureHtml(opts?: CaptureOptions): Promise<HtmlResult> { return unwrap(this.inner.captureHtml(opts)); }
  capturePlain(opts?: CaptureOptions): Promise<string[]> { return unwrap(this.inner.capturePlain(opts)); }

  // --- Wait helpers ------------------------------------------------------
  waitForMode(expected: string, iterations?: number): Promise<void> {
    return unwrap(this.inner.waitForMode(expected, iterations));
  }
  waitForTextContains(text: string, iterations?: number): Promise<void> {
    return unwrap(this.inner.waitForTextContains(text, iterations));
  }
  waitForRender(iterations?: number): Promise<CaptureResult> {
    return unwrap(this.inner.waitForRender(iterations));
  }
}

/**
 * Promise-returning expect builder. Each terminal method runs the assertion
 * chain and throws on `Left` or on the first non-passing result.
 */
export class PromiseExpect {
  constructor(private readonly builder: ExpectBuilder) {}

  toHaveMode(expected: string): Promise<ExpectResult[]> {
    return unwrap(this.builder.toHaveMode(expected).run());
  }
  toHaveCursorAt(line: number, col: number): Promise<ExpectResult[]> {
    return unwrap(this.builder.toHaveCursorAt(line, col).run());
  }
  toHaveBufferTextContaining(substring: string): Promise<ExpectResult[]> {
    return unwrap(this.builder.toHaveBufferTextContaining(substring).run());
  }
  toHaveBufferTextEquals(text: string): Promise<ExpectResult[]> {
    return unwrap(this.builder.toHaveBufferTextEquals(text).run());
  }
  toHaveStatusLineContaining(substring: string): Promise<ExpectResult[]> {
    return unwrap(this.builder.toHaveStatusLineContaining(substring).run());
  }
  screenContains(substring: string): Promise<ExpectResult[]> {
    return unwrap(this.builder.screenContains(substring).run());
  }
  screenNotContains(substring: string): Promise<ExpectResult[]> {
    return unwrap(this.builder.screenNotContains(substring).run());
  }
  toMatchBaseline(baselinePath: string, opts?: Parameters<ExpectBuilder['toMatchBaseline']>[1]): Promise<ExpectResult[]> {
    return unwrap(this.builder.toMatchBaseline(baselinePath, opts).run());
  }
}

/**
 * Public entry point for tests. Returns a `PromiseExpect` whose methods are
 * awaitable directly.
 */
export function expect(frame: PromiseFrame): PromiseExpect {
  return new PromiseExpect(expectBuilder(frame.raw));
}
