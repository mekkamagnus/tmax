/**
 * @file screen.ts
 * @description Headless substring assertions on captured frame output.
 *
 * Uses `frame.capturePlain()` which strips ANSI sequences so substring matches
 * are reliable. The daemon's `capture` JSON-RPC renders headlessly (no tmux
 * required), so these assertions work in CI without a real terminal.
 */

import { TaskEither } from '../../src/utils/task-either.ts';
import { Frame } from '../src/frame.ts';
import { TmaxUseError, rightT } from '../src/errors.ts';
import type { AssertionResult } from './text.ts';

function pass(message: string, actual: string, expected: string): AssertionResult {
  return { passed: true, message, actual, expected };
}

function fail(message: string, actual: string, expected: string): AssertionResult {
  return { passed: false, message, actual, expected };
}

/** Assert the captured screen contains `substring` (any line). */
export function assertScreenContains(frame: Frame, substring: string): TaskEither<TmaxUseError, AssertionResult> {
  return frame.capturePlain().flatMap((lines) => {
    const joined = lines.join('\n');
    const ok = joined.includes(substring);
    return rightT<AssertionResult>(
      ok
        ? pass(`screen contains ${JSON.stringify(substring)}`, joined, substring)
        : fail(`screen does not contain ${JSON.stringify(substring)}`, joined, substring),
    );
  });
}

/** Assert the captured screen does NOT contain `substring`. */
export function assertScreenNotContains(frame: Frame, substring: string): TaskEither<TmaxUseError, AssertionResult> {
  return frame.capturePlain().flatMap((lines) => {
    const joined = lines.join('\n');
    const present = joined.includes(substring);
    return rightT<AssertionResult>(
      !present
        ? pass(`screen does not contain ${JSON.stringify(substring)}`, joined, substring)
        : fail(`screen still contains ${JSON.stringify(substring)}`, joined, substring),
    );
  });
}
