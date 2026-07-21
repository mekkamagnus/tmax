#!/usr/bin/env bun
/**
 * adw-plan-reviewspec-build.ts — full pipeline orchestrator (plan → review → build).
 *
 * Takes a free-text description, runs it through the three adw stages in sequence
 * by spawning each child as a subprocess, parses each child's `<id> <...>` stdout
 * line, and feeds the result into the next stage. All three children share one
 * workspace id (passed via --id), so every stage writes its events under the same
 * agents/{id}/ directory; the orchestrator owns the single adw-state.json.
 *
 *   bun adws/adw-plan-reviewspec-build.ts "add a URL bar to the status line"
 *   bun adws/adw-plan-reviewspec-build.ts --chore "rename adw-build-dispatcher"
 *   bun adws/adw-plan-reviewspec-build.ts --model glm-4.7 "implement feature X"
 *
 * Stages (each is a subprocess: `bun adws/<child>.ts --id <id> <args>`):
 *   1. adw-plan.ts          → stdout "<id> <spec-path>" (aborts if spec-path is "-")
 *   2. adw-spec-review.ts   → stdout "<id> <pass|upgraded|unchanged> <spec-path>"
 *                            (always continues — review gaps don't block the build)
 *   3. adw-build.ts         → stdout "<id> <spec-path>"
 *
 * One workspace id: the orchestrator mints a single adw-id and passes it to all
 * three children via --id (and sets ADW_ORCHESTRATED=1 so they skip writing their
 * own adw-state.json). Each child writes its events under agents/{id}/{agent}/.
 *
 * Exit codes: 0 = full pipeline success (or --help); 1 = usage error; 2 = any
 * stage failed (orchestrator records which stage in its error event, then stops).
 *
 * File layout per run (all under one workspace id):
 *   agents/{id}/adw-state.json             — the single workspace state (status, agents, failed_stage?)
 *   agents/{id}/orchestrator/events.jsonl  — start/stage-complete/error
 *   agents/{id}/planner/events.jsonl       — written by adw-plan subprocess
 *   agents/{id}/planner/raw-output.jsonl   — written by adw-plan subprocess
 *   agents/{id}/reviewer/events.jsonl      — written by adw-spec-review subprocess
 *   agents/{id}/upgrader/events.jsonl      — written by adw-spec-review (if upgrade runs)
 *   agents/{id}/builder/events.jsonl       — written by adw-build subprocess
 *   agents/{id}/builder/raw-output.jsonl   — written by adw-build subprocess
 *
 * CHORE-44 Change 8: this file is now a thin CLI adapter. The shared
 * id/event/state/spawn helpers live in ./adws-modules/dispatcher-runtime.ts;
 * the generic stage driver lives in ./adws-modules/pipeline.ts. This
 * orchestrator declares its stage list as a `PipelineConfig` and delegates.
 */
import { runAdwEntrypoint } from "./adws-modules/process-supervisor.ts";
import { realpathSync } from "fs";
import { join } from "path";
import { Either } from "../src/utils/task-either.ts";
import type { PlanType } from "./adws-modules/agent.ts";
import {
  ADW_ID_RE,
  readWorkspaceState,
  recoverSpecPathFromEvents,
} from "./adws-modules/dispatcher-runtime.ts";
import {
  looksLikeSpecPath,
  runLinearPipeline,
  spawnStage,
  tokensOf,
  type PipelineConfig,
  type StageRunArgs,
} from "./adws-modules/pipeline.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");

type StageName = "plan" | "review" | "build";
const STAGE_ORDER: readonly StageName[] = ["plan", "review", "build"];

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-plan-reviewspec-build.ts [--feature|--bug|--chore] [--model <id>] "<description>"
       bun adws/adw-plan-reviewspec-build.ts [--model <id>] <spec-path>
       bun adws/adw-plan-reviewspec-build.ts --id <workspace-id> [--from-stage <plan|review|build>]

Runs the adw pipeline (plan → spec-review → build) and prints
"<workspace-id> <spec-path>" on success.

  <description>             A free-text task description. Plan runs first,
                            creating a spec, then spec-review and build follow.
  <spec-path>               An existing docs/specs/{SPEC,BUG,CHORE}-*.md path.
                            Plan is SKIPPED (the spec already exists); the
                            pipeline starts at spec-review → build. A workspace
                            id is minted (or discovered via spec-anchored
                            discovery if one already exists for this spec).
  --feature/--bug/--chore   Skip the classifier in the plan stage; dispatch
                            directly to that skill. (Description mode only.)
  --model <id>              Override the build stage's model (stage 3 only).
  --id <workspace-id>       Resume an interrupted run. Reads agents/<id>/adw-state.json,
                            auto-detects which stages already completed, and resumes at
                            the first incomplete stage. <description> becomes optional
                            (recovered from the on-disk state).
  --from-stage <stage>      Override auto-detection: force resume to start at the given
                            stage, skipping earlier ones even if incomplete. Requires --id.

All stages run under one workspace id (agents/{id}/). The orchestrator owns
adw-state.json; each child stage writes its own events under agents/{id}/{agent}/.`;

export interface OrchestratorArgs {
  description: string;
  forcedType?: PlanType;
  modelOverride?: string;
  id?: string;
  fromStage?: StageName;
  specPath?: string; // NEW: when the input is an existing spec path, plan is skipped
}

export function parseArgs(argv: string[]): Either<string, OrchestratorArgs> {
  let description = "";
  let specPath: string | undefined;
  let forcedType: PlanType | undefined;
  let modelOverride: string | undefined;
  let id: string | undefined;
  let fromStage: StageName | undefined;
  let typeFlags = 0;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    else if (a === "--feature" || a === "--bug" || a === "--chore") {
      forcedType = a.slice(2) as PlanType;
      typeFlags++;
    } else if (a === "--model") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--model requires a value.");
      modelOverride = val;
    } else if (a === "--id") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--id requires a value.");
      if (!ADW_ID_RE.test(val)) return Either.left(`--id must be a 10-char ULID-timestamp id (got "${val}").`);
      id = val;
    } else if (a === "--from-stage") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--from-stage requires a value.");
      if (val !== "plan" && val !== "review" && val !== "build") {
        return Either.left(`--from-stage must be one of: plan, review, build (got "${val}").`);
      }
      fromStage = val;
    } else if (description === "" && specPath === undefined) {
      // First positional: spec path → skip plan; otherwise → description for plan.
      if (looksLikeSpecPath(a)) specPath = a;
      else description = a;
    } else return Either.left(`Unexpected extra argument: ${a}`);
  }
  if (typeFlags > 1) return Either.left("Specify at most one of --feature/--bug/--chore.");
  if (fromStage && !id) return Either.left("--from-stage requires --id (it only makes sense when resuming).");
  if (forcedType && specPath) return Either.left("--feature/--bug/--chore require a description (plan stage), but a spec path was given (plan is skipped).");
  // description OR specPath OR --id is required.
  if (!description && !specPath && !id) return Either.left(`__usage__:${USAGE}`);
  return Either.right({ description, forcedType, modelOverride, id, fromStage, specPath });
}

// ---------------------------------------------------------------------------
// Resume support: load an existing workspace to recover what's already done
// ---------------------------------------------------------------------------

/** What runPipeline needs to know to resume correctly. */
export interface ResumeContext {
  description: string;
  specPath: string | null;
  completedStages: StageName[];
  resumeFrom: StageName;
}

/**
 * Load an existing workspace and determine where to resume.
 * - `fromStage` overrides auto-detection (forces starting at that stage).
 * - Auto-detection: the first stage NOT in completedStages, in plan→review→build order.
 * - specPath recovery: state.spec_path first, else events.jsonl fallback.
 * - completedStages: state.completed_stages if present; else inferred from agents array.
 */
export function loadWorkspace(id: string, fromStage?: StageName, agentsDir: string = AGENTS_DIR): Either<string, ResumeContext> {
  const ws = readWorkspaceState(agentsDir, id);
  if (Either.isLeft(ws)) return ws;

  const state = ws.right;

  // Refuse to resume a completed workspace.
  if (state.status === "completed") {
    return Either.left(`workspace agents/${id} is already completed — nothing to resume`);
  }

  // Recover description.
  const description = state.description ?? "";
  if (!description) {
    return Either.left(`workspace agents/${id} has no description in its state — pass a description to resume`);
  }

  // Recover completedStages: explicit field first, else infer from agents array.
  let completedStages: StageName[];
  if (Array.isArray(state.completed_stages)) {
    completedStages = state.completed_stages as StageName[];
  } else {
    completedStages = [];
    const agents = state.agents ?? [];
    if (agents.includes("planner")) completedStages.push("plan");
    if (agents.includes("reviewer")) completedStages.push("review");
    if (agents.includes("builder")) completedStages.push("build");
  }

  // Recover specPath: state field first, else events fallback.
  const specPath = state.spec_path ?? recoverSpecPathFromEvents(agentsDir, id) ?? null;

  // Determine resumeFrom: override first, else auto-detect (first incomplete stage).
  let resumeFrom: StageName;
  if (fromStage) {
    resumeFrom = fromStage;
  } else {
    const firstIncomplete = STAGE_ORDER.find((s) => !completedStages.includes(s));
    resumeFrom = firstIncomplete ?? "build"; // all complete → shouldn't happen (status check above), but default safe
  }

  return Either.right({ description, specPath, completedStages, resumeFrom });
}

// ---------------------------------------------------------------------------
// Stage result types (the stdout contracts of each child subprocess)
// ---------------------------------------------------------------------------

/** One parsed stdout line from a stage subprocess. */
export interface PlanResult {
  id: string;
  specPath: string | null; // null when the plan skill wrote no spec (noop) → stdout was "<id> -"
}
export type ReviewKind = "pass" | "upgraded" | "unchanged";
export interface SpecReviewResult {
  id: string;
  specPath: string;
  kind: ReviewKind;
}
export interface BuildOutcome {
  id: string;
  specPath: string;
}

// ---------------------------------------------------------------------------
// Injectable stage functions (so tests can mock them without spawning subprocesses)
// ---------------------------------------------------------------------------

export interface PipelineDeps {
  runPlan: (description: string, forcedType: PlanType | undefined, id: string) => Promise<Either<string, PlanResult>>;
  runSpecReview: (specPath: string, id: string) => Promise<Either<string, SpecReviewResult>>;
  runBuild: (specPath: string, modelOverride: string | undefined, id: string) => Promise<Either<string, BuildOutcome>>;
}

/** The real deps — each spawns its child subprocess and parses the stdout contract. */
const realDeps: PipelineDeps = {
  runPlan: async (description, forcedType, id): Promise<Either<string, PlanResult>> => {
    const args = [description];
    if (forcedType) args.push(`--${forcedType}`);
    args.push("--id", id);
    const r = await spawnStage("adw-plan.ts", args, { projectRoot: PROJECT_ROOT });
    if (r.code !== 0) return Either.left(r.stdout || `adw-plan exited with code ${r.code}`);
    const tokens = tokensOf(r.stdout);
    // plan stdout: "<id> <spec-path>" or "<id> -"
    if (!tokens || tokens.length < 2) return Either.left(`adw-plan: unparseable stdout: ${r.stdout.slice(0, 200)}`);
    const specPath = tokens[1] === "-" ? null : tokens.slice(1).join(" ");
    return Either.right({ id: tokens[0]!, specPath });
  },

  runSpecReview: async (specPath, id): Promise<Either<string, SpecReviewResult>> => {
    const r = await spawnStage("adw-spec-review.ts", [specPath, "--id", id], { projectRoot: PROJECT_ROOT });
    if (r.code !== 0) return Either.left(r.stdout || `adw-spec-review exited with code ${r.code}`);
    const tokens = tokensOf(r.stdout);
    // spec-review stdout: "<id> <pass|upgraded|unchanged> <spec-path>"
    if (!tokens || tokens.length < 3) return Either.left(`adw-spec-review: unparseable stdout: ${r.stdout.slice(0, 200)}`);
    const kind = tokens[1];
    if (kind !== "pass" && kind !== "upgraded" && kind !== "unchanged") {
      return Either.left(`adw-spec-review: unexpected kind "${kind}" in stdout`);
    }
    return Either.right({ id: tokens[0]!, specPath: tokens.slice(2).join(" "), kind });
  },

  runBuild: async (specPath, modelOverride, id): Promise<Either<string, BuildOutcome>> => {
    const args = [specPath];
    if (modelOverride) args.push("--model", modelOverride);
    args.push("--id", id);
    const r = await spawnStage("adw-build.ts", args, { projectRoot: PROJECT_ROOT });
    if (r.code !== 0) return Either.left(r.stdout || `adw-build exited with code ${r.code}`);
    const tokens = tokensOf(r.stdout);
    // build stdout: "<id> <spec-path>"
    if (!tokens || tokens.length < 2) return Either.left(`adw-build: unparseable stdout: ${r.stdout.slice(0, 200)}`);
    return Either.right({ id: tokens[0]!, specPath: tokens.slice(1).join(" ") });
  },
};

// ---------------------------------------------------------------------------
// runPipeline() — declarative config consumed by runLinearPipeline
// ---------------------------------------------------------------------------

export interface PipelineResult {
  id: string;
  specPath: string;
  stages: {
    plan: PlanResult;
    review?: SpecReviewResult;
    build?: BuildOutcome;
  };
}

/** The three-stage pipeline as a declarative config (AC8.2). */
const PIPELINE_CONFIG: PipelineConfig<StageName, PipelineDeps, PipelineResult["stages"], PipelineResult> = {
  pipelineName: "adw-plan-reviewspec-build",
  successStatus: "completed",
  agentsFor: (stages) => {
    const agents: string[] = [];
    if (stages.plan) agents.push("planner");
    if (stages.review) agents.push("reviewer", "upgrader");
    if (stages.build) agents.push("builder");
    return agents;
  },
  buildResult: (ctx, stages) => ({ id: ctx.id, specPath: ctx.specPath!, stages }),
  stages: [
    {
      name: "plan",
      posLabel: "1/3",
      scriptName: "plan",
      shouldRun: (args, resume) => !args.specPathInput && (!resume || resume.resumeFrom === "plan"),
      skipReason: (args) => args.specPathInput ? "spec path given as input" : "already completed",
      run: async (deps, ctx) => deps.runPlan(ctx.description, undefined, ctx.id),
      abortOnEmptySpec: (result) => {
        const r = result as PlanResult;
        return r.specPath === null ? "plan stage produced no spec — nothing to review or build" : null;
      },
      complete: (result, ctx) => {
        const r = result as PlanResult;
        ctx.specPath = r.specPath;
        return { event: { event: "stage-complete", stage: "plan", spec_path: r.specPath } };
      },
    },
    {
      name: "review",
      posLabel: "2/3",
      scriptName: "spec-review",
      // On resume-from-build, skip review. The original predicate:
      //   `!resume || resume.resumeFrom !== "build"`.
      shouldRun: (_args, resume) => !resume || resume.resumeFrom !== "build",
      skipReason: () => "already completed",
      run: async (deps, ctx) => deps.runSpecReview(ctx.specPath!, ctx.id),
      complete: (result, _ctx) => {
        const r = result as SpecReviewResult;
        return {
          event: {
            event: "stage-complete",
            stage: "review",
            kind: r.kind,
            spec_path: r.specPath,
          },
        };
      },
    },
    {
      name: "build",
      posLabel: "3/3",
      scriptName: "build",
      // Always runs — it's terminal; re-running is the point.
      shouldRun: () => true,
      skipReason: () => "already completed",
      run: async (deps, ctx) => deps.runBuild(ctx.specPath!, ctx.modelOverride, ctx.id),
      complete: (result, _ctx) => {
        const r = result as BuildOutcome;
        return { event: { event: "stage-complete", stage: "build", spec_path: r.specPath } };
      },
    },
  ],
};

/**
 * Run the full pipeline (or resume it). Returns Either<string, PipelineResult>
 * — Left on any stage failure (with orchestrator state written to failed),
 * Right with the workspace id, the surviving specPath, and each stage's result.
 *
 * Resume: when args.id is set, loads the workspace, auto-detects which stages
 * completed (or honors args.fromStage), and skips them. Skipped stages still
 * populate the `stages` object so finalize records the correct `agents` list.
 */
export async function runPipeline(
  deps: PipelineDeps,
  args: OrchestratorArgs,
  agentsDir: string = AGENTS_DIR,
): Promise<Either<string, PipelineResult>> {
  // ── If resuming, load the workspace to recover what's already done ───────
  let resume: ResumeContext | null = null;
  if (args.id) {
    const loaded = loadWorkspace(args.id, args.fromStage, agentsDir);
    if (Either.isLeft(loaded)) return Promise.resolve(Either.left(loaded.left));
    resume = loaded.right;
  }

  // Thread orchestrator-specific flags (forcedType, modelOverride) into the
  // stage fns via curried deps + PipelineContext. forcedType is read by plan
  // through this closure; modelOverride is carried by PipelineContext and read
  // by the build descriptor directly.
  const depsWithFlags: PipelineDeps = {
    runPlan: (description, forcedType, id) => deps.runPlan(description, args.forcedType ?? forcedType, id),
    runSpecReview: deps.runSpecReview,
    runBuild: deps.runBuild,
  };

  const stageRunArgs: StageRunArgs & { description?: string; specPath?: string; id?: string } = {
    description: args.description,
    specPath: args.specPath,
    id: args.id,
    specPathInput: !!args.specPath,
    forcedType: args.forcedType,
    modelOverride: args.modelOverride,
  };

  return runLinearPipeline<StageName, PipelineDeps, PipelineResult["stages"], PipelineResult>(
    PIPELINE_CONFIG,
    depsWithFlags,
    stageRunArgs,
    resume,
    agentsDir,
  );
}

// ---------------------------------------------------------------------------
// main() — CLI wrapper
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

  return runPipeline(realDeps, parsed.right).then((result) => {
    if (Either.isLeft(result)) {
      process.stderr.write(`Error: ${result.left}\n`);
      return 2;
    }
    process.stdout.write(`${result.right.id} ${result.right.specPath}\n`);
    return 0;
  });
}

if (import.meta.main) {
  void runAdwEntrypoint({ label: "adw-plan-reviewspec-build", main });
}
