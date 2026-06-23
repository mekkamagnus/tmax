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
 */
import { spawn } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "path";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import type { PlanType } from "./adws-modules/agent.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");

/** 10-char Crockford Base32 ULID-timestamp — the workspace id shape. */
const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
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

/** Detect whether a positional arg is a spec path (SPEC/BUG/CHORE-*.md) vs a description. */
function looksLikeSpecPath(s: string): boolean {
  const base = s.split("/").pop() ?? s;
  return /^(SPEC|BUG|CHORE)-.*\.md$/i.test(base);
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

function appendEvent(id: string, event: Record<string, unknown>, agentsDir: string = AGENTS_DIR): void {
  const dir = join(agentsDir, id, "orchestrator");
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  appendFileSync(join(dir, "events.jsonl"), line);
}

function writeState(id: string, state: Record<string, unknown>, agentsDir: string = AGENTS_DIR): TaskEither<string, void> {
  return TaskEither.tryCatch(async () => {
    const dir = join(agentsDir, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "adw-state.json"), JSON.stringify(state, null, 2) + "\n");
  }, (e) => `writeState: ${(e as Error).message}`);
}

// ---------------------------------------------------------------------------
// Resume support: load an existing workspace to recover what's already done
// ---------------------------------------------------------------------------

/** The on-disk state shape (written by this orchestrator; new fields are optional). */
interface WorkspaceState {
  adw_id: string;
  description?: string;
  status?: "running" | "completed" | "failed" | "planned";
  agents?: string[];
  failed_stage?: StageName;
  completed_stages?: StageName[];
  spec_path?: string;
  error?: string;
}

/** What runPipeline needs to know to resume correctly. */
export interface ResumeContext {
  description: string;
  specPath: string | null;
  completedStages: StageName[];
  resumeFrom: StageName;
}

/** Read agents/{id}/adw-state.json; Left if missing or unparseable. */
function readWorkspaceState(id: string, agentsDir: string = AGENTS_DIR): Either<string, WorkspaceState> {
  const stateFile = join(agentsDir, id, "adw-state.json");
  if (!existsSync(stateFile)) return Either.left(`no workspace agents/${id}/adw-state.json — nothing to resume`);
  const parsed = Either.tryCatch(() => JSON.parse(readFileSync(stateFile, "utf8")) as WorkspaceState);
  return Either.mapLeft(parsed, (e) => `failed to parse agents/${id}/adw-state.json: ${(e as Error).message}`);
}

/**
 * Recover the specPath from the orchestrator event log when the state file
 * doesn't have a `spec_path` field. Scans events.jsonl backward for the last
 * `stage-complete` event carrying a non-null spec_path.
 */
function recoverSpecPathFromEvents(id: string, agentsDir: string = AGENTS_DIR): string | null {
  const eventsFile = join(agentsDir, id, "orchestrator", "events.jsonl");
  if (!existsSync(eventsFile)) return null;
  const lines = readFileSync(eventsFile, "utf8").split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const d = JSON.parse(lines[i]!) as Record<string, unknown>;
      if (d.event === "stage-complete" && typeof d.spec_path === "string" && d.spec_path) {
        return d.spec_path as string;
      }
    } catch { /* malformed line — skip */ }
  }
  return null;
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
  const ws = readWorkspaceState(id, agentsDir);
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
  const specPath = state.spec_path ?? recoverSpecPathFromEvents(id, agentsDir) ?? null;

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
// Subprocess stage execution
//
// Each stage is a `bun adws/<child>.ts --id <id> <args>` subprocess. stderr is
// inherited so the user sees live progress ("adw-plan: classified as feature…",
// etc.); stdout carries the machine-readable "<id> <…> <spec-path>" result line.
// ADW_ORCHESTRATED=1 tells the child to skip writing its own adw-state.json.
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

/** Spawn a child stage, inherit stderr, capture stdout. Returns [exitCode, stdout, stderr]. */
function spawnStage(script: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", [join("adws", script), ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ADW_ORCHESTRATED: "1" },
      stdio: ["ignore", "pipe", "inherit"], // stdout captured, stderr shown live
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", () => resolve({ code: 1, stdout, stderr: `failed to spawn ${script}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: "" }));
  });
}

/** Parse the last non-empty stdout line as space-separated tokens. */
function tokensOf(stdout: string): string[] | null {
  const lines = stdout.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  return lines[lines.length - 1]!.trim().split(/\s+/);
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
    const r = await spawnStage("adw-plan.ts", args);
    if (r.code !== 0) return Either.left(r.stdout || `adw-plan exited with code ${r.code}`);
    const tokens = tokensOf(r.stdout);
    // plan stdout: "<id> <spec-path>" or "<id> -"
    if (!tokens || tokens.length < 2) return Either.left(`adw-plan: unparseable stdout: ${r.stdout.slice(0, 200)}`);
    const specPath = tokens[1] === "-" ? null : tokens.slice(1).join(" ");
    return Either.right({ id: tokens[0]!, specPath });
  },

  runSpecReview: async (specPath, id): Promise<Either<string, SpecReviewResult>> => {
    const r = await spawnStage("adw-spec-review.ts", [specPath, "--id", id]);
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
// Orchestrator state shape
// ---------------------------------------------------------------------------

interface OrchestratorState {
  adw_id: string;
  description: string;
  status: "running" | "planned" | "failed";
  agents?: string[]; // which agent subdirs ran under this workspace id
  failed_stage?: StageName;
  completed_stages?: StageName[]; // explicit record of which stages have finished
  spec_path?: string; // the surviving spec path (for resume recovery)
  error?: string;
}

// ---------------------------------------------------------------------------
// runPipeline() — the callable core (testable with mocked deps)
// ---------------------------------------------------------------------------

export interface PipelineResult {
  id: string;
  specPath: string;
  stages: {
    plan: PlanResult;
    review?: SpecReviewResult;
  };
}

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
  // ── Resolve the workspace id: provided (resume) or minted (fresh run) ────
  const id = args.id ?? adwId();

  // ── If resuming, load the workspace to recover what's already done ───────
  let resume: ResumeContext | null = null;
  if (args.id) {
    const loaded = loadWorkspace(args.id, args.fromStage, agentsDir);
    if (Either.isLeft(loaded)) return Promise.resolve(Either.left(loaded.left));
    resume = loaded.right;
  }

  // ── Resolve the description: from args, specPath (plan skipped), or state ─
  const description = args.description || args.specPath || resume?.description || "";
  if (!description) {
    return Promise.resolve(Either.left("description required for fresh runs (or pass --id to resume)"));
  }

  // ── State + stages setup ─────────────────────────────────────────────────
  const completedStages: StageName[] = resume ? [...resume.completedStages] : [];
  let specPath: string | null = args.specPath ?? resume?.specPath ?? null;
  const stages: PipelineResult["stages"] = {} as PipelineResult["stages"];
  // When a spec path was given as input, plan is treated as completed (the spec
  // already exists) — seed it so plan is skipped and agents includes "planner".
  if (args.specPath && !completedStages.includes("plan")) {
    completedStages.push("plan");
  }
  if (completedStages.includes("plan")) {
    stages.plan = { id, specPath };
  }
  if (completedStages.includes("review") && specPath) {
    stages.review = { id, specPath, kind: "pass" };
  }

  const state: OrchestratorState = {
    adw_id: id,
    description,
    status: "running",
    completed_stages: completedStages,
    ...(specPath ? { spec_path: specPath } : {}),
  };

  // Helper to finalize state + return a Left (stage failure) or Right (success).
  // Success finalizes as "planned" (the handoff contract); failure as "failed".
  const finalize = async (result: Either<string, PipelineResult>): Promise<Either<string, PipelineResult>> => {
    const agents: string[] = [];
    if (stages.plan) agents.push("planner");
    if (stages.review) agents.push("reviewer", "upgrader");
    const finalState: OrchestratorState = { ...state, agents, completed_stages: completedStages };
    if (specPath) finalState.spec_path = specPath;
    if (Either.isLeft(result)) {
      await writeState(id, { ...finalState, status: "failed", error: result.left } as Record<string, unknown>, agentsDir).run();
    } else {
      await writeState(id, { ...finalState, status: "planned" } as Record<string, unknown>, agentsDir).run();
    }
    return result;
  };

  // Checkpoint: write the current running-state to disk after each stage
  // completes so an interruption (SIGTERM, crash) between stages leaves a
  // state file that correctly reflects which stages finished.
  const checkpoint = async (): Promise<void> => {
    const snapshot: OrchestratorState = { ...state, completed_stages: completedStages };
    if (specPath) snapshot.spec_path = specPath;
    await writeState(id, snapshot as unknown as Record<string, unknown>, agentsDir).run();
  };

  // ── Initial state + start/resume event ───────────────────────────────────
  await writeState(id, state as unknown as Record<string, unknown>, agentsDir).run();
  if (resume) {
    appendEvent(id, {
      event: "resume",
      from_stage: resume.resumeFrom,
      completed_stages: resume.completedStages,
      recovered_spec_path: resume.specPath,
    }, agentsDir);
    process.stderr.write(
      `adw-plan-reviewspec: resuming workspace ${id} from stage "${resume.resumeFrom}" ` +
      `(completed: ${resume.completedStages.join(",") || "none"})\n`,
    );
  } else {
    appendEvent(id, { event: "start", description }, agentsDir);
  }

  // ── Stage 1: plan (skip if spec-path input, already completed, or resuming past it) ──
  const shouldRunPlan = !args.specPath && (!resume || resume.resumeFrom === "plan");
  if (shouldRunPlan) {
    process.stderr.write("adw-plan-reviewspec: stage 1/2 — plan\n");
    const planRes = await deps.runPlan(description, args.forcedType, id);
    if (Either.isLeft(planRes)) {
      appendEvent(id, { event: "stage-error", stage: "plan", detail: planRes.left }, agentsDir);
      state.failed_stage = "plan";
      return finalize(Either.left(`plan stage failed: ${planRes.left}`));
    }
    stages.plan = planRes.right;
    specPath = planRes.right.specPath;
    if (specPath) state.spec_path = specPath;
    appendEvent(id, { event: "stage-complete", stage: "plan", spec_path: planRes.right.specPath }, agentsDir);

    if (!planRes.right.specPath) {
      appendEvent(id, { event: "stage-error", stage: "plan", detail: "plan produced no spec (skill noop)" }, agentsDir);
      state.failed_stage = "plan";
      return finalize(Either.left("plan stage produced no spec — nothing to review"));
    }
    if (!completedStages.includes("plan")) completedStages.push("plan");
    await checkpoint();
  } else {
    const reason = args.specPath ? "spec path given as input" : "already completed";
    process.stderr.write(`adw-plan-reviewspec: stage 1/2 — plan [SKIPPED, ${reason}]\n`);
    if (args.specPath) {
      appendEvent(id, { event: "stage-complete", stage: "plan", spec_path: args.specPath, skipped: true, reason: "spec-path input" }, agentsDir);
    }
  }

  // specPath is required from here on (either just-produced by plan, or recovered from resume).
  if (!specPath) {
    state.failed_stage = "review";
    return finalize(Either.left("cannot proceed to review: no spec path (plan not completed and no recovered path)"));
  }
  const specPathForLater = specPath;

  // ── Stage 2: spec-review (skip if resuming past it) ──────────────────────
  // Auto-detection never produces a post-review StageName for this orchestrator,
  // so the only way shouldRunReview is false is an explicit --from-stage override
  // past review — which can't happen because the only stages are plan/review.
  // The condition is kept symmetric with the sibling orchestrators for clarity.
  const shouldRunReview = !resume || resume.resumeFrom === "review";
  if (shouldRunReview) {
    process.stderr.write("adw-plan-reviewspec: stage 2/2 — spec-review\n");
    const reviewRes = await deps.runSpecReview(specPathForLater, id);
    if (Either.isLeft(reviewRes)) {
      appendEvent(id, { event: "stage-error", stage: "review", detail: reviewRes.left }, agentsDir);
      state.failed_stage = "review";
      return finalize(Either.left(`spec-review stage failed: ${reviewRes.left}`));
    }
    stages.review = reviewRes.right;
    appendEvent(id, {
      event: "stage-complete",
      stage: "review",
      kind: reviewRes.right.kind,
      spec_path: reviewRes.right.specPath,
    }, agentsDir);
    if (!completedStages.includes("review")) completedStages.push("review");
    await checkpoint();
  } else {
    process.stderr.write(`adw-plan-reviewspec: stage 2/2 — spec-review [SKIPPED, already completed]\n`);
  }

  // ── Terminal: finalize as "planned" (the handoff contract) ───────────────
  return finalize(Either.right({ id, specPath: specPathForLater, stages }));
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
