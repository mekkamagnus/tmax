#!/usr/bin/env bun
/**
 * adw-test.ts — post-build test dispatcher (unit + e2e with resolve loop).
 *
 * After `adw-build.ts` has run `/implement` against a spec, this dispatcher
 * runs the project's unit tests (`bun run test:unit`) and e2e tests
 * (`bun run test:tmax-use`) as a dedicated stage with a resolve-then-rerun loop
 * per track, then writes a structured results bundle for patch-review
 * consumption.
 *
 *   bun adws/adw-test.ts docs/specs/SPEC-063-adw-test.md
 *   bun adws/adw-test.ts 01KVCMJ0QR
 *   bun adws/adw-test.ts --model glm-5.2 docs/specs/SPEC-063-adw-test.md
 *
 * The claude interface (dependency guard + unit/e2e tracks + resolve loop +
 * results writer) lives in ./adws-modules/tester.ts. Single external
 * dependency: the `claude` CLI (for the resolver).
 *
 * Exit codes: 0 = stage ran (pass | gaps); 1 = usage error / missing dependency
 * / unresolvable input (no agents/ dir created); 2 = stage failure after state
 * was written (error event + failed state recorded).
 *
 * File layout per run:
 *   agents/{id}/adw-state.json                 — state only
 *   agents/{id}/tester/events.jsonl            — lifecycle events (streamed)
 *   agents/{id}/tester/unit-resolve-it*.jsonl  — per-failure claude resolver output
 *   agents/{id}/tester/e2e-resolve-it*.jsonl   — per-iteration claude resolver output
 *   agents/{id}/tester/e2e-report-itN/         — tmax-use HTML + JUnit reports
 *   agents/{id}/tester/results.json            — normalized result bundle
 */
import { spawn } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "path";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import {
  TEST_MODEL,
  type TesterDeps,
  type RawRunResult,
  type TrackResult,
  type TestStageResult,
  ensureAvailable,
  runUnitTrack,
  runE2eTrack,
  buildTestStageResult,
  writeResults,
} from "./adws-modules/tester.ts";
import { findWorkspaceBySpecPath } from "./adws-modules/workspace.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const SPECS_DIR = join(PROJECT_ROOT, "docs", "specs");

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-test.ts [--model <id>] [--id <id>] <spec-path-or-adw-id>

Runs unit tests (bun run test:unit) then e2e tests (bun run test:tmax-use) as
an adw pipeline stage with a 2-iteration resolve-then-rerun loop per track.
Prints "<id> <pass|gaps> <spec-path>" on success. E2e is skipped if unit fails.

  --model <id>   Override the default resolve model (${TEST_MODEL}).
  --id <id>      Use a specific workspace id (default: reuse discovered workspace).
  <spec-path>    A docs/specs/{SPEC,BUG,CHORE}-*.md path.
  <adw-id>       A 10-char ULID-timestamp id from a prior adw-build run.

State: ./agents/{id}/adw-state.json; events:
./agents/{id}/tester/events.jsonl; resolver output:
./agents/{id}/tester/{unit,e2e}-resolve-it*.jsonl; result bundle:
./agents/{id}/tester/results.json.`;

export interface ParsedArgs {
  input: string;
  model?: string;
  id?: string;
}

export function parseArgs(argv: string[]): Either<string, ParsedArgs> {
  let input = "";
  let model: string | undefined;
  let id: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    else if (a === "--model") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--model requires a value.");
      model = val;
    } else if (a === "--id") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--id requires a value.");
      if (!ADW_ID_RE.test(val)) return Either.left(`--id must be a 10-char ULID-timestamp id (got "${val}").`);
      id = val;
    } else if (input === "") input = a;
    else return Either.left(`Unexpected extra argument: ${a}`);
  }
  if (!input) return Either.left(`__usage__:${USAGE}`);
  return Either.right({ input, model, id });
}

// ---------------------------------------------------------------------------
// Run-state: adwId() + appendEvent() + writeState()
// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function adwId(): string {
  let ms = Date.now();
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[ms & 31] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function appendEvent(id: string, event: Record<string, unknown>): void {
  const dir = join(AGENTS_DIR, id, "tester");
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  appendFileSync(join(dir, "events.jsonl"), line);
}

function writeState(id: string, state: Record<string, unknown>): TaskEither<string, void> {
  return TaskEither.tryCatch(async () => {
    const dir = join(AGENTS_DIR, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "adw-state.json"), JSON.stringify(state, null, 2) + "\n");
  }, (e) => `writeState: ${(e as Error).message}`);
}

// ---------------------------------------------------------------------------
// Subprocess plumbing: run() + runRaw() + runCapture()
// ---------------------------------------------------------------------------

export interface RunOpts {
  cwd?: string;
  env?: Record<string, string>;
}

function run(cmd: string, args: string[], opts: RunOpts = {}): TaskEither<string, string> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, string>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.on("error", (e) => resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve(Either.right(stdout.trim()));
        else resolve(Either.left((stderr || stdout).trim() || `${cmd} exited with code ${code}`));
      });
    });
  });
}

/** Wall-clock cap on each `bun run test:*` invocation. Catches hangs (e.g. a
 * wedged socket connect with no timeout) so the stage fails fast instead of
 * hanging forever. The full unit suite is ~700s on a clean tree (3000+ tests);
 * 1200s gives headroom for a slower CI box. Override via
 * ADW_TEST_STAGE_TIMEOUT_MS. */
const STAGE_RUN_TIMEOUT_MS = Number(process.env.ADW_TEST_STAGE_TIMEOUT_MS) > 0
  ? Number(process.env.ADW_TEST_STAGE_TIMEOUT_MS)
  : 1_200_000;

function runRaw(cmd: string, args: string[], opts: RunOpts = {}): TaskEither<string, RawRunResult> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, RawRunResult>>((resolve) => {
      // detached: true makes the child a process-group leader so a timeout can
      // SIGKILL the whole tree (bun run → bun test → …), not just the direct
      // child — otherwise a hung grandchild lingers at ~100% CPU and starves
      // the next resolve iteration.
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { process.kill(-child.pid!, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
        resolve(Either.right({
          ok: false,
          exitCode: -1,
          stdout,
          stderr: stderr + `\n[adw-test] runRaw timed out after ${STAGE_RUN_TIMEOUT_MS}ms (killed ${cmd} ${args.join(" ")})\n`,
        }));
      }, STAGE_RUN_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const exitCode = code ?? -1;
        resolve(Either.right({
          ok: exitCode === 0,
          exitCode,
          stdout,
          stderr,
        }));
      });
    });
  });
}

function runCapture(cmd: string, args: string[], opts: RunOpts & { teeTo: string; liveLabel?: string }): TaskEither<string, string> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, string>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let teeBuf = "";
      child.stdout.on("data", (chunk: Buffer | string) => {
        const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stdout += s;
        teeBuf += s;
        let nl: number;
        while ((nl = teeBuf.indexOf("\n")) >= 0) {
          const line = teeBuf.slice(0, nl + 1);
          try { appendFileSync(opts.teeTo, line); } catch { /* ignore */ }
          teeBuf = teeBuf.slice(nl + 1);
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.on("error", (e) => resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)));
      child.on("close", (code) => {
        if (teeBuf.length > 0) {
          try { appendFileSync(opts.teeTo, teeBuf); } catch { /* ignore */ }
        }
        if (code === 0) resolve(Either.right(stdout.trim()));
        else resolve(Either.left((stderr || stdout).trim() || `${cmd} exited with code ${code}`));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Input resolution: spec path OR adw-id → {specPath, source}
// ---------------------------------------------------------------------------

const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export interface ResolvedInput {
  specPath: string;
  source: "path" | "adw-id";
}

export function resolveInputFrom(input: string, agentsDir: string, specsDir: string): Either<string, ResolvedInput> {
  const base = input.split("/").pop() ?? input;
  if (/^(SPEC|BUG|CHORE)-/.test(base)) {
    const direct = input.startsWith("/") ? input : join(PROJECT_ROOT, input);
    if (existsSync(direct)) return Either.right({ specPath: direct, source: "path" });
    const inSpecs = join(specsDir, base);
    if (existsSync(inSpecs)) return Either.right({ specPath: inSpecs, source: "path" });
    return Either.left(`resolve: spec file not found: ${input}`);
  }
  if (ADW_ID_RE.test(input)) {
    const stateFile = join(agentsDir, input, "adw-state.json");
    if (!existsSync(stateFile)) return Either.left(`resolve: no agents/${input}/adw-state.json for adw-id ${input}`);
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
      const specPath = state.spec_path as string | undefined;
      if (!specPath) {
        return Either.left(`resolve: adw-id ${input} has no spec_path in its state`);
      }
      return Either.right({ specPath, source: "adw-id" as const });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Either.left(`resolve: failed to parse agents/${input}/adw-state.json: ${msg}`);
    }
  }
  return Either.left(`resolve: "${input}" is neither a spec path (SPEC|BUG|CHORE-*.md) nor a 10-char adw-id`);
}

function resolveInput(input: string): Either<string, ResolvedInput> {
  return resolveInputFrom(input, AGENTS_DIR, SPECS_DIR);
}

// ---------------------------------------------------------------------------
// Pipeline types
// ---------------------------------------------------------------------------

interface Seed {
  id: string;
  model: string;
  input: string;
  idOverride?: string;
}

interface Resolved extends Seed {
  specPath: string;
  source: "path" | "adw-id";
}

/** Result of a successful test run. */
export interface TestOutcome {
  id: string;
  verdict: "pass" | "gaps";
  specPath: string;
}

// ---------------------------------------------------------------------------
// runTest — composed pipeline
// ---------------------------------------------------------------------------

export function runTest(
  input: string,
  modelOverride?: string,
  id?: string,
): Promise<Either<string, TestOutcome>> {
  const deps: TesterDeps = { run, runRaw, runCapture };
  return runTestWithDeps(input, { modelOverride, id, deps });
}

interface TestOptions {
  modelOverride?: string;
  id?: string;
  deps?: TesterDeps;
}

export function runTestWithDeps(
  input: string,
  options: TestOptions,
): Promise<Either<string, TestOutcome>> {
  const deps: TesterDeps = options.deps ?? { run, runRaw, runCapture };

  const ownsState = process.env.ADW_ORCHESTRATED !== "1";

  // Hoisted: resolve input BEFORE minting the id.
  const resolvedInput = resolveInput(input);
  if (Either.isLeft(resolvedInput)) return Promise.resolve(resolvedInput);

  // Select id: explicit --id > adw-id input > discovered workspace > fresh mint.
  const isAdwId = ADW_ID_RE.test(input);
  let runId: string;
  if (options.id) {
    runId = options.id;
  } else if (isAdwId) {
    runId = input;
  } else if (ownsState) {
    const discovered = findWorkspaceBySpecPath(AGENTS_DIR, resolvedInput.right.specPath);
    runId = discovered ?? adwId();
    if (discovered) {
      process.stderr.write(`adw-test: reusing workspace ${discovered} for ${resolvedInput.right.specPath}\n`);
    }
  } else {
    runId = adwId();
  }

  const recordState = (stateId: string, state: Record<string, unknown>): TaskEither<string, void> =>
    ownsState ? writeState(stateId, state) : TaskEither.right<void, string>(undefined);

  const writePhase = (line: string): void => {
    try { process.stderr.write(line); } catch { /* best-effort */ }
  };

  const currentRun: Resolved = {
    id: runId,
    model: options.modelOverride ?? TEST_MODEL,
    input,
    idOverride: options.id,
    specPath: resolvedInput.right.specPath,
    source: resolvedInput.right.source,
  };

  const program = TaskEither
    .right<Resolved, string>(currentRun)
    // Step 0: dependency guard — claude on PATH.
    .flatMap((s) => ensureAvailable(deps, PROJECT_ROOT).map(() => s))
    // Step 1: write initial state + start event.
    .flatMap((ctx) => recordState(ctx.id, {
      adw_id: ctx.id,
      spec_path: ctx.specPath,
      source: ctx.source,
      model: ctx.model,
      status: "running",
    })
      .tap(() => appendEvent(ctx.id, {
        event: "start",
        spec_path: ctx.specPath,
        source: ctx.source,
        model: ctx.model,
      }))
      .map(() => ctx))
    // Step 2: unit track.
    .flatMap((ctx) => {
      writePhase(`[test] unit (iteration 1/${1 + 2})\n`);
      return runUnitTrack(deps, PROJECT_ROOT, AGENTS_DIR, ctx.id, ctx.model, {
        onIteration: (it, max) => writePhase(`[test] unit (iteration ${it}/${max})\n`),
        onResolve: (name, it) => {
          appendEvent(ctx.id, { event: "unit_resolve", iteration: it, failure: name });
        },
      })
        .tap((unit: TrackResult) => appendEvent(ctx.id, {
          event: "unit_track",
          ok: unit.ok,
          exit_code: unit.exitCode,
          passed: unit.passed,
          failed: unit.failed,
          iterations: unit.iterations,
          duration_ms: unit.durationMs,
          ...(unit.reportDir ? { report_dir: unit.reportDir } : {}),
        }))
        .map((unit: TrackResult) => ({ ...ctx, unit }));
    })
    // Step 3: e2e track (skipped if unit failed).
    .flatMap((ctx: Resolved & { unit: TrackResult }) => {
      if (!ctx.unit.ok) {
        appendEvent(ctx.id, { event: "e2e_skipped", reason: "unit track failed" });
        const result = buildTestStageResult(ctx.unit, undefined, true);
        return writeResults(AGENTS_DIR, ctx.id, result)
          .tap(() => appendEvent(ctx.id, { event: "result", verdict: result.verdict, e2e_skipped: true }))
          .flatMap(() => recordState(ctx.id, {
            adw_id: ctx.id,
            spec_path: ctx.specPath,
            source: ctx.source,
            model: ctx.model,
            status: result.verdict,
            verdict: result.verdict,
          }).map(() => ({
            id: ctx.id,
            verdict: result.verdict,
            specPath: ctx.specPath,
          }) as TestOutcome));
      }
      writePhase(`[test] e2e (iteration 1/${1 + 2})\n`);
      return runE2eTrack(deps, PROJECT_ROOT, AGENTS_DIR, ctx.id, ctx.model, {
        onIteration: (it, max) => writePhase(`[test] e2e (iteration ${it}/${max})\n`),
        onResolve: (name, it) => {
          appendEvent(ctx.id, { event: "e2e_resolve", iteration: it, failure: name });
        },
      })
        .tap((e2e: TrackResult) => appendEvent(ctx.id, {
          event: "e2e_track",
          ok: e2e.ok,
          exit_code: e2e.exitCode,
          passed: e2e.passed,
          failed: e2e.failed,
          iterations: e2e.iterations,
          duration_ms: e2e.durationMs,
          ...(e2e.reportDir ? { report_dir: e2e.reportDir } : {}),
        }))
        .flatMap((e2e: TrackResult) => {
          const result = buildTestStageResult(ctx.unit, e2e, false);
          return writeResults(AGENTS_DIR, ctx.id, result)
            .tap(() => appendEvent(ctx.id, {
              event: "result",
              verdict: result.verdict,
              e2e_skipped: false,
              ...(e2e.reportDir ? { e2e_report_dir: e2e.reportDir } : {}),
            }))
            .flatMap(() => recordState(ctx.id, {
              adw_id: ctx.id,
              spec_path: ctx.specPath,
              source: ctx.source,
              model: ctx.model,
              status: result.verdict,
              verdict: result.verdict,
            }).map(() => ({
              id: ctx.id,
              verdict: result.verdict,
              specPath: ctx.specPath,
            }) as TestOutcome));
        });
    });

  return program.run().then((result) => {
    if (Either.isLeft(result)) {
      if (currentRun) {
        appendEvent(currentRun.id, { event: "error", detail: result.left });
        return recordState(currentRun.id, {
          adw_id: currentRun.id,
          spec_path: currentRun.specPath,
          source: currentRun.source,
          model: currentRun.model,
          status: "failed",
        }).run().then(() => Either.left(result.left));
      }
      return Either.left(result.left);
    }
    return Either.right(result.right);
  });
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  if (Either.isLeft(parsed)) {
    if (parsed.left.startsWith("__help__:")) {
      process.stdout.write(parsed.left.slice("__help__:".length) + "\n");
      return Promise.resolve(0);
    }
    if (parsed.left.startsWith("__usage__:")) {
      process.stderr.write(parsed.left.slice("__usage__:".length) + "\n");
      return Promise.resolve(1);
    }
    process.stderr.write(`Error: ${parsed.left}\n`);
    return Promise.resolve(1);
  }

  return runTest(parsed.right.input, parsed.right.model, parsed.right.id).then((result) => {
    if (Either.isLeft(result)) {
      process.stderr.write(`Error: ${result.left}\n`);
      return 2;
    }
    process.stdout.write(`${result.right.id} ${result.right.verdict} ${result.right.specPath}\n`);
    return 0;
  });
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
