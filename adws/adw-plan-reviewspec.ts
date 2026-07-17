#!/usr/bin/env bun
/**
 * adw-plan-reviewspec.ts — 2-stage planning-only orchestrator (plan → review, terminal).
 *
 * Runs ONLY the planning half of the adw pipeline and stops, leaving a reviewed,
 * revised spec on disk plus a resumable workspace. It is the planning counterpart
 * to /adw-implement (which runs the full 5-stage pipeline). The workspace it
 * leaves behind (`status: "planned"`, `completed_stages: ["plan","review"]`) is
 * handed off to the full orchestrator — by id (`/adw-implement --resume <id>`)
 * or by spec path (`/adw-implement docs/specs/SPEC-###.md`, which discovers this
 * workspace via `findWorkspaceBySpecPath`).
 *
 * Takes a free-text description (or an existing spec path), runs it through the
 * two planning stages in sequence by spawning each child as a subprocess, parses
 * each child's `<id> <...>` stdout line, and feeds the result into the next
 * stage. Both children share one workspace id (passed via --id), so every stage
 * writes its events under the same agents/{id}/ directory; the orchestrator owns
 * the single adw-state.json.
 *
 *   bun adws/adw-plan-reviewspec.ts "add a URL bar to the status line"
 *   bun adws/adw-plan-reviewspec.ts --chore "rename adw-build-dispatcher"
 *   bun adws/adw-plan-reviewspec.ts docs/specs/SPEC-064-adw-plan-skill.md
 *
 * Stages (each is a subprocess: `bun adws/<child>.ts --id <id> <args>`):
 *   1. adw-plan.ts          → stdout "<id> <spec-path>" (aborts if spec-path is "-")
 *   2. adw-spec-review.ts   → stdout "<id> <pass|upgraded|unchanged> <spec-path>"
 *                            (always continues — review gaps don't block here;
 *                            the revised spec on disk is the deliverable)
 *
 * One workspace id: the orchestrator mints a single adw-id and passes it to both
 * children via --id (and sets ADW_ORCHESTRATED=1 so they skip writing their own
 * adw-state.json). Each child writes its events under agents/{id}/{agent}/.
 *
 * Terminal status: on success the orchestrator writes `status: "planned"` (NOT
 * `"completed"`) with `completed_stages: ["plan","review"]`. This is what lets
 * the full orchestrator's `loadWorkspace` resume the workspace at `build` — it
 * refuses only `"completed"`, so a `"planned"` workspace flows through.
 *
 * Exit codes: 0 = pipeline success (or --help); 1 = usage error; 2 = any stage
 * failed (orchestrator records which stage in its error event, then stops).
 *
 * File layout per run (all under one workspace id):
 *   agents/{id}/adw-state.json             — the single workspace state (status, agents, failed_stage?)
 *   agents/{id}/orchestrator/events.jsonl  — start/stage-complete/error
 *   agents/{id}/planner/events.jsonl       — written by adw-plan subprocess
 *   agents/{id}/planner/raw-output.jsonl   — written by adw-plan subprocess
 *   agents/{id}/reviewer/events.jsonl      — written by adw-spec-review subprocess
 *   agents/{id}/upgrader/events.jsonl      — written by adw-spec-review (if upgrade runs)
 *
 * CHORE-44 Change 8: this file is now a thin CLI adapter. The shared
 * id/event/state/spawn helpers live in ./adws-modules/dispatcher-runtime.ts;
 * the generic stage driver lives in ./adws-modules/pipeline.ts. This
 * orchestrator declares its stage list as a `PipelineConfig` and delegates.
 */
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
  type StageDescriptor,
  type StageRunArgs,
} from "./adws-modules/pipeline.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");

type StageName = "plan" | "review";
const STAGE_ORDER: readonly StageName[] = ["plan", "review"];

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-plan-reviewspec.ts [--feature|--bug|--chore] "<description>"
       bun adws/adw-plan-reviewspec.ts <spec-path>
       bun adws/adw-plan-reviewspec.ts --id <workspace-id> [--from-stage <plan|review>]

Runs the planning half of the adw pipeline (plan → spec-review) and prints
"<workspace-id> <spec-path>" on success. Stops after review — the workspace is
left with status "planned" so /adw-implement --resume <id> (or
/adw-implement <spec-path>) skips straight to build.

  <description>             A free-text task description. Plan runs first,
                            creating a spec, then spec-review follows.
  <spec-path>               An existing docs/specs/{SPEC,BUG,CHORE}-*.md path.
                            Plan is SKIPPED (the spec already exists); the
                            pipeline runs only spec-review.
  --feature/--bug/--chore   Skip the classifier in the plan stage; dispatch
                            directly to that skill. (Description mode only.)
  --id <workspace-id>       Resume an interrupted run. Reads agents/<id>/adw-state.json,
                            auto-detects which stages already completed, and resumes at
                            the first incomplete stage. <description> becomes optional
                            (recovered from the on-disk state).
  --from-stage <stage>      Override auto-detection: force resume to start at the given
                            stage, skipping earlier ones even if incomplete. Requires --id.

All stages run under one workspace id (agents/{id}/). The orchestrator owns
adw-state.json; each child stage writes its own events under agents/{id}/{agent}/.

Note: --model is NOT accepted — this orchestrator has no build stage. Use
/adw-implement to forward a model override to the build stage.`;

export interface OrchestratorArgs {
  description: string;
  forcedType?: PlanType;
  id?: string;
  fromStage?: StageName;
  specPath?: string; // when the input is an existing spec path, plan is skipped
}

export function parseArgs(argv: string[]): Either<string, OrchestratorArgs> {
  let description = "";
  let specPath: string | undefined;
  let forcedType: PlanType | undefined;
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
      // No build stage consumes --model in this orchestrator. Reject explicitly
      // rather than silently ignoring it or letting it bleed into positional text.
      return Either.left("--model is not supported by adw-plan-reviewspec (no build stage). Use /adw-implement for model overrides.");
    } else if (a === "--id") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--id requires a value.");
      if (!ADW_ID_RE.test(val)) return Either.left(`--id must be a 10-char ULID-timestamp id (got "${val}").`);
      id = val;
    } else if (a === "--from-stage") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--from-stage requires a value.");
      if (val !== "plan" && val !== "review") {
        return Either.left(`--from-stage must be one of: plan, review (got "${val}").`);
      }
      fromStage = val;
    } else if (a.startsWith("-") && a !== "--") {
      // Reject any other unknown leading-dash flag instead of treating it as a
      // description or spec path. Keeps parseArgs honest about supported flags.
      return Either.left(`Unsupported option: ${a}. See --help for the supported flags.`);
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
  return Either.right({ description, forcedType, id, fromStage, specPath });
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
 * - Auto-detection: the first stage NOT in completedStages, in plan→review order.
 * - specPath recovery: state.spec_path first, else events.jsonl fallback.
 * - completedStages: state.completed_stages if present; else inferred from agents array.
 *
 * Refuses a "planned" or "completed" workspace — both are terminal for this
 * 2-stage pipeline (both stages done, nothing to resume HERE). The handoff to
 * /adw-implement is a resume of the FULL orchestrator, whose loadWorkspace only
 * refuses "completed" and accepts "planned" — that asymmetry is intentional and
 * pinned by tests in test/unit/adw-plan-reviewspec.test.ts and
 * test/unit/adw-plan-resume-by-spec.test.ts.
 */
export function loadWorkspace(id: string, fromStage?: StageName, agentsDir: string = AGENTS_DIR): Either<string, ResumeContext> {
  const ws = readWorkspaceState(agentsDir, id);
  if (Either.isLeft(ws)) return ws;

  const state = ws.right;

  // Refuse to resume a workspace that has no remaining stage for this pipeline.
  if (state.status === "completed" || state.status === "planned") {
    return Either.left(`workspace agents/${id} is already ${state.status} — nothing to resume (hand off to /adw-implement, or rerun with --from-stage)`);
  }

  // Recover description.
  const description = state.description ?? "";
  if (!description) {
    return Either.left(`workspace agents/${id} has no description in its state — pass a description to resume`);
  }

  // Recover completedStages: explicit field first, else infer from agents array.
  let completedStages: StageName[];
  if (Array.isArray(state.completed_stages)) {
    completedStages = state.completed_stages.filter(
      (s): s is StageName => s === "plan" || s === "review",
    );
  } else {
    completedStages = [];
    const agents = state.agents ?? [];
    if (agents.includes("planner")) completedStages.push("plan");
    if (agents.includes("reviewer")) completedStages.push("review");
  }

  // Recover specPath: state field first, else events fallback.
  const specPath = state.spec_path ?? recoverSpecPathFromEvents(agentsDir, id) ?? null;

  // Determine resumeFrom: override first, else auto-detect (first incomplete stage).
  let resumeFrom: StageName;
  if (fromStage) {
    resumeFrom = fromStage;
  } else {
    const firstIncomplete = STAGE_ORDER.find((s) => !completedStages.includes(s));
    if (!firstIncomplete) {
      // Both stages already complete but status wasn't "planned"/"completed"
      // (e.g. "running" or "failed" with full completed_stages). There is no
      // valid post-review StageName in this orchestrator to resume to.
      return Either.left(
        `workspace agents/${id} has both plan and review completed — nothing to resume in this pipeline. ` +
        `Hand off to /adw-implement, or rerun with --from-stage review.`,
      );
    }
    resumeFrom = firstIncomplete;
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

// ---------------------------------------------------------------------------
// Injectable stage functions (so tests can mock them without spawning subprocesses)
// ---------------------------------------------------------------------------

export interface PipelineDeps {
  runPlan: (description: string, forcedType: PlanType | undefined, id: string) => Promise<Either<string, PlanResult>>;
  runSpecReview: (specPath: string, id: string) => Promise<Either<string, SpecReviewResult>>;
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
  };
}

/** The two-stage pipeline as a declarative config (AC8.2). */
const PIPELINE_CONFIG: PipelineConfig<StageName, PipelineDeps, PipelineResult["stages"], PipelineResult> = {
  pipelineName: "adw-plan-reviewspec",
  successStatus: "planned",
  agentsFor: (stages) => {
    const agents: string[] = [];
    if (stages.plan) agents.push("planner");
    if (stages.review) agents.push("reviewer", "upgrader");
    return agents;
  },
  buildResult: (ctx, stages) => ({ id: ctx.id, specPath: ctx.specPath!, stages }),
  stages: [
    {
      name: "plan",
      posLabel: "1/2",
      scriptName: "plan",
      shouldRun: (args, resume) => !args.specPathInput && (!resume || resume.resumeFrom === "plan"),
      skipReason: (args) => args.specPathInput ? "spec path given as input" : "already completed",
      run: async (deps, ctx) => deps.runPlan(ctx.description, undefined, ctx.id),
      abortOnEmptySpec: (result) => {
        const r = result as PlanResult;
        return r.specPath === null ? "plan stage produced no spec — nothing to review" : null;
      },
      complete: (result, ctx) => {
        const r = result as PlanResult;
        ctx.specPath = r.specPath;
        return { event: { event: "stage-complete", stage: "plan", spec_path: r.specPath } };
      },
    },
    {
      name: "review",
      posLabel: "2/2",
      scriptName: "spec-review",
      shouldRun: (_args, resume) => !resume || resume.resumeFrom === "review",
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
  ],
};

/**
 * Run the 2-stage planning pipeline (or resume it). Returns
 * Either<string, PipelineResult> — Left on any stage failure (with orchestrator
 * state written to failed), Right with the workspace id, the surviving specPath,
 * and each stage's result.
 *
 * On success (or successful resume), finalizes the workspace with
 * `status: "planned"` and `completed_stages: ["plan","review"]` — this is the
 * contract that lets `/adw-implement --resume <id>` skip straight to build.
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

  // The forcedType flag is orchestrator-specific; thread it into runPlan by
  // currying the deps. StageRunArgs carries it for any future stage that needs
  // to read it directly, but plan reads it through this closure.
  const forcedType = args.forcedType;
  const depsWithForcedType: PipelineDeps = {
    runPlan: (description, _ignored, id) => deps.runPlan(description, forcedType, id),
    runSpecReview: deps.runSpecReview,
  };

  const stageRunArgs: StageRunArgs & { description?: string; specPath?: string; id?: string } = {
    description: args.description,
    specPath: args.specPath,
    id: args.id,
    specPathInput: !!args.specPath,
    forcedType: args.forcedType,
  };

  return runLinearPipeline<StageName, PipelineDeps, PipelineResult["stages"], PipelineResult>(
    PIPELINE_CONFIG,
    depsWithForcedType,
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
  main().then((code) => process.exit(code));
}
