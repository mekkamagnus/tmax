#!/usr/bin/env bun
/**
 * adw-plan.ts — description → spec dispatcher.
 *
 * Takes a free-text plan description, classifies it (feature | bug | chore) via
 * the claude CLI in headless mode, then invokes the matching skill (/feature,
 * /bug, /chore) headlessly so the skill creates the spec doc in docs/specs/.
 *
 * Each run gets an adw-id = first 10 chars of a ULID (the timestamp portion).
 * State (id, description, type, status) is in ./agents/{adw-id}/adw-state.json.
 * Lifecycle events stream to ./agents/{adw-id}/planner/events.jsonl.
 * The planner's raw subprocess output is at ./agents/{adw-id}/planner/raw-output.jsonl.
 *
 * The LLM interface (classify + dispatch) lives in ./adws-modules/agent.ts;
 * this file is the CLI wrapper + run-state tracker.
 *
 *   bun adws/adw-plan.ts "<description>"
 *   bun adws/adw-plan.ts --feature "<description>"   # skip classifier
 *   bun adws/adw-plan.ts --bug "<description>"
 *   bun adws/adw-plan.ts --chore "<description>"
 *
 * Single external dependency: the `claude` CLI (v2.x), resolved from PATH.
 * Exit codes: 0 = spec created (adw-id + path printed to stdout); 1 = usage
 * error; 2 = classification/dispatch failure (message on stderr).
 */
import { spawn } from "child_process";
import { appendFileSync, mkdirSync, realpathSync } from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "path";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import { match } from "../src/utils/adt.ts";
import { type PlanType, type AgentDeps, type ClassifyResult, type DispatchOutcome, classify, dispatch } from "./adws-modules/agent.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const SPECS_DIR = join(PROJECT_ROOT, "docs", "specs");

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-plan.ts [--feature|--bug|--chore] "<description>"

Classifies the description via the claude CLI and dispatches to the matching
skill (/feature, /bug, /chore), which writes a spec to docs/specs/.

  --feature / --bug / --chore   Skip the classifier; dispatch directly.
  --help, -h                    Show this message.

Prints "<adw-id> <spec-path>" on success. State: ./agents/{adw-id}/adw-state.json;
lifecycle events: ./agents/{adw-id}/planner/events.jsonl; raw output:
./agents/{adw-id}/planner/raw-output.jsonl.`;

interface ParsedArgs {
  description: string;
  forcedType?: PlanType;
  id?: string;
}

/** 10-char Crockford Base32 ULID-timestamp — the workspace id shape. */
const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

function parseArgs(argv: string[]): Either<string, ParsedArgs> {
  const flags = new Set<PlanType>();
  let description = "";
  let id: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    else if (a === "--feature" || a === "--bug" || a === "--chore") flags.add(a.slice(2) as PlanType);
    else if (a === "--id") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--id requires a value.");
      if (!ADW_ID_RE.test(val)) return Either.left(`--id must be a 10-char ULID-timestamp id (got "${val}").`);
      id = val;
    } else if (description === "") description = a;
    else return Either.left(`Unexpected extra argument: ${a}`);
  }
  if (flags.size > 1) return Either.left("Pass at most one of --feature/--bug/--chore.");
  if (!description) return Either.left(`__usage__:${USAGE}`);
  return Either.right({ description, forcedType: flags.size === 1 ? [...flags][0] : undefined, id });
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
 * Write the run-state file (id, description, type, status — no events).
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

interface RunOpts {
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
 * arrives (via sync appendFileSync — acceptable for line-at-a-time small writes
 * that must survive a crash). Returns TaskEither (lazy).
 */
function runCapture(cmd: string, args: string[], opts: RunOpts & { teeTo: string }): TaskEither<string, string> {
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
        }
        if (code === 0) resolve(Either.right(stdout.trim()));
        else resolve(Either.left((stderr || stdout).trim() || `${cmd} exited with code ${code}`));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// main() — composed pipeline
// ---------------------------------------------------------------------------

/** Check that claude CLI is on PATH. Returns TaskEither (lazy). */
function ensureClaude(): TaskEither<string, void> {
  return run("command", ["-v", "claude"])
    .map(() => undefined)
    .mapLeft(() => "The `claude` CLI was not found on PATH. Install Claude Code (v2.x) and retry.");
}

// -- Pipeline context (the value threaded through each step) --

interface PipelineInput {
  id: string;
  description: string;
  forcedType?: PlanType;
}

interface Classified extends PipelineInput {
  type: PlanType;
}

/** Result of a successful plan run: the adw-id, the spec path (or null for noop), and the chosen type. */
export interface PlanResult {
  id: string;
  specPath: string | null;
  type: PlanType;
}

/**
 * The plan pipeline as a callable function. Classifies a description, dispatches
 * to the matching skill (/feature|/bug|/chore), and records the run under
 * agents/{id}/. Returns Either<string, PlanResult> — Left on failure, Right with
 * the id + specPath (or null if the skill wrote no spec) on success.
 *
 * Progress messages go to stderr (preserved from the CLI behavior); the final
 * "<id> <specPath>" stdout line is the caller's responsibility (main() prints it).
 */
/**
 * The plan pipeline as a callable function. Classifies a description, dispatches
 * to the matching skill (/feature|/bug|/chore), and records the run under
 * agents/{id}/. Returns Either<string, PlanResult> — Left on failure, Right with
 * the id + specPath (or null if the skill wrote no spec) on success.
 *
 * id (optional): a shared workspace id. When passed by an orchestrator, the
 * planner writes its events under agents/{id}/planner/ but does NOT write
 * adw-state.json — the orchestrator owns the workspace state. When omitted
 * (standalone CLI use), the planner mints its own id and writes state itself.
 *
 * Progress messages go to stderr (preserved from the CLI behavior); the final
 * "<id> <specPath>" stdout line is the caller's responsibility (main() prints it).
 */
export function runPlan(
  description: string,
  forcedType?: PlanType,
  id?: string,
): Promise<Either<string, PlanResult>> {
  // Inject the subprocess plumbing into the agent module.
  const deps: AgentDeps = { run, runCapture };

  // ownsState = true when running standalone (no orchestrator driving this
  // process). The orchestrator sets ADW_ORCHESTRATED=1 when spawning children;
  // when set, this stage writes events under the shared id but skips writing
  // adw-state.json — the orchestrator owns the single workspace state.
  // Keyed off the env var (not the presence of --id) so a human running
  // `adw-plan.ts --id X "desc"` standalone still gets their own state file.
  const ownsState = process.env.ADW_ORCHESTRATED !== "1";
  const runId = id ?? adwId();

  // Mutable ref so the error handler can access the id after short-circuit.
  let currentId: string | null = null;

  // When orchestrated (ownsState=false), skip state writes — the orchestrator
  // owns the single workspace adw-state.json. Return a no-op Right<undefined>.
  const recordState = (stateId: string, state: Record<string, unknown>): TaskEither<string, void> =>
    ownsState ? writeState(stateId, state) : TaskEither.right<void, string>(undefined);

  const program = TaskEither
    .right<PipelineInput, string>({
      id: runId,
      description,
      forcedType,
    })
    .tap((ctx) => { currentId = ctx.id; })
    // Step 0: dependency guard (runs BEFORE minting any state — if claude is
    // missing, no agents/ dir is created)
    .flatMap((ctx: PipelineInput) => ensureClaude().map(() => ctx))
    // Step 1: write initial state + start event, then classify
    .flatMap((ctx: PipelineInput) => recordState(ctx.id, { adw_id: ctx.id, description: ctx.description, forcedType: ctx.forcedType, status: "running" })
      .tap(() => appendEvent(ctx.id, "planner", { event: "start", description: ctx.description }))
      .map(() => ctx)
    )
    .flatMap((ctx: PipelineInput) => {
      if (ctx.forcedType) {
        process.stderr.write(`adw-plan: --${ctx.forcedType} forced → /${ctx.forcedType}\n`);
        appendEvent(ctx.id, "planner", { event: "classify", type: ctx.forcedType, reason: "forced via CLI flag" });
        return TaskEither.right<Classified, string>({ ...ctx, type: ctx.forcedType });
      }
      return classify(deps, PROJECT_ROOT, ctx.description)
        .tap((result: ClassifyResult) => {
          process.stderr.write(`adw-plan: classified as ${result.type} → /${result.type}\n`);
          appendEvent(ctx.id, "planner", { event: "classify", type: result.type, reason: result.reason });
        })
        .map((result: ClassifyResult): Classified => ({ ...ctx, type: result.type }));
    })
    // Step 2: dispatch to the matching skill
    .flatMap((ctx: Classified) => {
      const plannerLog = join(AGENTS_DIR, ctx.id, "planner", "raw-output.jsonl");
      return dispatch(deps, PROJECT_ROOT, SPECS_DIR, plannerLog, ctx.type, ctx.description)
        .map((outcome: DispatchOutcome) => {
          const dispatchEvent: { event: "dispatch"; skill: string; status: "ok"; kind: string; detail: string } = match(outcome, {
            created: (v) => ({ event: "dispatch" as const, skill: ctx.type, status: "ok" as const, kind: "created" as const, detail: v.path }),
            modified: (v) => ({ event: "dispatch" as const, skill: ctx.type, status: "ok" as const, kind: "modified" as const, detail: v.path }),
            noop: (v) => ({ event: "dispatch" as const, skill: ctx.type, status: "ok" as const, kind: "noop" as const, detail: v.summary.slice(0, 200) }),
          });
          appendEvent(ctx.id, "planner", dispatchEvent);
          return { ...ctx, outcome };
        });
    })
    // Step 3: record result + finalize state
    .flatMap((ctx: Classified & { outcome: DispatchOutcome }) => {
      const specPath: string | null = match(ctx.outcome, {
        created: (v) => v.path,
        modified: (v) => v.path,
        noop: () => null,
      });
      appendEvent(ctx.id, "planner", {
        event: "result",
        kind: ctx.outcome.kind,
        spec_path: specPath,
        summary: ctx.outcome.kind === "noop" ? ctx.outcome.summary.slice(0, 400) : undefined,
      });
      return recordState(ctx.id, { adw_id: ctx.id, description: ctx.description, type: ctx.type, status: "completed" }).map(() => ({
        id: ctx.id,
        specPath,
        type: ctx.type,
      }));
    });

  // Run the pipeline. On error, stream an error event + update state.
  return program.run().then((result) => {
    if (Either.isLeft(result)) {
      if (currentId) {
        appendEvent(currentId, "planner", { event: "error", detail: result.left });
        return recordState(currentId, { adw_id: currentId, description, status: "failed" }).run().then(() =>
          Either.left(result.left),
        );
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

  const { description, forcedType, id } = parsed.right;

  return runPlan(description, forcedType, id).then((result) => {
    if (Either.isLeft(result)) {
      process.stderr.write(`Error: ${result.left}\n`);
      return 2;
    }
    const { id, specPath } = result.right;
    if (specPath) {
      process.stdout.write(`${id} ${specPath}\n`);
    } else {
      process.stdout.write(`${id} -\n`);
      process.stderr.write(`adw-plan: skill succeeded but wrote no new/modified spec file.\n`);
    }
    return 0;
  });
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
