/**
 * @file index.ts
 * @description Public entry point for user-authored test files.
 *
 * Exports:
 *   - `test(name, fn)` — registers a test into the runner-local registry.
 *     Does NOT call bun:test. Outside of `runTestFile()`, registration is a
 *     no-op so accidentally-imported files have zero daemon side effects.
 *   - `expect(frame)` — Playwright-style fluent assertion builder.
 *   - Types: `TmaxUseTestContext`, `TmaxUseTestFn`.
 *   - Re-exports the assertion helpers + Frame/Instance types for ergonomics.
 *
 * Example test file (`*.tmax-use.ts`):
 *
 *   import { test, expect } from '../test/index.ts';
 *
 *   test('opens a file in normal mode', async ({ frame }) => {
 *     await frame.openFile('README.md').run();
 *     await expect(frame).toHaveMode('normal').run().then(r => r._tag === 'Left' && (() => { throw new Error(r.left.message); })());
 *   });
 */

import { expect } from '../assert/index.ts';
import type { Frame } from '../src/frame.ts';
import type { TmaxInstance } from '../src/instance.ts';
import { registerTest } from './runner.ts';

export { expect };
export type { Frame } from '../src/frame.ts';
export type { TmaxInstance, InstanceOptions } from '../src/instance.ts';
export type { CaptureResult, HtmlResult, CursorPosition } from '../src/frame.ts';
export type { AssertionResult } from '../assert/text.ts';
export type { BaselineResult, BaselineOptions } from '../assert/baseline.ts';

/** Context passed to each test by the runner. */
export interface TmaxUseTestContext {
  readonly instance: TmaxInstance;
  readonly frame: Frame;
  /** Unique temp directory; cleaned up automatically. */
  readonly tmpDir: string;
  /** Where to write artifacts (screenshots, captured frames). */
  readonly artifactsDir: string;
}

/** Test function shape. */
export type TmaxUseTestFn = (ctx: TmaxUseTestContext) => Promise<void>;

/**
 * Register a test. Outside of an active runner registry this is a no-op —
 * importing a test file (e.g. as part of an editor's TS server) will not
 * trigger daemon spawns or test execution.
 *
 * Inside `runTestFile()`, this pushes the test into the file's local
 * registry so the runner can invoke it with a fresh context.
 */
export function test(name: string, fn: TmaxUseTestFn): void {
  registerTest(name, fn);
}
