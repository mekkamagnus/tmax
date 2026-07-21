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
import { runAdwEntrypoint } from "./adws-modules/process-supervisor.ts";
import { join } from "path";
import { realpathSync } from "fs";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import { match } from "../src/utils/adt.ts";
import { type PlanType, type AgentDeps, type ClassifyResult, type DispatchOutcome, classify, dispatch } from "./adws-modules/agent.ts";
import {
  ADW_ID_RE,
  adwId,
  appendEvent as appendEventRaw,
  writeState as writeStateRaw,
  run,
  runCapture,
  type RunOpts,
} from "./adws-modules/dispatcher-runtime.ts";

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
// Run-state: thin wrappers around dispatcher-runtime (CHORE-44 Change 8).
// The stage-local signatures match the pre-refactor call sites (id, agent,
// event) so the body of runPlan below is unchanged. The implementation lives
// in dispatcher-runtime.ts; these const arrows curry the project AGENTS_DIR.
// ---------------------------------------------------------------------------

/**
 * Append a single lifecycle event as one JSON line to the agent's events file.
 * Sync, append-only — survives crashes. Each event is on disk immediately.
 *
 * Stage-style signature `(id, agent, event)` — delegates to the shared
 * `appendEvent(agentsDir, id, agent, event)` in dispatcher-runtime.
 */
const appendEvent = (id: string, agent: string, event: Record<string, unknown>): void =>
  appendEventRaw(AGENTS_DIR, id, agent, event);

/**
 * Write the run-state file (id, description, type, status — no events).
 * Called at most twice: after start and after result/error.
 *
 * Stage-style signature `(id, state)` — delegates to the shared
 * `writeState(agentsDir, id, state)` in dispatcher-runtime.
 */
const writeState = (id: string, state: Record<string, unknown>): TaskEither<string, void> =>
  writeStateRaw(AGENTS_DIR, id, state).map(() => undefined);

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
      // §C: live tool-use filtering to stderr — only when orchestrated.
      const liveLabel = process.env.ADW_ORCHESTRATED === "1" ? "plan" : undefined;
      return dispatch(deps, PROJECT_ROOT, SPECS_DIR, plannerLog, ctx.type, ctx.description, liveLabel)
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
  void runAdwEntrypoint({ label: "adw-plan", main });
}
