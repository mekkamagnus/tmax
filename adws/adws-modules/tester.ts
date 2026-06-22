/**
 * tester.ts — the LLM interface for the adw test dispatcher.
 *
 * Owns the dependency guard (ensureAvailable), the unit + e2e tracks with their
 * resolve-then-rerun loops, output parsers for `bun test` and tmax-use JUnit
 * XML, and the structured results bundle writer. No CLI, no argv, no run-state
 * tracking — those live in the caller (adw-test.ts).
 *
 * Subprocess execution is injected (TesterDeps) so this module has no direct
 * dependency on child_process and is unit-testable with a mock. Mirrors the
 * PatchReviewerDeps / BuilderDeps convention.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Either, TaskEither } from "../../src/utils/task-either.ts";

const CLAUDE = "claude";

/** Default model for the resolve dispatcher. Matches BUILD_MODEL / PATCH_REVIEW_MODEL (stability). */
export const TEST_MODEL = "glm-5.1";

/** Max resolve-then-rerun iterations per track (suite runs at most 1 + MAX_*_ITERATIONS times). */
export const MAX_UNIT_ITERATIONS = 2;
export const MAX_E2E_ITERATIONS = 2;

/** Max output size retained per iteration (chars). */
const MAX_OUTPUT_CHARS = 20_000;
/** Max failure message size retained (chars). */
const MAX_FAILURE_CHARS = 2_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a subprocess that completed (even with non-zero exit). Left = spawn/setup failure. */
export interface RawRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injected subprocess helpers. Mirrors PatchReviewerDeps. */
export interface TesterDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
  runRaw: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, RawRunResult>;
  runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string; liveLabel?: string }) => TaskEither<string, string>;
}

/** One parsed failure entry from a test runner's output. */
export interface TestFailure {
  /** "file.ts > suite > test name" or best-effort equivalent. */
  name: string;
  /** Error/assertion output (truncated to MAX_FAILURE_CHARS). */
  message: string;
}

/** Result of a single track (unit or e2e). */
export interface TrackResult {
  /** True iff exit 0 and parsed pass count > 0 with zero fails (or sentinel skip). */
  ok: boolean;
  exitCode: number;
  passed: number;
  failed: number;
  durationMs: number;
  /** How many times the suite ran (1 = initial only). */
  iterations: number;
  /** Parsed failures from the last iteration's output. */
  failures: TestFailure[];
  /** Last iteration's combined stdout+stderr (truncated to MAX_OUTPUT_CHARS). */
  output: string;
  /** E2E track only: tmax-use --output dir. */
  reportDir?: string;
}

/** Full result bundle for the test stage. */
export interface TestStageResult {
  unit: TrackResult;
  /** Undefined when e2e did not run because unit failed. */
  e2e?: TrackResult;
  /** True when e2e did not run because unit failed. */
  e2eSkipped: boolean;
  verdict: "pass" | "gaps";
}

// ---------------------------------------------------------------------------
// ensureAvailable — dependency guard
// ---------------------------------------------------------------------------

export function ensureAvailable(deps: TesterDeps, cwd: string): TaskEither<string, void> {
  return deps.run(CLAUDE, ["--version"], { cwd })
    .mapLeft(() =>
      `The \`claude\` CLI was not runnable. Install Claude Code and ensure \`claude\` is on PATH, then retry.`,
    )
    .map(() => undefined);
}

// ---------------------------------------------------------------------------
// Output parsing — bun test summary
// ---------------------------------------------------------------------------

export interface ParsedBunSummary {
  passed: number;
  failed: number;
  failures: TestFailure[];
}

/**
 * Parse `bun test` summary output. Bun's test runner prints lines like:
 *   "<N> pass\n<M> fail\n<K> expect() calls\nRan <X> tests across <Y> files"
 * Each failing test is preceded by a "<file path>" header and a "✗ <name>" line
 * followed by the error block. Defensive: never throws; falls back to ✓/✗ counts.
 */
export function parseBunTestOutput(stdout: string, stderr: string): ParsedBunSummary {
  const combined = `${stdout}\n${stderr}`;
  const failures = extractBunFailures(combined);

  // Try to parse the explicit summary first. Bun emits "<N> pass" / "<M> fail".
  const passMatch = combined.match(/(\d+)\s+pass\b/);
  const failMatch = combined.match(/(\d+)\s+fail\b/);
  if (passMatch || failMatch) {
    const passed = passMatch ? parseInt(passMatch[1]!, 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1]!, 10) : 0;
    return { passed, failed, failures: failures.length > 0 ? failures : (failed > 0 ? [] : []) };
  }

  // Fall back to counting check/cross markers.
  const checkCount = (combined.match(/✓/g) ?? []).length;
  const crossCount = (combined.match(/✗/g) ?? []).length;
  if (checkMatchSummary(combined)) {
    return { passed: checkCount, failed: crossCount, failures };
  }
  return { passed: 0, failed: 0, failures: [] };
}

function checkMatchSummary(s: string): boolean {
  // Only use ✓/✗ counts when the output clearly looks like a test runner dump
  // (has either symbol) — avoids spurious counts on malformed/empty output.
  return /✓|✗/.test(s);
}

/** Extract individual failure entries from `bun test` output. */
function extractBunFailures(combined: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const lines = combined.split("\n");

  // Bun emits a header like "(test name)" or "file.test.ts:" before each ✗.
  // We capture the file context from preceding `(path)` lines and the message
  // from the indented error block following the ✗ line.
  let currentFile = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Track the most recent file path reference (bun prints it in parentheses).
    const fileMatch = line.match(/\(([^()]+\.test\.ts)\)/);
    if (fileMatch) {
      currentFile = fileMatch[1]!;
    }

    const failMatch = line.match(/^\s*✗\s*(.+)$/);
    if (!failMatch) continue;
    const testName = failMatch[1]!.trim();
    const name = currentFile ? `${currentFile} > ${testName}` : testName;

    // Capture the indented error block that follows.
    const messageLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      // Stop on the next test marker or the summary.
      if (/^\s*✓|^\s*✗|^\s*\d+\s+(pass|fail)\b/.test(next)) break;
      if (next.trim() === "") {
        // Allow one blank line within the error block; two blank lines end it.
        if (messageLines.length > 0 && messageLines[messageLines.length - 1] === "") break;
        messageLines.push("");
        continue;
      }
      messageLines.push(next);
    }
    const message = messageLines.join("\n").trim().slice(0, MAX_FAILURE_CHARS);
    failures.push({ name, message });
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Output parsing — tmax-use JUnit XML
// ---------------------------------------------------------------------------

export interface ParsedTmaxUseResult {
  ok: boolean;
  passed: number;
  failed: number;
}

/**
 * Parse a tmax-use run's exit code + (optional) JUnit XML report dir. tmax-use's
 * runner exits 0 on all-pass, 1 on any failure. The JUnit report — when written
 * — gives structured counts. Zero-dependency string scan.
 */
export function parseTmaxUseExitCode(result: RawRunResult, reportDir?: string): ParsedTmaxUseResult {
  const ok = result.ok;
  if (!reportDir || !existsSync(reportDir)) {
    return { ok, passed: 0, failed: 0 };
  }
  const junit = readJUnitXml(reportDir);
  if (!junit) return { ok, passed: 0, failed: 0 };
  return { ok, passed: junit.passed, failed: junit.failed };
}

/** Scan a report dir for JUnit XML and return summed counts. */
function readJUnitXml(reportDir: string): { passed: number; failed: number } | null {
  let xml: string | null = null;
  try {
    const entries = readdirSync(reportDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && (e.name.endsWith(".xml") || e.name.endsWith("-junit.xml"))) {
        const candidate = join(reportDir, e.name);
        const content = readFileSync(candidate, "utf8");
        if (content.includes("<testsuite")) {
          xml = content;
          break;
        }
      }
    }
  } catch {
    return null;
  }
  if (!xml) return null;

  // Prefer the root <testsuites tests="N" failures="M" errors="E"> aggregate.
  const rootMatch = xml.match(/<testsuites\b[^>]*\btests="(\d+)"[^>]*\bfailures="(\d+)"(?:[^>]*\berrors="(\d+)")?/);
  if (rootMatch) {
    const tests = parseInt(rootMatch[1]!, 10);
    const failures = parseInt(rootMatch[2]!, 10);
    const errors = rootMatch[3] ? parseInt(rootMatch[3], 10) : 0;
    const failed = failures + errors;
    return { passed: Math.max(tests - failed, 0), failed };
  }

  // Otherwise sum every <testsuite ...> element.
  const suiteMatches = xml.match(/<testsuite\b[^>]*\btests="(\d+)"[^>]*\bfailures="(\d+)"(?:[^>]*\berrors="(\d+)")?/g);
  if (!suiteMatches || suiteMatches.length === 0) return null;
  let totalTests = 0;
  let totalFailed = 0;
  for (const raw of suiteMatches) {
    const m = raw.match(/\btests="(\d+)"[^>]*\bfailures="(\d+)"(?:[^>]*\berrors="(\d+)")?/);
    if (!m) continue;
    totalTests += parseInt(m[1]!, 10);
    totalFailed += parseInt(m[2]!, 10) + (m[3] ? parseInt(m[3], 10) : 0);
  }
  return { passed: Math.max(totalTests - totalFailed, 0), failed: totalFailed };
}

// ---------------------------------------------------------------------------
// Helpers — truncate output, sanitize name
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function sanitizeName(name: string): string {
  // Safe filename fragment from a test name — replace separators, etc.
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "test";
}

// ---------------------------------------------------------------------------
// Track execution — unit
// ---------------------------------------------------------------------------

export interface TrackCallbacks {
  /** Fired before each suite execution. */
  onIteration?: (iteration: number, maxIterations: number) => void;
  /** Fired before each resolve dispatch. */
  onResolve?: (failureName: string, iteration: number) => void;
}

/**
 * Run the unit track: `bun run test:unit` with a resolve-then-rerun loop.
 *
 * The suite runs once initially, then up to MAX_UNIT_ITERATIONS more times after
 * resolve attempts (total ≤ 1 + MAX_UNIT_ITERATIONS). A failing track returns
 * Right(TrackResult { ok: false }) — a track failure is a stage outcome, not a
 * stage error.
 */
export function runUnitTrack(
  deps: TesterDeps,
  cwd: string,
  agentsDir: string,
  id: string,
  model: string = TEST_MODEL,
  callbacks: TrackCallbacks = {},
): TaskEither<string, TrackResult> {
  return TaskEither.from(async () => {
    const start = Date.now();
    let iterations = 0;
    let last: { exitCode: number; passed: number; failed: number; failures: TestFailure[]; output: string } = {
      exitCode: -1,
      passed: 0,
      failed: 0,
      failures: [],
      output: "",
    };

    const maxSuiteRuns = 1 + MAX_UNIT_ITERATIONS;
    for (let cycle = 0; cycle < maxSuiteRuns; cycle++) {
      iterations++;
      callbacks.onIteration?.(iterations, maxSuiteRuns);

      const res = await deps.runRaw("bun", ["run", "test:unit"], { cwd }).run();
      if (Either.isLeft(res)) {
        return Either.left(`runUnitTrack: bun spawn failed: ${res.left}`);
      }
      const raw = res.right;
      const parsed = parseBunTestOutput(raw.stdout, raw.stderr);
      const output = truncate(`${raw.stdout}\n${raw.stderr}`.trim(), MAX_OUTPUT_CHARS);
      last = { exitCode: raw.exitCode, passed: parsed.passed, failed: parsed.failed, failures: parsed.failures, output };

      const ok = raw.ok && parsed.failed === 0 && (parsed.passed > 0 || raw.exitCode === 0);
      if (ok) {
        return Either.right<TrackResult, string>({
          ok: true,
          exitCode: raw.exitCode,
          passed: parsed.passed,
          failed: 0,
          durationMs: Date.now() - start,
          iterations,
          failures: [],
          output,
        });
      }

      // If we have resolve attempts left, dispatch a resolver per failure.
      if (cycle < MAX_UNIT_ITERATIONS) {
        for (const failure of parsed.failures) {
          callbacks.onResolve?.(failure.name, cycle + 1);
          // Best-effort: never let a single resolve failure abort the loop.
          try {
            const resolveRes = await resolveUnitTest(deps, cwd, agentsDir, id, failure, model, cycle + 1).run();
            if (Either.isLeft(resolveRes)) {
              // Swallow — best-effort. The next suite run will see if the
              // failure persists.
            }
          } catch {
            // ignore — loop continues
          }
        }
        // If parse found no failures but the suite still failed, dispatch a
        // single generic resolver with the raw output.
        if (parsed.failures.length === 0) {
          const genericFailure: TestFailure = {
            name: "unit-suite",
            message: output.slice(0, MAX_FAILURE_CHARS),
          };
          callbacks.onResolve?.(genericFailure.name, cycle + 1);
          try {
            await resolveUnitTest(deps, cwd, agentsDir, id, genericFailure, model, cycle + 1).run();
          } catch { /* best-effort */ }
        }
        continue;
      }

      // Exhausted — return Right with ok: false.
      return Either.right<TrackResult, string>({
        ok: false,
        exitCode: raw.exitCode,
        passed: parsed.passed,
        failed: parsed.failed,
        durationMs: Date.now() - start,
        iterations,
        failures: parsed.failures,
        output,
      });
    }

    // Unreachable but TypeScript needs a return path.
    return Either.right<TrackResult, string>({
      ok: false,
      exitCode: last.exitCode,
      passed: last.passed,
      failed: last.failed,
      durationMs: Date.now() - start,
      iterations,
      failures: last.failures,
      output: last.output,
    });
  });
}

/**
 * Resolve a single failing unit test via `claude -p`. Focused prompt — fix this
 * one test, don't touch unrelated files. Best-effort: returns Left on dispatch
 * failure but the caller never propagates Left from resolve.
 */
export function resolveUnitTest(
  deps: TesterDeps,
  cwd: string,
  agentsDir: string,
  id: string,
  failure: TestFailure,
  model: string = TEST_MODEL,
  iteration: number = 1,
): TaskEither<string, void> {
  const sanitized = sanitizeName(failure.name);
  const teeTo = join(agentsDir, id, "tester", `unit-resolve-it${iteration}-${sanitized}.jsonl`);
  const prompt = `The following unit test is failing. Fix the root cause (the code under test, not the test, unless the test itself is wrong). Failing test: \`${failure.name}\`. Error output:
\`\`\`
${failure.message}
\`\`\`
Do not touch unrelated files.`;

  return TaskEither.from(async () => {
    try {
      mkdirSync(dirname(teeTo), { recursive: true });
    } catch { /* best-effort */ }
    const res = await deps.runCapture(
      CLAUDE,
      ["-p", "--model", model, "--verbose", "--output-format", "stream-json", prompt],
      { cwd, teeTo },
    ).run();
    // Best-effort: never return Left (the loop continues regardless). We map
    // to Right here so a single resolve failure doesn't abort the loop.
    if (Either.isLeft(res)) {
      return Either.right<undefined, string>(undefined);
    }
    return Either.right<undefined, string>(undefined);
  });
}

// ---------------------------------------------------------------------------
// Track execution — e2e (tmax-use)
// ---------------------------------------------------------------------------

/**
 * Run the e2e track: `bun run test:tmax-use` with resolve-then-rerun loop.
 * Skipped (sentinel pass) when no tmax-use targets exist.
 */
export function runE2eTrack(
  deps: TesterDeps,
  cwd: string,
  agentsDir: string,
  id: string,
  model: string = TEST_MODEL,
  callbacks: TrackCallbacks = {},
): TaskEither<string, TrackResult> {
  return TaskEither.from(async () => {
    // Skip detection — no targets means sentinel pass.
    if (!hasTmaxUseTargets(cwd)) {
      return Either.right<TrackResult, string>({
        ok: true,
        exitCode: 0,
        passed: 0,
        failed: 0,
        durationMs: 0,
        iterations: 0,
        failures: [],
        output: "no tmax-use targets",
      });
    }

    const start = Date.now();
    let iterations = 0;
    let last: { exitCode: number; passed: number; failed: number; failures: TestFailure[]; output: string; reportDir?: string } = {
      exitCode: -1,
      passed: 0,
      failed: 0,
      failures: [],
      output: "",
    };

    const maxSuiteRuns = 1 + MAX_E2E_ITERATIONS;
    for (let cycle = 0; cycle < maxSuiteRuns; cycle++) {
      iterations++;
      callbacks.onIteration?.(iterations, maxSuiteRuns);

      const reportDir = join(agentsDir, id, "tester", `e2e-report-it${iterations}`);
      const res = await deps.runRaw("bun", [
        "run", "test:tmax-use",
        "--output", reportDir,
        "--reporter", "all",
      ], { cwd }).run();
      if (Either.isLeft(res)) {
        return Either.left(`runE2eTrack: bun spawn failed: ${res.left}`);
      }
      const raw = res.right;
      const parsed = parseTmaxUseExitCode(raw, reportDir);
      const output = truncate(`${raw.stdout}\n${raw.stderr}`.trim(), MAX_OUTPUT_CHARS);
      const failures = parsed.failed > 0 ? [{ name: "tmax-use e2e", message: output.slice(0, MAX_FAILURE_CHARS) }] : [];
      last = { exitCode: raw.exitCode, passed: parsed.passed, failed: parsed.failed, failures, output, reportDir };

      if (raw.ok) {
        return Either.right<TrackResult, string>({
          ok: true,
          exitCode: raw.exitCode,
          passed: parsed.passed,
          failed: 0,
          durationMs: Date.now() - start,
          iterations,
          failures: [],
          output,
          reportDir,
        });
      }

      if (cycle < MAX_E2E_ITERATIONS) {
        callbacks.onResolve?.("tmax-use e2e", cycle + 1);
        try {
          const resolveRes = await resolveE2eTest(deps, cwd, agentsDir, id, reportDir, output, model, cycle + 1).run();
          if (Either.isLeft(resolveRes)) { /* best-effort */ }
        } catch { /* best-effort */ }
        continue;
      }

      return Either.right<TrackResult, string>({
        ok: false,
        exitCode: raw.exitCode,
        passed: parsed.passed,
        failed: parsed.failed,
        durationMs: Date.now() - start,
        iterations,
        failures,
        output,
        reportDir,
      });
    }

    return Either.right<TrackResult, string>({
      ok: false,
      exitCode: last.exitCode,
      passed: last.passed,
      failed: last.failed,
      durationMs: Date.now() - start,
      iterations,
      failures: last.failures,
      output: last.output,
      ...(last.reportDir ? { reportDir: last.reportDir } : {}),
    });
  });
}

/**
 * Resolve a failing e2e playbook run via `claude -p`. Best-effort, never throws.
 */
export function resolveE2eTest(
  deps: TesterDeps,
  cwd: string,
  agentsDir: string,
  id: string,
  reportDir: string,
  outputExcerpt: string,
  model: string = TEST_MODEL,
  iteration: number = 1,
): TaskEither<string, void> {
  const teeTo = join(agentsDir, id, "tester", `e2e-resolve-it${iteration}.jsonl`);
  const prompt = `The tmax-use e2e run failed. Review the report at \`${reportDir}\` and the failing playbook/test output below. Fix the root cause (the editor code or the playbook — do not weaken assertions unless the assertion is genuinely wrong). Output:
\`\`\`
${outputExcerpt.slice(0, MAX_FAILURE_CHARS)}
\`\`\``;

  return TaskEither.from(async () => {
    try {
      mkdirSync(dirname(teeTo), { recursive: true });
    } catch { /* best-effort */ }
    const res = await deps.runCapture(
      CLAUDE,
      ["-p", "--model", model, "--verbose", "--output-format", "stream-json", prompt],
      { cwd, teeTo },
    ).run();
    // Best-effort — never propagate Left.
    return Either.right<undefined, string>(undefined);
  });
}

/** True if `tmax-use/playbooks/` or `tmax-use/tests/` contains any targets. */
function hasTmaxUseTargets(cwd: string): boolean {
  try {
    const targets = [
      join(cwd, "tmax-use/playbooks"),
      join(cwd, "tmax-use/tests"),
    ];
    for (const dir of targets) {
      const entries = readdirSync(dir, { withFileTypes: true });
      if (entries.some((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml") || e.name.endsWith(".tmax-use.ts")))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Results bundle
// ---------------------------------------------------------------------------

/** Compute the stage verdict from track results. Pure function. */
export function buildTestStageResult(
  unit: TrackResult,
  e2e: TrackResult | undefined,
  e2eSkipped: boolean,
): TestStageResult {
  // `pass` iff unit passed and (e2e passed OR e2e skipped-due-to-no-targets).
  const e2ePassed = e2e === undefined ? e2eSkipped : e2e.ok;
  const verdict: "pass" | "gaps" = unit.ok && e2ePassed ? "pass" : "gaps";
  return { unit, ...(e2e !== undefined ? { e2e } : {}), e2eSkipped, verdict };
}

/** Write `agents/{id}/tester/results.json` — the normalized bundle. */
export function writeResults(
  agentsDir: string,
  id: string,
  result: TestStageResult,
  clock: () => Date = () => new Date(),
): TaskEither<string, void> {
  return TaskEither.tryCatch(async () => {
    const dir = join(agentsDir, id, "tester");
    await Promise.resolve(mkdirSync(dir, { recursive: true }));
    const bundle = {
      adw_id: id,
      written_at: clock().toISOString(),
      ...result,
    };
    writeFileSync(join(dir, "results.json"), JSON.stringify(bundle, null, 2) + "\n");
  }, (e) => `writeResults: ${(e as Error).message}`);
}
