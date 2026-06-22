/**
 * @file index.ts
 * @description Public entry point for user-authored test files.
 *
 * Exports:
 *   - `test(name, fn)` — registers a test into the runner-local registry.
 *     Does NOT call bun:test. Outside of `runTestFile()`, registration is a
 *     no-op so accidentally-imported files have zero daemon side effects.
 *   - `expect(frame)` — Playwright-style fluent assertion builder
 *     (Promise-returning; await directly in `async` tests).
 *   - Types: `TmaxUseTestContext`, `TmaxUseTestFn`.
 *
 * Test files receive Promise-based fixtures. Authors `await` methods directly
 * and never call `.run()` on a `TaskEither`:
 *
 *   import { test, expect } from '../test/index.ts';
 *
 *   test('opens a file in normal mode', async ({ frame }) => {
 *     await frame.openFile('README.md');
 *     await expect(frame).toHaveMode('normal');
 *   });
 */

import { expect } from './promise-frame.ts';
import type { PromiseFrame } from './promise-frame.ts';
import type { Frame } from '../src/frame.ts';
import type { TmaxInstance } from '../src/instance.ts';
import { registerTest } from './runner.ts';

export { expect };
export type { PromiseFrame };
export type { Frame } from '../src/frame.ts';
export type { TmaxInstance, InstanceOptions } from '../src/instance.ts';
export type { CaptureResult, HtmlResult, CursorPosition } from '../src/frame.ts';
export type { AssertionResult } from '../assert/text.ts';
export type { BaselineResult, BaselineOptions } from '../assert/baseline.ts';

/** Context passed to each test by the runner. */
export interface TmaxUseTestContext {
  readonly instance: TmaxInstance;
  /** Promise-based frame fixture. `await frame.keys(...)` etc. */
  readonly frame: PromiseFrame;
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
