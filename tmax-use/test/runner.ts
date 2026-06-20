/**
 * @file runner.ts
 * @description Test runner — orchestrates daemon lifecycle, executes YAML
 *   playbooks and TypeScript test files, collects results, invokes reporters.
 *
 * Execution model:
 *   - Each playbook gets a fresh daemon (per-playbook isolation).
 *   - Steps execute sequentially: setup → open → for each step: setup_cursor
 *     (optional) → keys/eval → wait → expect assertions.
 *   - A frame is captured after each step for the HTML reporter.
 *   - Cleanup runs unconditionally (kill buffer, delete temp files).
 *
 * TypeScript test files (`*.tmax-use.ts`) register tests via the runner-local
 * `test()` API exported from `tmax-use/test/index.ts`. They are dynamically
 * imported with a cache-busting query string and executed sequentially.
 */

import { spawn } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import { join, dirname, isAbsolute, resolve as pathResolve } from 'path';
import { pathToFileURL } from 'url';
import { TaskEither, Either, TaskEitherUtils } from '../../src/utils/task-either.ts';
import { TmaxUseError, rightT, leftT, rightE, leftE, describeTmaxUseError } from '../src/errors.ts';
import { Frame, CaptureResult } from '../src/frame.ts';
import { TmaxInstance, InstanceOptions } from '../src/instance.ts';
import {
  Playbook, PlaybookStep, PlaybookAssert, PlaybookSetup, parsePlaybook,
} from './playbook.ts';
import {
  assertMode, assertCursorAt, assertCursorAtLine, assertBufferTextContains, assertStatusLineContains,
  AssertionResult,
} from '../assert/text.ts';
import { assertScreenContains, assertScreenNotContains } from '../assert/screen.ts';
import { matchBaseline } from '../assert/baseline.ts';

export interface StepResult {
  readonly name: string;
  readonly passed: boolean;
  readonly details: readonly string[];
  readonly frame?: CaptureResult;
  readonly durationMs: number;
}

export interface TestResult {
  readonly name: string;
  readonly source: string;
  readonly passed: boolean;
  readonly steps: readonly StepResult[];
  readonly failureMessage?: string;
  readonly durationMs: number;
}

export interface SuiteResult {
  readonly results: readonly TestResult[];
  readonly passed: number;
  readonly failed: number;
  readonly durationMs: number;
}

export interface RunnerOptions {
  /** Socket path for the daemon (default: project-default per-instance). */
  readonly socketPath?: string;
  /** Width passed to the daemon for capture (default 94). */
  readonly width?: number;
  /** Height passed to the daemon for capture (default 29). */
  readonly height?: number;
  /** Headed (tmux) mode: spawn a real TUI per playbook that has headed steps. */
  readonly headed?: boolean;
  /** Force headless: refuse to spawn tmux (CI default). */
  readonly headless?: boolean;
  /** Update baselines instead of comparing. */
  readonly updateBaselines?: boolean;
  /** Output directory for reports + artifacts. */
  readonly outputDir?: string;
  /** Where to find baseline files (default: tmax-use/baselines). */
  readonly baselinesDir?: string;
  /** Project root for daemon + setup files. */
  readonly projectRoot?: string;
}

const DEFAULT_WIDTH = 94;
const DEFAULT_HEIGHT = 29;

/** Default project root (resolved from this file's location). */
const DEFAULT_PROJECT_ROOT = pathResolve(new URL('..', import.meta.url).pathname, '..');

let socketCounter = 0;

/**
 * Generate an isolated socket path per daemon launch so concurrent playbook
 * runs and stale user daemons cannot collide. Format mirrors the project
 * convention `/tmp/tmax-<uid>/...` but lives in a per-run subdir.
 */
function isolatedSocketPath(): string {
  const uid = process.getuid?.() ?? 501;
  const id = `${process.pid}-${Date.now()}-${socketCounter++}`;
  return `/tmp/tmax-${uid}/tmax-use-${id}/server`;
}

/**
 * Resolve the socket path for a launch:
 *   - explicit `opts.socketPath` wins (caller owns lifecycle)
 *   - otherwise generate a fresh isolated path per launch
 */
function launchSocketOpts(opts: RunnerOptions): InstanceOptions {
  return opts.socketPath ? { socketPath: opts.socketPath } : { socketPath: isolatedSocketPath() };
}

// ---------------------------------------------------------------------------
// Playbook execution
// ---------------------------------------------------------------------------

interface PlaybookContext {
  playbook: Playbook;
  tempFiles: string[];
  vars: Map<string, string>;
  options: RunnerOptions;
  instance: TmaxInstance;
  frame: Frame;
  artifacts: CaptureResult[];
}

/** Resolve ${VAR} references in a string. */
function resolveVars(value: string, ctx: PlaybookContext): string {
  return value.replace(/\$\{(\w+)\}/g, (_m, key: string) => ctx.vars.get(key) ?? `\${${key}}`);
}

/** Resolve a relative path against the project root. */
function resolveProjectPath(p: string, projectRoot: string): string {
  return isAbsolute(p) ? p : join(projectRoot, p);
}

/** Write setup files to the project root so the daemon can see them. */
function writeSetupFiles(ctx: PlaybookContext): TaskEither<TmaxUseError, void> {
  const setups = ctx.playbook.setup ?? [];
  const tasks = setups.map((s) => {
    const filePath = resolveProjectPath(s.name, ctx.options.projectRoot ?? DEFAULT_PROJECT_ROOT);
    ctx.tempFiles.push(filePath);
    if (s.var) ctx.vars.set(s.var, filePath);
    return TaskEitherUtils.writeFile(filePath, s.content).mapLeft((err): TmaxUseError =>
      TmaxUseError.subprocessFailed(`setup_file ${s.name}: ${err}`),
    );
  });
  return TaskEither.sequence(tasks).map(() => undefined);
}

/** Apply a step's optional pre-positioning cursor. */
function applySetupCursor(step: PlaybookStep, ctx: PlaybookContext): TaskEither<TmaxUseError, void> {
  if (!step.setup_cursor) return rightT<void>(undefined);
  const [line, col] = step.setup_cursor;
  return ctx.frame.eval(`(cursor-move ${line} ${col})`).flatMap(() =>
    TaskEitherUtils.delay(60) as unknown as TaskEither<TmaxUseError, void>,
  ).mapLeft((): TmaxUseError => TmaxUseError.subprocessFailed('cursor-move failed'));
}

/** Compute the effective wait for a step (defaults: keys=120ms, eval=150ms, screen-assert=300ms). */
function effectiveWait(step: PlaybookStep, branch: 'keys' | 'eval'): number {
  const usesScreen = step.expect?.screen_contains !== undefined || step.expect?.screen_not_contains !== undefined;
  if (step.wait !== undefined) return step.wait;
  if (usesScreen) return 300;
  return branch === 'keys' ? 120 : 150;
}

/**
 * Execute one step. Captures a frame after the action for the reporter.
 * Returns either Right(StepResult) or Left(error) — the latter aborts the
 * playbook (a transport failure, not just an assertion failure).
 */
function runStep(step: PlaybookStep, index: number, ctx: PlaybookContext): TaskEither<TmaxUseError, StepResult> {
  const label = step.name ?? `step ${index + 1}`;
  const start = Date.now();
  const details: string[] = [];
  let evalResult = '';

  return applySetupCursor(step, ctx).flatMap(() => {
    // Action: keys XOR eval.
    if (step.keys && step.eval) {
      return rightT<StepResult>({
        name: label, passed: false,
        details: ['step has both keys and eval — they are mutually exclusive'],
        durationMs: Date.now() - start,
      });
    }
    const action: TaskEither<TmaxUseError, void> = step.keys
      ? ctx.frame.keys(resolveVars(step.keys, ctx)).flatMap(() => TaskEitherUtils.delay(effectiveWait(step, 'keys')) as unknown as TaskEither<TmaxUseError, void>)
      : step.eval
        ? ctx.frame.eval(resolveVars(step.eval, ctx)).flatMap((r) => {
            evalResult = r;
            return TaskEitherUtils.delay(effectiveWait(step, 'eval')) as unknown as TaskEither<TmaxUseError, void>;
          })
        : rightT<void>(undefined);

    return action.flatMap(() => {
      // If no expect block, this is a pure action step.
      if (!step.expect || Object.keys(step.expect).length === 0) {
        return captureStepFrame(ctx).map((frame) => ({
          name: label, passed: true, details, frame, durationMs: Date.now() - start,
        } as StepResult));
      }
      // Run assertions.
      return evaluateExpect(step.expect, evalResult, ctx).flatMap((outcomes) => {
        let passed = true;
        for (const o of outcomes) {
          details.push(o.detail);
          if (!o.pass) passed = false;
        }
        return captureStepFrame(ctx).map((frame) => ({
          name: label, passed, details, frame, durationMs: Date.now() - start,
        } as StepResult));
      });
    });
  });
}

/** Capture a frame for the reporter (best-effort — never fail a step on capture). */
function captureStepFrame(ctx: PlaybookContext): TaskEither<TmaxUseError, CaptureResult | undefined> {
  return ctx.frame.capture().flatMap((r) => {
    ctx.artifacts.push(r);
    return rightT<CaptureResult | undefined>(r);
  }).mapLeft((): TmaxUseError => TmaxUseError.captureFailed('could not capture frame for report (continuing)'));
}

/** Evaluate every field of a `PlaybookAssert` against the live frame state. */
function evaluateExpect(expect: PlaybookAssert, evalResult: string, ctx: PlaybookContext): TaskEither<TmaxUseError, Array<{ pass: boolean; detail: string }>> {
  const outcomes: Array<{ pass: boolean; detail: string }> = [];

  // Helper: run a TaskEither assertion, push its result, accumulate.
  const collect = (task: TaskEither<TmaxUseError, AssertionResult>): TaskEither<TmaxUseError, void> =>
    task.flatMap((r) => {
      outcomes.push({ pass: r.passed, detail: r.message });
      return rightT<void>(undefined);
    });

  let chain: TaskEither<TmaxUseError, void> = rightT<void>(undefined);
  const cursorLine = expect.cursor_line;
  const cursorCol = expect.cursor_column;
  if (cursorLine !== undefined && cursorCol !== undefined) {
    chain = chain.flatMap(() => collect(assertCursorAt(ctx.frame, cursorLine, cursorCol)));
  } else if (cursorLine !== undefined) {
    chain = chain.flatMap(() => collect(assertCursorAtLine(ctx.frame, cursorLine)));
  } else if (cursorCol !== undefined) {
    chain = chain.flatMap(() => collect(assertCursorAt(ctx.frame, 0, cursorCol)));
  }
  const expectedMode = expect.mode;
  if (expectedMode !== undefined) {
    chain = chain.flatMap(() => collect(assertMode(ctx.frame, expectedMode)));
  }
  const bufferContains = expect.buffer_contains;
  if (bufferContains !== undefined) {
    chain = chain.flatMap(() => collect(assertBufferTextContains(ctx.frame, bufferContains)));
  }
  const statusMessage = expect.status_message;
  if (statusMessage !== undefined) {
    chain = chain.flatMap(() => collect(assertStatusLineContains(ctx.frame, statusMessage)));
  }
  const lineText = expect.line_text;
  if (lineText !== undefined) {
    chain = chain.flatMap(() =>
      ctx.frame.eval('(buffer-get-line (cursor-line))').flatMap((actual) => {
        const ok = actual === lineText;
        outcomes.push({ pass: ok, detail: `line_text: expected ${JSON.stringify(lineText)}, got ${JSON.stringify(actual)}` });
        return rightT<void>(undefined);
      }),
    );
  }
  const lineTextMatches = expect.line_text_matches;
  if (lineTextMatches !== undefined) {
    let regex: RegExp | undefined;
    try { regex = new RegExp(lineTextMatches); } catch (e) {
      outcomes.push({ pass: false, detail: `line_text_matches: invalid regex: ${e instanceof Error ? e.message : String(e)}` });
    }
    if (regex) {
      const re = regex;
      chain = chain.flatMap(() =>
        ctx.frame.eval('(buffer-get-line (cursor-line))').flatMap((actual) => {
          const ok = re.test(actual);
          outcomes.push({ pass: ok, detail: `line_text_matches: /${lineTextMatches}/ ${ok ? 'matched' : 'did not match'} ${JSON.stringify(actual)}` });
          return rightT<void>(undefined);
        }),
      );
    }
  }
  const resultContains = expect.result_contains;
  if (resultContains !== undefined) {
    const ok = evalResult.includes(resultContains);
    outcomes.push({ pass: ok, detail: `result_contains: ${JSON.stringify(resultContains)} ${ok ? 'found' : 'NOT found'} in eval result` });
  }
  const screenContains = expect.screen_contains;
  if (screenContains !== undefined) {
    chain = chain.flatMap(() => collect(assertScreenContains(ctx.frame, screenContains)));
  }
  const screenNotContains = expect.screen_not_contains;
  if (screenNotContains !== undefined) {
    chain = chain.flatMap(() => collect(assertScreenNotContains(ctx.frame, screenNotContains)));
  }
  return chain.map(() => outcomes);
}

/** Tear down: kill buffer, delete temp files. Always succeeds (errors swallowed). */
function cleanup(ctx: PlaybookContext): TaskEither<TmaxUseError, void> {
  return TaskEither.from(async () => {
    try { await ctx.frame.eval('(kill-buffer)').run(); } catch { /* fine */ }
    for (const f of ctx.tempFiles) {
      try { await fs.unlink(f); } catch { /* fine */ }
    }
    return rightE<void>(undefined);
  });
}

/** Open the first setup file (typical entry point). */
function openFirstSetupFile(ctx: PlaybookContext): TaskEither<TmaxUseError, void> {
  if (!ctx.vars.size) return rightT<void>(undefined);
  const firstFile = Array.from(ctx.vars.values())[0]!;
  return ctx.frame.openFile(firstFile).flatMap(() => TaskEitherUtils.delay(400) as unknown as TaskEither<TmaxUseError, void>);
}

/** Execute a single playbook end-to-end. */
export function runPlaybook(playbookPath: string, opts: RunnerOptions): Promise<TestResult> {
  return runPlaybookTE(playbookPath, opts).run().then((r) =>
    Either.isLeft(r)
      ? { name: playbookPath, source: playbookPath, passed: false, steps: [], failureMessage: describeTmaxUseError(r.left), durationMs: 0 }
      : r.right,
  );
}

function runPlaybookTE(playbookPath: string, opts: RunnerOptions): TaskEither<TmaxUseError, TestResult> {
  const start = Date.now();
  return TaskEither.from(async () => {
    const content = await fs.readFile(playbookPath, 'utf-8');
    const parsed = parsePlaybook(content, playbookPath);
    if (Either.isLeft(parsed)) return Either.left<TmaxUseError, TestResult>(parsed.left);
    const playbook = parsed.right;

    // 1. Launch daemon (fresh, isolated per playbook).
    const instanceOpts: InstanceOptions = launchSocketOpts(opts);
    const launched = await TmaxInstance.launch(instanceOpts).run();
    if (Either.isLeft(launched)) return Either.left<TmaxUseError, TestResult>(launched.left);
    const instance = launched.right;
    const frame = instance.frame(playbook.name);

    const ctx: PlaybookContext = {
      playbook,
      tempFiles: [],
      vars: new Map(),
      options: opts,
      instance,
      frame,
      artifacts: [],
    };

    const stepResults: StepResult[] = [];
    let failureMessage: string | undefined;

    try {
      // 2. Write setup files.
      const write = await writeSetupFiles(ctx).run();
      if (Either.isLeft(write)) return Either.left<TmaxUseError, TestResult>(write.left);

      // 3. Open first setup file.
      const open = await openFirstSetupFile(ctx).run();
      if (Either.isLeft(open)) return Either.left<TmaxUseError, TestResult>(open.left);

      // 4. (Optional) major-mode verification.
      if (playbook.mode) {
        const m = await frame.majorMode().run();
        if (Either.isLeft(m) || m.right !== playbook.mode) {
          failureMessage = `expected mode ${JSON.stringify(playbook.mode)}, got ${Either.isRight(m) ? JSON.stringify(m.right) : 'error'}`;
        }
      }

      // 5. Execute steps.
      if (!failureMessage) {
        for (let i = 0; i < playbook.steps.length; i++) {
          const step = playbook.steps[i]!;
          const r = await runStep(step, i, ctx).run();
          if (Either.isLeft(r)) {
            failureMessage = describeTmaxUseError(r.left);
            stepResults.push({ name: step.name ?? `step ${i + 1}`, passed: false, details: [failureMessage], durationMs: 0 });
            break;
          }
          stepResults.push(r.right);
          if (!r.right.passed) {
            failureMessage = `step "${r.right.name}" failed: ${r.right.details.join('; ')}`;
            break;
          }
        }
      }
    } finally {
      await cleanup(ctx).run();
      await instance.close().run();
    }

    const passed = failureMessage === undefined && stepResults.every((s) => s.passed);
    return rightE<TestResult>({
      name: playbook.name,
      source: playbookPath,
      passed,
      steps: stepResults,
      failureMessage,
      durationMs: Date.now() - start,
    });
  });
}

// ---------------------------------------------------------------------------
// TypeScript test file execution
// ---------------------------------------------------------------------------

export interface RegisteredTest {
  readonly name: string;
  readonly fn: (ctx: TmaxUseTestContext) => Promise<void>;
}

export interface TmaxUseTestContext {
  readonly instance: TmaxInstance;
  readonly frame: Frame;
  readonly tmpDir: string;
  readonly artifactsDir: string;
}

let activeRegistry: RegisteredTest[] | null = null;

/**
 * The `test()` registration function exported to user test files via
 * `tmax-use/test/index.ts`. It pushes into the currently-active registry. If
 * no registry is active (file was discovered outside the runner), it is a
 * silent no-op — so an accidentally-imported file has zero daemon side
 * effects.
 */
export function registerTest(name: string, fn: (ctx: TmaxUseTestContext) => Promise<void>): void {
  if (activeRegistry === null) return;
  activeRegistry.push({ name, fn });
}

/** Execute a single `*.tmax-use.ts` file under a fresh daemon + isolated registry. */
export async function runTestFile(testPath: string, opts: RunnerOptions): Promise<TestResult> {
  const start = Date.now();
  const runId = `${process.pid}-${Date.now()}`;
  const local: RegisteredTest[] = [];
  const previous = activeRegistry;
  activeRegistry = local;
  try {
    // Cache-bust: force a fresh module instance each run so multiple files with
    // same-named tests don't collide.
    const url = pathToFileURL(testPath).href + `?tmaxUseRun=${runId}`;
    await import(url);
  } catch (e) {
    return {
      name: testPath,
      source: testPath,
      passed: false,
      steps: [],
      failureMessage: `failed to import test file: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - start,
    };
  } finally {
    activeRegistry = previous;
  }

  if (local.length === 0) {
    return {
      name: testPath,
      source: testPath,
      passed: false,
      steps: [],
      failureMessage: 'no tmax-use tests registered — did you import { test } from "../test/index.ts" instead of bun:test?',
      durationMs: Date.now() - start,
    };
  }

  const instanceOpts: InstanceOptions = launchSocketOpts(opts);
  const launched = await TmaxInstance.launch(instanceOpts).run();
  if (Either.isLeft(launched)) {
    return {
      name: testPath,
      source: testPath,
      passed: false,
      steps: [],
      failureMessage: describeTmaxUseError(launched.left),
      durationMs: Date.now() - start,
    };
  }
  const instance = launched.right;
  const frame = instance.frame(testPath);
  const tmpDir = opts.outputDir ? join(opts.outputDir, `tmp-${runId}`) : `/tmp/tmax-use-${runId}`;
  const artifactsDir = opts.outputDir ? join(opts.outputDir, `artifacts-${runId}`) : `/tmp/tmax-use-artifacts-${runId}`;
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.mkdir(artifactsDir, { recursive: true });
  } catch { /* fine */ }

  const stepResults: StepResult[] = [];
  let failureMessage: string | undefined;

  for (const t of local) {
    const stepStart = Date.now();
    const ctx: TmaxUseTestContext = { instance, frame, tmpDir, artifactsDir };
    try {
      await t.fn(ctx);
      stepResults.push({ name: t.name, passed: true, details: [], durationMs: Date.now() - stepStart });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stepResults.push({ name: t.name, passed: false, details: [msg], durationMs: Date.now() - stepStart });
      if (!failureMessage) failureMessage = `test "${t.name}" failed: ${msg}`;
    }
  }

  await instance.close().run();

  return {
    name: testPath,
    source: testPath,
    passed: failureMessage === undefined,
    steps: stepResults,
    failureMessage,
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Discovery + suite execution
// ---------------------------------------------------------------------------

/** Discover playbook + test files matching the given glob-like patterns. */
export async function discoverTargets(patterns: readonly string[], opts: RunnerOptions): Promise<{ playbooks: string[]; tests: string[] }> {
  const playbooks: string[] = [];
  const tests: string[] = [];
  const projectRoot = opts.projectRoot ?? DEFAULT_PROJECT_ROOT;

  for (const pattern of patterns) {
    const abs = isAbsolute(pattern) ? pattern : pathResolve(projectRoot, pattern);
    // Directory: scan for *.yaml (playbooks) and *.tmax-use.ts (tests).
    if (await isDirectory(abs)) {
      const entries = await scanRecursive(abs);
      for (const e of entries) {
        if (e.endsWith('.yaml') || e.endsWith('.yml')) playbooks.push(e);
        else if (e.endsWith('.tmax-use.ts')) tests.push(e);
      }
      continue;
    }
    // Single file.
    if (abs.endsWith('.yaml') || abs.endsWith('.yml')) playbooks.push(abs);
    else if (abs.endsWith('.tmax-use.ts')) tests.push(abs);
  }

  return { playbooks: dedupe(playbooks).sort(), tests: dedupe(tests).sort() };
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function scanRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (e.name.endsWith('.yaml') || e.name.endsWith('.yml') || e.name.endsWith('.tmax-use.ts')) {
          out.push(full);
        }
      }
    }
  }
  return out;
}

function dedupe<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs));
}

/** Run every playbook + test file sequentially. */
export async function runAll(patterns: readonly string[], opts: RunnerOptions): Promise<SuiteResult> {
  const start = Date.now();
  const { playbooks, tests } = await discoverTargets(patterns, opts);
  const results: TestResult[] = [];

  for (const p of playbooks) {
    results.push(await runPlaybook(p, opts));
  }
  for (const t of tests) {
    results.push(await runTestFile(t, opts));
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return { results, passed, failed, durationMs: Date.now() - start };
}

// Test-only exports.
export const __runnerInternals = { runStep, evaluateExpect, writeSetupFiles, resolveVars, rightE, leftE };
