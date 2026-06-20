/**
 * @file text.ts
 * @description Deterministic state assertions — mode, cursor, buffer text,
 *   status line. Each assertion queries the daemon and compares against an
 *   expected value.
 *
 * Every function returns a TaskEither<AssertionFailed, AssertionResult>. The
 * `passed` boolean lets the runner collect results across many assertions.
 */

import { TaskEither } from '../../src/utils/task-either.ts';
import { Frame, CursorPosition } from '../src/frame.ts';
import { TmaxUseError, rightT, leftT } from '../src/errors.ts';

export interface AssertionResult {
  readonly passed: boolean;
  readonly message: string;
  readonly actual: string;
  readonly expected: string;
}

function pass(message: string, actual: string, expected: string): AssertionResult {
  return { passed: true, message, actual, expected };
}

function fail(message: string, actual: string, expected: string): AssertionResult {
  return { passed: false, message, actual, expected };
}

function toTask(r: AssertionResult): TaskEither<TmaxUseError, AssertionResult> {
  return rightT(r);
}

/** Assert `(editor-mode)` equals `expected`. */
export function assertMode(frame: Frame, expected: string): TaskEither<TmaxUseError, AssertionResult> {
  return frame.mode().flatMap((actual) => {
    const ok = actual === expected;
    return toTask(
      ok
        ? pass(`mode is ${JSON.stringify(expected)}`, actual, expected)
        : fail(`expected mode ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`, actual, expected),
    );
  });
}

/** Assert cursor position equals `{ line, col }`. */
export function assertCursorAt(frame: Frame, line: number, col: number): TaskEither<TmaxUseError, AssertionResult> {
  return frame.cursor().flatMap((pos: CursorPosition) => {
    const ok = pos.line === line && pos.col === col;
    const expected = `line=${line}, col=${col}`;
    const actual = `line=${pos.line}, col=${pos.col}`;
    return toTask(
      ok
        ? pass(`cursor at ${expected}`, actual, expected)
        : fail(`expected cursor ${expected}, got ${actual}`, actual, expected),
    );
  });
}

/** Assert cursor is on `line` (column unconstrained). */
export function assertCursorAtLine(frame: Frame, line: number): TaskEither<TmaxUseError, AssertionResult> {
  return frame.cursor().flatMap((pos: CursorPosition) => {
    const ok = pos.line === line;
    const expected = `line=${line} (any col)`;
    const actual = `line=${pos.line}, col=${pos.col}`;
    return toTask(
      ok
        ? pass(`cursor on ${expected}`, actual, expected)
        : fail(`expected cursor ${expected}, got ${actual}`, actual, expected),
    );
  });
}

/** Assert buffer text contains `substring`. */
export function assertBufferTextContains(frame: Frame, substring: string): TaskEither<TmaxUseError, AssertionResult> {
  return frame.bufferText().flatMap((text) => {
    const ok = text.includes(substring);
    return toTask(
      ok
        ? pass(`buffer contains ${JSON.stringify(substring)}`, text, substring)
        : fail(`buffer does not contain ${JSON.stringify(substring)}`, text, substring),
    );
  });
}

/** Assert buffer text exactly equals `expected`. */
export function assertBufferTextEquals(frame: Frame, expected: string): TaskEither<TmaxUseError, AssertionResult> {
  return frame.bufferText().flatMap((text) => {
    const ok = text === expected;
    return toTask(
      ok
        ? pass(`buffer equals expected`, text, expected)
        : fail(`buffer mismatch (got ${text.length} bytes, expected ${expected.length})`, text, expected),
    );
  });
}

/** Assert status line contains `substring`. */
export function assertStatusLineContains(frame: Frame, substring: string): TaskEither<TmaxUseError, AssertionResult> {
  return frame.statusLine().flatMap((text) => {
    const ok = text.includes(substring);
    return toTask(
      ok
        ? pass(`status line contains ${JSON.stringify(substring)}`, text, substring)
        : fail(`status line does not contain ${JSON.stringify(substring)}`, text, substring),
    );
  });
}
