/**
 * @file index.ts
 * @description Fluent `expect(frame)` API — Playwright-style assertion builder.
 *
 * Each builder method captures its arguments and returns `this` for chaining.
 * Assertions are queued as factory closures; `.run()` materializes them in
 * order, short-circuiting on the first failure so a chain stops at the first
 * mismatch.
 *
 * Example:
 *
 *   const result = await expect(frame)
 *     .toHaveMode('normal')
 *     .toHaveCursorAt(0, 0)
 *     .run();
 */

import { TaskEither, Either } from '../../src/utils/task-either.ts';
import { Frame } from '../src/frame.ts';
import { TmaxUseError, rightE, leftE } from '../src/errors.ts';
import {
  AssertionResult,
  assertMode,
  assertCursorAt,
  assertBufferTextContains,
  assertBufferTextEquals,
  assertStatusLineContains,
} from './text.ts';
import { assertScreenContains, assertScreenNotContains } from './screen.ts';
import { matchBaseline, BaselineResult, BaselineOptions } from './baseline.ts';

export type { AssertionResult } from './text.ts';
export type { BaselineResult, BaselineOptions } from './baseline.ts';
export { assertMode, assertCursorAt, assertBufferTextContains, assertBufferTextEquals, assertStatusLineContains } from './text.ts';
export { assertScreenContains, assertScreenNotContains } from './screen.ts';
export { matchBaseline, updateBaseline } from './baseline.ts';

/** Combined assertion result type for the chain terminal. */
export type ExpectResult = AssertionResult | BaselineResult;

export function isAssertionResult(r: ExpectResult): r is AssertionResult {
  return typeof (r as AssertionResult).message === 'string' && !('created' in r);
}

type AssertFactory = () => TaskEither<TmaxUseError, ExpectResult>;

/**
 * Fluent assertion builder. Methods return `this` for chaining; assertions are
 * queued as factories. Call `.run()` to materialize the final TaskEither.
 */
export class ExpectBuilder {
  private readonly factories: AssertFactory[] = [];

  /** Construct directly (or use `expect(frame)`). */
  constructor(private readonly frame: Frame) {}

  /** `.toHaveMode('normal')` — assert editor mode. */
  toHaveMode(expected: string): this {
    this.factories.push(() => assertMode(this.frame, expected));
    return this;
  }

  /** `.toHaveCursorAt(line, col)` — assert cursor position. */
  toHaveCursorAt(line: number, col: number): this {
    this.factories.push(() => assertCursorAt(this.frame, line, col));
    return this;
  }

  /** `.toHaveBufferTextContaining('foo')` — substring match on buffer text. */
  toHaveBufferTextContaining(substring: string): this {
    this.factories.push(() => assertBufferTextContains(this.frame, substring));
    return this;
  }

  /** `.toHaveBufferTextEquals(text)` — exact match on buffer text. */
  toHaveBufferTextEquals(text: string): this {
    this.factories.push(() => assertBufferTextEquals(this.frame, text));
    return this;
  }

  /** `.toHaveStatusLineContaining('Saved')` — substring match on status line. */
  toHaveStatusLineContaining(substring: string): this {
    this.factories.push(() => assertStatusLineContains(this.frame, substring));
    return this;
  }

  /** `.screenContains('foo')` — substring match on headless capture plain output. */
  screenContains(substring: string): this {
    this.factories.push(() => assertScreenContains(this.frame, substring));
    return this;
  }

  /** `.screenNotContains('foo')` — inverse substring match. */
  screenNotContains(substring: string): this {
    this.factories.push(() => assertScreenNotContains(this.frame, substring));
    return this;
  }

  /**
   * `.toMatchBaseline(path, opts)` — visual baseline comparison.
   *
   * Captures the current frame as HTML and compares against the stored
   * baseline. Lifecycle is governed by `BaselineOptions`.
   */
  toMatchBaseline(baselinePath: string, opts: BaselineOptions = {}): this {
    this.factories.push(() =>
      this.frame.captureHtml().flatMap((r) => matchBaseline(r.html, baselinePath, opts)),
    );
    return this;
  }

  /**
   * Materialize the chain as a TaskEither. Runs each assertion in order,
   * short-circuiting on the first failure (Left with AssertionFailed).
   */
  run(): TaskEither<TmaxUseError, ExpectResult[]> {
    return TaskEither.from(async () => {
      const results: ExpectResult[] = [];
      for (const factory of this.factories) {
        const r = await factory().run();
        if (Either.isLeft(r)) {
          return Either.left<TmaxUseError, ExpectResult[]>(r.left);
        }
        const result = r.right;
        results.push(result);
        if (!resultPassed(result)) {
          const failureMessage = isAssertionResult(result)
            ? result.message
            : `baseline mismatch (${result.baselinePath}):\n${result.diff}`;
          return leftE<ExpectResult[]>(TmaxUseError.assertionFailed(failureMessage));
        }
      }
      return rightE<ExpectResult[]>(results);
    });
  }

  /** Convenience: materialize and run in one call. Returns the Either directly. */
  async runNow(): Promise<Either<TmaxUseError, ExpectResult[]>> {
    return this.run().run();
  }

  /** Number of queued assertions. */
  get length(): number {
    return this.factories.length;
  }
}

function resultPassed(r: ExpectResult): boolean {
  if ('passed' in r) return r.passed;
  return true;
}

/**
 * Public entry point. Returns an `ExpectBuilder` for chaining assertions.
 */
export function expect(frame: Frame): ExpectBuilder {
  return new ExpectBuilder(frame);
}
