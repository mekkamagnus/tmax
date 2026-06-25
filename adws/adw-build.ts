#!/usr/bin/env bun
/**
 * adw-build.ts — spec → implementation (claude-driven).
 *
 * Takes a spec (by path or by adw-id), dispatches `claude -p /implement` against
 * it, and records the run under agents/{build-id}/. Mirrors adw-spec-review.ts's
 * structure (adw-id minting, agents/{adw-id}/ state + per-agent events,
 * <adw-id> <spec-path> stdout contract).
 *
 *   bun adws/adw-build.ts docs/specs/SPEC-056-browse-url.md
 *   bun adws/adw-build.ts 01KVCMJ0QR
 *   bun adws/adw-build.ts --model glm-4.7 docs/specs/CHORE-30-adw-build.md
 *
 * The claude interface (dependency guard + build) lives in
 * ./adws-modules/builder.ts. Single external dependency: the `claude` CLI,
 * resolved by the module.
 *
 * Exit codes: 0 = built; 1 = usage error / missing dependency / unresolvable
 * input (no agents/ dir created); 2 = build failure after state was written
 * (error event + failed state recorded).
 *
 * File layout per run:
 *   agents/{build-id}/adw-state.json           — state only (id, spec_path, model, status, base_sha?)
 *   agents/{build-id}/builder/events.jsonl     — build lifecycle events (streamed)
 *   agents/{build-id}/builder/raw-output.jsonl — claude /implement output (streamed)
 */
import { spawn } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "path";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import { BUILD_MODEL, type BuilderDeps, build, ensureAvailable } from "./adws-modules/builder.ts";
import { formatToolUseLine } from "./adws-modules/live-filter.ts";
import { findWorkspaceBySpecPath } from "./adws-modules/workspace.ts";
import { withClaude529Retry } from "./claude-529-retry.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const SPECS_DIR = join(PROJECT_ROOT, "docs", "specs");

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-build.ts [--model <id>] <spec-path-or-adw-id>

Dispatches \`claude -p /implement\` against a spec and records the run. Prints
"<build-id> <spec-path>" on success.

  --model <id>   Override the default implement model (${BUILD_MODEL}). Use this
                 for the rare spec that needs a larger context window, or as a
                 fallback if the default model is unhealthy on the gateway.
  <spec-path>    A docs/specs/{SPEC,BUG,CHORE}-*.md path.
  <adw-id>       A 10-char ULID-timestamp id from a prior adw-plan or
                 adw-spec-review run; resolves to that run's spec_path (via
                 agents/<adw-id>/adw-state.json).

State: ./agents/{build-id}/adw-state.json; build events:
./agents/{build-id}/builder/events.jsonl; claude output:
./agents/{build-id}/builder/raw-output.jsonl.`;

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

/** ULID timestamp portion: 48-bit ms-since-epoch → 10 chars Crockford Base32. */
function adwId(): string {
  let ms = Date.now();
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[ms & 31] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

/**
 * Append a single lifecycle event as one JSON line to the agent's events file.
 * Sync, append-only — survives crashes. Each event is on disk immediately.
 */
function appendEvent(id: string, agent: string, event: Record<string, unknown>): void {
  const dir = join(AGENTS_DIR, id, agent);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  appendFileSync(join(dir, "events.jsonl"), line);
}

/**
 * Write the run-state file (id, spec_path, model, status — no events).
 * Called at most twice: after start and after result/error.
 */
function writeState(id: string, state: Record<string, unknown>): TaskEither<string, void> {
  return TaskEither.tryCatch(async () => {
    const dir = join(AGENTS_DIR, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "adw-state.json"), JSON.stringify(state, null, 2) + "\n");
  }, (e) => `writeState: ${(e as Error).message}`);
}

// ---------------------------------------------------------------------------
// Subprocess plumbing: run() + runCapture() as TaskEither
// ---------------------------------------------------------------------------

export interface RunOpts {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Spawn, capture stdout/stderr. Returns TaskEither (lazy, composable).
 * Left = non-zero exit (error = stderr||stdout); Right = trimmed stdout.
 */
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

/**
 * runCapture: like run, but tees stdout to `teeTo` path line-by-line as it
 * arrives (via sync appendFileSync — acceptable for line-at-a-point small writes
 * that must survive a crash). Returns TaskEither (lazy).
 */
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
        // Tee line-by-line: flush complete lines as they arrive.
        teeBuf += s;
        let nl: number;
        while ((nl = teeBuf.indexOf("\n")) >= 0) {
          const line = teeBuf.slice(0, nl + 1);
          try { appendFileSync(opts.teeTo, line); } catch { /* ignore */ }
          // §C: when liveLabel is set, filter and emit tool_use lines to stderr.
          if (opts.liveLabel) {
            try {
              const filtered = formatToolUseLine(opts.liveLabel, line.trimEnd());
              if (filtered) process.stderr.write(filtered + "\n");
            } catch { /* best-effort — never crash on live output */ }
          }
          teeBuf = teeBuf.slice(nl + 1);
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.on("error", (e) => resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)));
      child.on("close", (code) => {
        // Flush trailing partial line
        if (teeBuf.length > 0) {
          try { appendFileSync(opts.teeTo, teeBuf); } catch { /* ignore */ }
          if (opts.liveLabel) {
            try {
              const filtered = formatToolUseLine(opts.liveLabel, teeBuf.trimEnd());
              if (filtered) process.stderr.write(filtered + "\n");
            } catch { /* best-effort */ }
          }
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

/**
 * resolveInputFrom: the parameterized form (takes the agents dir explicitly) so
 * it's unit-testable against a temp fixture without touching real agents/.
 * resolveInput is a thin wrapper that calls this with the real AGENTS_DIR.
 */
export function resolveInputFrom(input: string, agentsDir: string, specsDir: string): Either<string, ResolvedInput> {
  // Case 1: a path under docs/specs/ naming a SPEC/BUG/CHORE file.
  const base = input.split("/").pop() ?? input;
  if (/^(SPEC|BUG|CHORE)-/.test(base)) {
    const direct = input.startsWith("/") ? input : join(PROJECT_ROOT, input);
    if (existsSync(direct)) return Either.right({ specPath: direct, source: "path" });
    // Maybe it's just a bare filename living in SPECS_DIR.
    const inSpecs = join(specsDir, base);
    if (existsSync(inSpecs)) return Either.right({ specPath: inSpecs, source: "path" });
    return Either.left(`resolve: spec file not found: ${input}`);
  }
  // Case 2: an adw-id → read state, find spec_path.
  if (ADW_ID_RE.test(input)) {
    const stateFile = join(agentsDir, input, "adw-state.json");
    if (!existsSync(stateFile)) return Either.left(`resolve: no agents/${input}/adw-state.json for adw-id ${input}`);
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
      const specPath = state.spec_path as string | undefined;
      if (!specPath) {
        return Either.left(
          `resolve: adw-id ${input} has no spec_path in its state (was it a plan run? pass the spec path directly)`,
        );
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
// Best-effort git trace capture (Task 4 of CHORE-30)
// ---------------------------------------------------------------------------

export interface GitTrace {
  base_sha?: string;
  diff_stat?: string;
}

/**
 * Best-effort base SHA + diff-stat. Never fails the pipeline: a git failure (not
 * a repo, git missing) is swallowed into a stderr warning and an empty trace.
 * The build already succeeded; git capture is purely for traceability.
 *
 * Implemented with TaskEither.from + isLeft (not TaskEither.fold, which returns
 * Task<T> and can't be chained as TaskEither) per the TaskEither API.
 */
export function captureGitTrace(
  gitRun: (cmd: string, args: string[], opts: RunOpts) => TaskEither<string, string>,
  cwd: string,
  warn: (msg: string) => void = (m) => process.stderr.write(m),
): TaskEither<string, GitTrace> {
  return TaskEither.from(async () => {
    const sha = await gitRun("git", ["rev-parse", "HEAD"], { cwd }).run();
    if (Either.isLeft(sha)) {
      warn(`adw-build: git capture failed (${sha.left}); recording build without base_sha.\n`);
      return Either.right<GitTrace, string>({});
    }
    const stat = await gitRun("git", ["diff", "--stat"], { cwd }).run();
    const diffStat = Either.isRight(stat) ? stat.right.slice(0, 400) : undefined;
    return Either.right<GitTrace, string>({ base_sha: sha.right.trim(), diff_stat: diffStat });
  });
}

// ---------------------------------------------------------------------------
// Optional tmax-use e2e gate (SPEC-061 AC#11)
// ---------------------------------------------------------------------------

export interface E2eGateResult {
  /** True if the gate ran (targets present) and exited 0. False on failure or skip. */
  ok: boolean;
  /** True if the gate was skipped because no tmax-use targets exist. */
  skipped: boolean;
  exitCode?: number;
  /** First ~400 chars of combined stdout/stderr, for event traceability. */
  output?: string;
  /** Where the HTML report was written (only when the gate ran). */
  reportDir?: string;
}

/**
 * Run `bin/tmax-use test` as an optional e2e gate after a successful build.
 *
 * Skips silently when no tmax-use playbooks or tests exist (so this remains
 * zero-cost for projects that don't use tmax-use). When targets exist, spawns
 * `bun run test:tmax-use` and captures the exit code + summary output. The HTML
 * + JUnit reports land under `agents/{id}/e2e-report/` per spec AC#11.
 *
 * NEVER fails the build. A non-zero exit is recorded as `ok: false` in the
 * returned `E2eGateResult` and emitted as an `e2e_gate` event; the caller
 * (patch-review) is responsible for treating e2e failures as audit inputs.
 */
export function runE2eGate(
  run: (cmd: string, args: string[], opts: RunOpts) => TaskEither<string, string>,
  cwd: string,
  reportDir: string,
): TaskEither<string, E2eGateResult> {
  return TaskEither.from(async () => {
    if (!hasTmaxUseTargets(cwd)) {
      return Either.right<E2eGateResult, string>({ ok: true, skipped: true });
    }
    // The runner accepts `--output` for the HTML/JUnit report directory.
    // `bun run test:tmax-use` is wired in package.json to `bin/tmax-use test`.
    const res = await run("bun", [
      "run", "test:tmax-use",
      "--output", reportDir,
      "--reporter", "all",
    ], { cwd }).run();
    if (Either.isLeft(res)) {
      // spawn failure (e.g. bun missing) — record as not-ok with the error.
      return Either.right<E2eGateResult, string>({
        ok: false, skipped: false, reportDir, output: `spawn failed: ${res.left}`.slice(0, 400),
      });
    }
    // `run` returns trimmed stdout on Right. A non-zero exit is Left (with
    // stderr||stdout as the error), so a Right here means exit 0.
    return Either.right<E2eGateResult, string>({
      ok: true, skipped: false, exitCode: 0, reportDir, output: res.right.slice(0, 400),
    });
  }).mapLeft((err) => `runE2eGate: ${err}`);
}

/**
 * Detect whether `tmax-use/playbooks/` or `tmax-use/tests/` has any files this
 * build's e2e gate should exercise. Matches patch-reviewer's selector so the
 * build agent and the review agent agree on when tmax-use is in scope.
 */
export function hasTmaxUseTargets(cwd: string): boolean {
  try {
    const dirs = [join(cwd, "tmax-use/playbooks"), join(cwd, "tmax-use/tests")];
    for (const dir of dirs) {
      const entries = readdirSync(dir, { withFileTypes: true });
      if (entries.some((e) =>
        e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml") || e.name.endsWith(".tmax-use.ts")),
      )) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// main() — composed pipeline
// ---------------------------------------------------------------------------

// Stage-1 context: only what exists before the build runs. The id is minted up
// front but no filesystem side effect happens until Step 1 (writeState). The
// dependency guard (Step 0a) and input resolution (Step 0b) run BEFORE
// `currentBuild` is set, so their failures exit 1 with no agents/ dir created.
interface Seed {
  id: string;
  model: string;
}

// Stage-2 context: after resolveInput succeeds. This is the failure-recording
// boundary — every failure from here on writes an error event + failed state.
interface Resolved extends Seed {
  specPath: string;
  source: "path" | "adw-id";
}

/** Result of a successful build run. (Named BuildOutcome to avoid collision with builder.ts's BuildResult.) */
export interface BuildOutcome {
  id: string;
  specPath: string;
  baseSha?: string;
}

/**
 * The build pipeline as a callable function. Resolves the input (spec path or
 * adw-id), dispatches `claude -p /implement` against it, and records the run
 * under agents/{id}/. Returns Either<string, BuildOutcome> — Left on failure,
 * Right with the id + specPath + optional baseSha on success.
 *
 * Progress messages go to stderr; the caller (main() or an orchestrator) is
 * responsible for any final stdout line.
 */
export function runBuild(
  input: string,
  modelOverride?: string,
  id?: string,
): Promise<Either<string, BuildOutcome>> {
  // Inject the subprocess plumbing into the builder module.
  const deps: BuilderDeps = {
    run,
    runCapture: withClaude529Retry(runCapture, {
      onRetry: ({ attempt, maxRetries, delayMs }) => {
        try {
          process.stderr.write(`[build] claude 529 rate_limit; retry ${attempt}/${maxRetries} in ${Math.round(delayMs / 1000)}s\n`);
        } catch { /* best-effort */ }
      },
    }),
  };

  // ownsState = true when running standalone (no orchestrator driving this
  // process). The orchestrator sets ADW_ORCHESTRATED=1 when spawning children;
  // when set, this stage writes events under the shared id but skips writing
  // adw-state.json — the orchestrator owns the single workspace state.
  // Keyed off the env var (not the presence of --id) so a human running
  // `adw-build.ts --id X <spec>` standalone still gets their own state file.
  const ownsState = process.env.ADW_ORCHESTRATED !== "1";

  // ── Hoisted: resolve input BEFORE minting the id ────────────────────────
  // (Was Step 0b inside the pipeline; now runs first so spec-anchored discovery
  //  can use the resolved specPath. Failures here exit before any agents/ dir
  //  is created — preserving the pre-resolution-failure property.)
  const resolvedInput = resolveInput(input);
  if (Either.isLeft(resolvedInput)) return Promise.resolve(resolvedInput);
  const specPath = resolvedInput.right.specPath;
  const source = resolvedInput.right.source;

  // ── Resolve the workspace id ─────────────────────────────────────────────
  // Priority: explicit --id > discovered workspace > fresh mint.
  // Discovery scans agents/ for an existing workspace with this spec_path;
  // only mints a new id if none exists. Skipped when orchestrated (the
  // orchestrator always passes --id).
  let runId: string;
  if (id) {
    runId = id;
  } else if (ownsState) {
    const discovered = findWorkspaceBySpecPath(AGENTS_DIR, specPath);
    runId = discovered ?? adwId();
    if (discovered) {
      process.stderr.write(`adw-build: reusing workspace ${discovered} for ${specPath}\n`);
    }
  } else {
    runId = adwId();
  }

  // When orchestrated, skip state writes — the orchestrator owns the workspace
  // adw-state.json. Return a no-op Right<undefined>.
  const recordState = (stateId: string, state: Record<string, unknown>): TaskEither<string, void> =>
    ownsState ? writeState(stateId, state) : TaskEither.right<void, string>(undefined);

  // Mutable ref so the error handler can access the resolved context after a
  // short-circuit. Set immediately since resolution already happened above.
  const currentBuild: Resolved = {
    id: runId,
    model: modelOverride ?? BUILD_MODEL,
    specPath,
    source,
  };

  // SPEC-065: when orchestrated inside a worktree, ADW_WORKTREE points at the
  // per-run sibling worktree path. The execution cwd (claude dispatch, e2e
  // gate, git capture) is the worktree, while state/events/agents/ remain on
  // PROJECT_ROOT. Standalone (no env var) falls back to PROJECT_ROOT — i.e.
  // behaves exactly as before.
  const cwd = process.env.ADW_WORKTREE ?? PROJECT_ROOT;

  const program = TaskEither
    .right<Resolved, string>(currentBuild)
    // Step 0: dependency guard — claude on PATH.
    .flatMap((ctx) => ensureAvailable(deps, cwd).map(() => ctx))
    // Step 1: write initial state + start event.
    .flatMap((ctx) => recordState(ctx.id, {
      adw_id: ctx.id,
      spec_path: ctx.specPath,
      source: ctx.source,
      model: ctx.model,
      status: "running",
    })
      .tap(() => appendEvent(ctx.id, "builder", {
        event: "start",
        spec_path: ctx.specPath,
        source: ctx.source,
        model: ctx.model,
      }))
      .map(() => ctx))
    // Step 2: dispatch to /implement. .tap for the event side effect, .map to
    // keep ctx flowing to Step 3.
    .flatMap((ctx) => {
      const builderLog = join(AGENTS_DIR, ctx.id, "builder", "raw-output.jsonl");
      // §C: live tool-use filtering to stderr — only when orchestrated.
      const liveLabel = process.env.ADW_ORCHESTRATED === "1" ? "build" : undefined;
      return build(deps, cwd, ctx.specPath, builderLog, ctx.model, liveLabel)
        .tap(() => appendEvent(ctx.id, "builder", {
          event: "dispatch",
          skill: "implement",
          status: "ok",
          exit_code: 0,
        }))
        .map(() => ctx);
    })
    // Step 3: best-effort git capture, then record result + finalize state.
    .flatMap((ctx) => captureGitTrace(run, cwd)
      .tap((trace) => appendEvent(ctx.id, "builder", {
        event: "result",
        ...(trace.base_sha ? { base_sha: trace.base_sha } : {}),
        ...(trace.diff_stat ? { diff_stat: trace.diff_stat } : {}),
      }))
      .flatMap((trace) => recordState(ctx.id, {
        adw_id: ctx.id,
        spec_path: ctx.specPath,
        source: ctx.source,
        model: ctx.model,
        status: "completed",
        ...(trace.base_sha ? { base_sha: trace.base_sha } : {}),
      }).map(() => ({ id: ctx.id, specPath: ctx.specPath, ...(trace.base_sha ? { baseSha: trace.base_sha } : {}) }) as BuildOutcome))
    // Step 4 (optional, never fails the build): run tmax-use e2e gate.
    // Spec AC#11 — adw build agent calls `bin/tmax-use test` and records
    // exit code + artifacts under agents/{id}/e2e-report/. Skipped silently
    // when no tmax-use targets exist.
    .flatMap((outcome) => {
      const reportDir = join(AGENTS_DIR, outcome.id, "e2e-report");
      return runE2eGate(run, cwd, reportDir)
        .tap((gate) => appendEvent(outcome.id, "builder", {
          event: "e2e_gate",
          ...(gate.skipped ? { skipped: true } : { ok: gate.ok }),
          ...(gate.exitCode !== undefined ? { exit_code: gate.exitCode } : {}),
          ...(gate.reportDir ? { report_dir: gate.reportDir } : {}),
          ...(gate.output ? { output: gate.output } : {}),
        }))
        .map(() => outcome);
    }));

  // Run the pipeline. On error: if we got past resolution, record an error event
  // + failed state; otherwise just return the Left. This matches the exit-code
  // contract (pre-resolution failures → no state written).
  return program.run().then((result) => {
    if (Either.isLeft(result)) {
      if (currentBuild) {
        appendEvent(currentBuild.id, "builder", { event: "error", detail: result.left });
        return recordState(currentBuild.id, {
          adw_id: currentBuild.id,
          spec_path: currentBuild.specPath,
          source: currentBuild.source,
          model: currentBuild.model,
          status: "failed",
        }).run().then(() => Either.left(result.left));
      }
      return Either.left(result.left);
    }
    return Either.right(result.right);
  });
}

function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  // Handle help/usage/parse errors synchronously (before any deps or ids).
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

  return runBuild(parsed.right.input, parsed.right.model, parsed.right.id).then((result) => {
    if (Either.isLeft(result)) {
      process.stderr.write(`Error: ${result.left}\n`);
      return 2;
    }
    process.stdout.write(`${result.right.id} ${result.right.specPath}\n`);
    return 0;
  });
}

// Only auto-run when invoked directly (not when imported by a test). The sibling
// dispatchers (adw-plan.ts, adw-spec-review.ts) don't guard this because nothing
// imports them yet; adw-build.ts is imported by test/unit/adw-build.test.ts.
if (import.meta.main) {
  main().then((code) => process.exit(code));
}
