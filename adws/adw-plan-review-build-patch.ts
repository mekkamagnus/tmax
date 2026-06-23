#!/usr/bin/env bun
/**
 * adw-plan-review-build-patch.ts — 5-stage pipeline orchestrator
 * (plan → review → build → test → patch-review) with build↔test↔patch retry loop.
 *
 * Takes a free-text description, runs it through the five adw stages in sequence
 * by spawning each child as a subprocess, parses each child's `<id> <...>` stdout
 * line, and feeds the result into the next stage. All children share one
 * workspace id (passed via --id), so every stage writes its events under the same
 * agents/{id}/ directory; the orchestrator owns the single adw-state.json.
 *
 *   bun adws/adw-plan-review-build-patch.ts "add a URL bar to the status line"
 *   bun adws/adw-plan-review-build-patch.ts --chore "rename adw-build-dispatcher"
 *   bun adws/adw-plan-review-build-patch.ts --model glm-4.7 "implement feature X"
 *   bun adws/adw-plan-review-build-patch.ts --max-retries 2 "implement feature X"
 *   bun adws/adw-plan-review-build-patch.ts docs/specs/SPEC-059-adw-pipeline-loop.md
 *
 * Stages (each is a subprocess: `bun adws/<child>.ts --id <id> <args>`):
 *   1. adw-plan.ts          → stdout "<id> <spec-path>" (aborts if spec-path is "-")
 *   2. adw-spec-review.ts   → stdout "<id> <pass|upgraded|unchanged> <spec-path>"
 *                            (always continues — review gaps don't block the build)
 *   3. adw-build.ts         → stdout "<id> <spec-path>"
 *   4. adw-test.ts          → stdout "<id> <pass|gaps> <spec-path>"
 *                            (always continues — test gaps are audit input)
 *   5. adw-patch-review.ts  → stdout "<id> <pass|gaps> <spec-path>"
 *   ── On GAPS, re-runs build (stage 3) → test (stage 4) → patch-review (stage 5),
 *      up to --max-retries.
 *
 * One workspace id: the orchestrator mints a single adw-id and passes it to all
 * children via --id (and sets ADW_ORCHESTRATED=1 so they skip writing their own
 * adw-state.json). Each child writes its events under agents/{id}/{agent}/.
 *
 * Exit codes: 0 = full pipeline success (pass, or gaps after max-retries);
 * 1 = usage error; 2 = any stage failed (orchestrator records which stage in its
 * error event, then stops).
 *
 * File layout per run (all under one workspace id):
 *   agents/{id}/adw-state.json             — the single workspace state
 *   agents/{id}/orchestrator/events.jsonl  — start/stage-complete/loop-retry/error
 *   agents/{id}/planner/events.jsonl       — written by adw-plan subprocess
 *   agents/{id}/reviewer/events.jsonl      — written by adw-spec-review subprocess
 *   agents/{id}/upgrader/events.jsonl      — written by adw-spec-review (if upgrade runs)
 *   agents/{id}/builder/events.jsonl       — written by adw-build subprocess
 *   agents/{id}/tester/events.jsonl        — written by adw-test subprocess
 *   agents/{id}/patch-reviewer/events.jsonl — written by adw-patch-review subprocess
 */
import { spawn } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "path";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import type { PlanType } from "./adws-modules/agent.ts";
import { withHeartbeat } from "./adws-modules/heartbeat.ts";
import { withStallWatch, DEFAULT_STALL_MS } from "./adws-modules/stall-detector.ts";
import { findWorkspaceBySpecPath } from "./adws-modules/workspace.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");

/**
 * Captured once at orchestrator startup — written into adw-state.json so the
 * Layer-2 watchdog can reject PID reuse when deciding whether to auto-resume.
 */
const ORCHESTRATOR_PID = process.pid;
const ORCHESTRATOR_STARTED_AT_MS = Date.now();

/** 10-char Crockford Base32 ULID-timestamp — the workspace id shape. */
const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
type StageName = "plan" | "review" | "build" | "test" | "patch-review";
const STAGE_ORDER: readonly StageName[] = ["plan", "review", "build", "test", "patch-review"];

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-plan-review-build-patch.ts [--feature|--bug|--chore] [--model <id>] [--max-retries <N>] "<description>"
       bun adws/adw-plan-review-build-patch.ts [--model <id>] [--max-retries <N>] <spec-path>
       bun adws/adw-plan-review-build-patch.ts --id <workspace-id> [--from-stage <plan|review|build|test|patch-review>]

Runs the adw pipeline (plan → spec-review → build → test → patch-review) and prints
"<workspace-id> <spec-path>" on success. When patch-review returns GAPS, the
orchestrator re-runs build → test → patch-review, up to --max-retries times (default 3).
After the retry bound, the pipeline releases to completed with
patch_review_verdict: "gaps" in the state file.

  <description>             A free-text task description. Plan runs first,
                            creating a spec, then spec-review, build, and
                            patch-review follow.
  <spec-path>               An existing docs/specs/{SPEC,BUG,CHORE}-*.md path.
                            Plan is SKIPPED (the spec already exists); the
                            pipeline starts at spec-review → build → patch-review.
  --feature/--bug/--chore   Skip the classifier in the plan stage; dispatch
                            directly to that skill. (Description mode only.)
  --model <id>              Override the build stage's model (stage 3 only).
  --max-retries <N>         Max build↔patch-review cycles (default 3). Must be > 0.
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
  specPath?: string; // when the input is an existing spec path, plan is skipped
  maxRetries?: number; // max build↔patch cycles (default 3)
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
  let modelOverride: string | undefined;
  let id: string | undefined;
  let fromStage: StageName | undefined;
  let maxRetries: number | undefined;
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
      if (val !== "plan" && val !== "review" && val !== "build" && val !== "test" && val !== "patch-review") {
        return Either.left(`--from-stage must be one of: plan, review, build, test, patch-review (got "${val}").`);
      }
      fromStage = val;
    } else if (a === "--max-retries") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--max-retries requires a value.");
      const n = parseInt(val, 10);
      if (isNaN(n) || n <= 0) return Either.left(`--max-retries must be a positive integer (got "${val}").`);
      maxRetries = n;
    } else if (description === "" && specPath === undefined) {
      // First positional: spec path → skip plan; otherwise → description for plan.
      if (looksLikeSpecPath(a)) specPath = a;
      else description = a;
    } else return Either.left(`Unexpected extra argument: ${a}`);
  }
  if (typeFlags > 1) return Either.left("Specify at most one of --feature/--bug/--chore.");
  // --from-stage applies to either an explicit --id OR a spec path (which can
  // discover a workspace). It remains rejected for free-text descriptions,
  // which have no workspace id or spec path to resolve to.
  if (fromStage && !id && !specPath) return Either.left("--from-stage requires --id or a spec path (it only makes sense when resuming).");
  if (forcedType && specPath) return Either.left("--feature/--bug/--chore require a description (plan stage), but a spec path was given (plan is skipped).");
  // description OR specPath OR --id is required.
  if (!description && !specPath && !id) return Either.left(`__usage__:${USAGE}`);
  return Either.right({ description, forcedType, modelOverride, id, fromStage, specPath, maxRetries });
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
  status?: "running" | "completed" | "failed";
  agents?: string[];
  failed_stage?: StageName;
  completed_stages?: StageName[];
  spec_path?: string;
  patch_review_verdict?: "pass" | "gaps";
  patch_review_iterations?: number;
  patch_review_next_action?: "build" | "patch-review";
  error?: string;
}

/** What runPipeline needs to know to resume correctly. */
export interface ResumeContext {
  description: string;
  specPath: string | null;
  completedStages: StageName[];
  resumeFrom: StageName;
  patchIterations?: number; // seed the loop counter on resume
  patchNextAction?: "build" | "patch-review"; // exact pending loop action
  forcedFromStage?: boolean; // true when --from-stage supplied explicitly
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
 * - Auto-detection: the first stage NOT in completedStages, in plan→review→build→patch-review order.
 *   However, if patch_review_next_action is set, use that to determine mid-loop resume.
 * - specPath recovery: state.spec_path first, else events.jsonl fallback.
 * - completedStages: state.completed_stages if present; else inferred from agents array.
 */
export function loadWorkspace(id: string, fromStage?: StageName, agentsDir: string = AGENTS_DIR): Either<string, ResumeContext> {
  const ws = readWorkspaceState(id, agentsDir);
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
    completedStages = state.completed_stages;
  } else {
    completedStages = [];
    const agents = state.agents ?? [];
    if (agents.includes("planner")) completedStages.push("plan");
    if (agents.includes("reviewer")) completedStages.push("review");
    if (agents.includes("builder")) completedStages.push("build");
    if (agents.includes("tester")) completedStages.push("test");
    if (agents.includes("patch-reviewer")) completedStages.push("patch-review");
  }

  // Recover specPath: state field first, else events fallback.
  const specPath = state.spec_path ?? recoverSpecPathFromEvents(id, agentsDir) ?? null;

  // Determine resumeFrom: override first, else auto-detect using patch_review_next_action.
  let resumeFrom: StageName;
  let forcedFromStage = false;
  if (fromStage) {
    resumeFrom = fromStage;
    forcedFromStage = true;
  } else if (state.patch_review_next_action === "build") {
    // GAPS was recorded and the rebuild that should address it has not completed.
    resumeFrom = "build";
  } else if (state.patch_review_next_action === "patch-review") {
    // The rebuild completed and the next pending action is a patch-review.
    resumeFrom = "patch-review";
  } else {
    const firstIncomplete = STAGE_ORDER.find((s) => !completedStages.includes(s));
    resumeFrom = firstIncomplete ?? "build";
  }

  const result: ResumeContext = { description, specPath, completedStages, resumeFrom, forcedFromStage };

  // Carry forward loop state for mid-loop resume.
  if (typeof state.patch_review_iterations === "number") {
    result.patchIterations = state.patch_review_iterations;
  }
  if (state.patch_review_next_action === "build" || state.patch_review_next_action === "patch-review") {
    result.patchNextAction = state.patch_review_next_action;
  }

  return Either.right(result);
}

// ---------------------------------------------------------------------------
// Subprocess stage execution
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
export interface TestOutcome {
  id: string;
  verdict: "pass" | "gaps";
  specPath: string;
}
export interface PatchReviewResult {
  id: string;
  verdict: "pass" | "gaps";
  specPath: string;
}

/**
 * Spawn a child stage, inherit stderr, capture stdout. The child runs as a
 * detached process-group leader so Layer-1 stall detection can SIGKILL the
 * whole tree (`claude -p` + sub-agents) without orphans. Returns
 * [exitCode, stdout, stderr].
 *
 * Layer 1 (SPEC-066): wrap the wait in `withStallWatch`. If the child's raw
 * tee file (`raw-output.jsonl` under agents/<id>/<stage-dir>/) shows < 64B
 * growth for `stallMs` (default 5 min), the child's process group is SIGKILLed
 * and the close handler surfaces a non-zero exit (137). The orchestrator's
 * existing retry/error path then handles it — no new error path needed.
 *
 * `teeFile` is the raw-output path the child's `claude -p` will write to. For
 * stages without a raw-output stream (currently none), pass null to skip the
 * stall watch.
 */
function spawnStage(
  script: string,
  args: string[],
  teeFile: string | null,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn("bun", [join("adws", script), ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ADW_ORCHESTRATED: "1" },
    stdio: ["ignore", "pipe", "inherit"], // stdout captured, stderr shown live
    detached: true, // child.pid is the process-group leader → killTree(-pid) reaches all descendants
  });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  });

  const childDone = new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    child.on("error", () => resolve({ code: 1, stdout, stderr: `failed to spawn ${script}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: "" }));
  });

  // No tee file (or spawn failed synchronously without a pid) → no stall watch.
  if (!teeFile || child.pid === undefined) return childDone;

  return withStallWatch(
    {
      childPid: child.pid,
      teeFile,
      stallMs: DEFAULT_STALL_MS,
      onStall: ({ pid, stalledForMs }) => {
        process.stderr.write(
          `[adw] stall-detector: ${script} tee file ${teeFile} showed no growth for ` +
          `${Math.floor(stalledForMs / 1000)}s — SIGKILLing process group ${pid}\n`,
        );
      },
    },
    () => childDone,
  );
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
  runBuild: (specPath: string, modelOverride: string | undefined, id: string) => Promise<Either<string, BuildOutcome>>;
  runTest: (specPath: string, modelOverride: string | undefined, id: string) => Promise<Either<string, TestOutcome>>;
  runPatchReview: (specPath: string, modelOverride: string | undefined, id: string) => Promise<Either<string, PatchReviewResult>>;
}

/** The real deps — each spawns its child subprocess and parses the stdout contract. */
const realDeps: PipelineDeps = {
  runPlan: async (description, forcedType, id): Promise<Either<string, PlanResult>> => {
    const args = [description];
    if (forcedType) args.push(`--${forcedType}`);
    args.push("--id", id);
    const r = await spawnStage("adw-plan.ts", args, join(AGENTS_DIR, id, "planner", "raw-output.jsonl"));
    if (r.code !== 0) return Either.left(r.stdout || `adw-plan exited with code ${r.code}`);
    const tokens = tokensOf(r.stdout);
    // plan stdout: "<id> <spec-path>" or "<id> -"
    if (!tokens || tokens.length < 2) return Either.left(`adw-plan: unparseable stdout: ${r.stdout.slice(0, 200)}`);
    const specPath = tokens[1] === "-" ? null : tokens.slice(1).join(" ");
    return Either.right({ id: tokens[0]!, specPath });
  },

  runSpecReview: async (specPath, id): Promise<Either<string, SpecReviewResult>> => {
    const r = await spawnStage("adw-spec-review.ts", [specPath, "--id", id], join(AGENTS_DIR, id, "reviewer", "raw-output.jsonl"));
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
    const r = await spawnStage("adw-build.ts", args, join(AGENTS_DIR, id, "builder", "raw-output.jsonl"));
    if (r.code !== 0) return Either.left(r.stdout || `adw-build exited with code ${r.code}`);
    const tokens = tokensOf(r.stdout);
    // build stdout: "<id> <spec-path>"
    if (!tokens || tokens.length < 2) return Either.left(`adw-build: unparseable stdout: ${r.stdout.slice(0, 200)}`);
    return Either.right({ id: tokens[0]!, specPath: tokens.slice(1).join(" ") });
  },

  runTest: async (specPath, modelOverride, id): Promise<Either<string, TestOutcome>> => {
    const args = [specPath];
    if (modelOverride) args.push("--model", modelOverride);
    args.push("--id", id);
    // Layer-1 stall-watch is skipped for the test stage (teeFile=null). The test
    // stage has no raw-output.jsonl — its main subprocesses (`bun run test:unit`,
    // `bun run test:tmax-use`) write to stdout/stderr, not to a tee file. The
    // only file that grows during a test run is `events.jsonl`, which is a
    // lifecycle-event stream (start, unit_track, result) — exactly the kind of
    // status-event stream SPEC-066 warns must NOT be wired into Layer 1, because
    // a long bun test run (10-15 min, no events mid-suite) would false-trigger
    // a stall-kill. The test stage already has its own wall-clock timeout
    // (STAGE_RUN_TIMEOUT_MS in adw-test.ts runRaw, default 20 min) that
    // SIGKILLs the bun process tree on hang — equivalent protection.
    const r = await spawnStage("adw-test.ts", args, null);
    if (r.code !== 0) return Either.left(r.stdout || `adw-test exited with code ${r.code}`);
    const tokens = tokensOf(r.stdout);
    // test stdout: "<id> <pass|gaps> <spec-path>"
    if (!tokens || tokens.length < 3) return Either.left(`adw-test: unparseable stdout: ${r.stdout.slice(0, 200)}`);
    const verdict = tokens[1];
    if (verdict !== "pass" && verdict !== "gaps") {
      return Either.left(`adw-test: unexpected verdict "${verdict}" in stdout`);
    }
    return Either.right({ id: tokens[0]!, verdict, specPath: tokens.slice(2).join(" ") });
  },

  runPatchReview: async (specPath, modelOverride, id): Promise<Either<string, PatchReviewResult>> => {
    const args = [specPath];
    if (modelOverride) args.push("--model", modelOverride);
    args.push("--id", id);
    const r = await spawnStage("adw-patch-review.ts", args, join(AGENTS_DIR, id, "patch-reviewer", "raw-output.jsonl"));
    if (r.code !== 0) return Either.left(r.stdout || `adw-patch-review exited with code ${r.code}`);
    const tokens = tokensOf(r.stdout);
    // patch-review stdout: "<id> <pass|gaps> <spec-path>"
    if (!tokens || tokens.length < 3) return Either.left(`adw-patch-review: unparseable stdout: ${r.stdout.slice(0, 200)}`);
    const verdict = tokens[1];
    if (verdict !== "pass" && verdict !== "gaps") {
      return Either.left(`adw-patch-review: unexpected verdict "${verdict}" in stdout`);
    }
    return Either.right({ id: tokens[0]!, verdict, specPath: tokens.slice(2).join(" ") });
  },
};

// ---------------------------------------------------------------------------
// Orchestrator state shape
// ---------------------------------------------------------------------------

interface OrchestratorState {
  adw_id: string;
  description: string;
  status: "running" | "completed" | "failed";
  /** Process pid of the orchestrator (Layer-2 watchdog PID-identity check). */
  orchestrator_pid?: number;
  /** OS process start time in ms (Layer-2 watchdog PID-identity check). */
  orchestrator_started_at_ms?: number;
  agents?: string[];
  failed_stage?: StageName;
  completed_stages?: StageName[];
  spec_path?: string;
  patch_review_verdict?: "pass" | "gaps";
  patch_review_iterations?: number;
  patch_review_next_action?: "build" | "patch-review";
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
    build?: BuildOutcome;
    test?: TestOutcome;
    patchReview?: PatchReviewResult;
  };
}

/**
 * Run the full pipeline (or resume it). Returns Either<string, PipelineResult>
 * — Left on any stage failure (with orchestrator state written to failed),
 * Right with the workspace id, the surviving specPath, and each stage's result.
 *
 * After build succeeds, runs patch-review. On PASS → finalize as completed.
 * On GAPS → patch-review has appended audit findings to the spec; re-run build
 * then patch-review. Loop at most maxRetries times.
 */
export async function runPipeline(
  deps: PipelineDeps,
  args: OrchestratorArgs,
  agentsDir: string = AGENTS_DIR,
): Promise<Either<string, PipelineResult>> {
  // ── Resolve the workspace id: explicit --id, spec-path discovery, or fresh ─
  // Spec-path input consults findWorkspaceBySpecPath to reuse the most recent
  // resumable workspace for that spec — e.g. the "planned" workspace /adw-plan
  // just wrote. A "completed" workspace is refused by loadWorkspace below →
  // fall through to fresh mint, preserving the existing "rebuild a finished
  // spec" behavior. Free-text input always mints fresh (no spec to discover by).
  let id: string;
  let resume: ResumeContext | null = null;
  if (args.id) {
    id = args.id;
    const loaded = loadWorkspace(args.id, args.fromStage, agentsDir);
    if (Either.isLeft(loaded)) return Promise.resolve(Either.left(loaded.left));
    resume = loaded.right;
  } else if (args.specPath) {
    const discovered = findWorkspaceBySpecPath(agentsDir, args.specPath);
    if (discovered) {
      const loaded = loadWorkspace(discovered, args.fromStage, agentsDir);
      if (Either.isRight(loaded)) {
        id = discovered;
        resume = loaded.right;
        process.stderr.write(`adw-plan-review-build-patch: reusing workspace ${discovered} for ${args.specPath}\n`);
      } else {
        id = adwId(); // discovered but not resumable (e.g. completed) → fresh mint
      }
    } else {
      id = adwId(); // no prior workspace for this spec → fresh mint
    }
  } else {
    id = adwId();
  }

  // ── Resolve the description: from args, specPath (plan skipped), or state ─
  const description = args.description || args.specPath || resume?.description || "";
  if (!description) {
    return Promise.resolve(Either.left("description required for fresh runs (or pass --id to resume)"));
  }

  // ── State + stages setup ─────────────────────────────────────────────────
  const completedStages: StageName[] = resume ? [...resume.completedStages] : [];
  // specPath: from explicit spec-path input, resume recovery, or null (plan will produce it).
  let specPath: string | null = args.specPath ?? resume?.specPath ?? null;
  const stages: PipelineResult["stages"] = {} as PipelineResult["stages"];
  // Seed stages object for finalize's agents computation: skipped stages still
  // count as "ran" historically.
  if (args.specPath && !completedStages.includes("plan")) {
    completedStages.push("plan");
  }
  if (completedStages.includes("plan")) {
    stages.plan = { id, specPath };
  }
  if (completedStages.includes("review") && specPath) {
    stages.review = { id, specPath, kind: "pass" };
  }
  if (completedStages.includes("build") && specPath) {
    stages.build = { id, specPath };
  }

  const state: OrchestratorState = {
    adw_id: id,
    description,
    status: "running",
    orchestrator_pid: ORCHESTRATOR_PID,
    orchestrator_started_at_ms: ORCHESTRATOR_STARTED_AT_MS,
    completed_stages: completedStages,
    ...(specPath ? { spec_path: specPath } : {}),
  };

  // Helper to finalize state + return a Left (stage failure) or Right (success).
  const finalize = async (result: Either<string, PipelineResult>): Promise<Either<string, PipelineResult>> => {
    const agents: string[] = [];
    if (stages.plan) agents.push("planner");
    if (stages.review) agents.push("reviewer", "upgrader");
    if (stages.build) agents.push("builder");
    if (stages.test) agents.push("tester");
    if (stages.patchReview) agents.push("patch-reviewer");
    const finalState: OrchestratorState = { ...state, agents, completed_stages: completedStages };
    if (specPath) finalState.spec_path = specPath;
    if (state.patch_review_verdict) finalState.patch_review_verdict = state.patch_review_verdict;
    if (state.patch_review_iterations !== undefined) finalState.patch_review_iterations = state.patch_review_iterations;
    if (state.patch_review_next_action) finalState.patch_review_next_action = state.patch_review_next_action;
    if (Either.isLeft(result)) {
      await writeState(id, { ...finalState, status: "failed", error: result.left } as Record<string, unknown>, agentsDir).run();
    } else {
      await writeState(id, { ...finalState, status: "completed" } as Record<string, unknown>, agentsDir).run();
    }
    return result;
  };

  // Checkpoint: write the current running-state to disk after each stage completes.
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
      `adw-plan-review-build-patch: resuming workspace ${id} from stage "${resume.resumeFrom}" ` +
      `(completed: ${resume.completedStages.join(",") || "none"})\n`,
    );
  } else {
    appendEvent(id, { event: "start", description }, agentsDir);
  }

  // ── Stage 1: plan (skip if spec-path input, already completed, or resuming past it) ──
  const shouldRunPlan = !args.specPath && (!resume || resume.resumeFrom === "plan");
  if (shouldRunPlan) {
    process.stderr.write("adw-plan-review-build-patch: stage 1/5 — plan\n");
    const planRes = await withHeartbeat(
      { stage: "plan", teeFile: join(agentsDir, id, "planner", "raw-output.jsonl") },
      () => deps.runPlan(description, args.forcedType, id),
    );
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
      return finalize(Either.left("plan stage produced no spec — nothing to review or build"));
    }
    if (!completedStages.includes("plan")) completedStages.push("plan");
    await checkpoint();
  } else {
    const reason = args.specPath ? "spec path given as input" : "already completed";
    process.stderr.write(`adw-plan-review-build-patch: stage 1/5 — plan [SKIPPED, ${reason}]\n`);
    if (args.specPath) {
      appendEvent(id, { event: "stage-complete", stage: "plan", spec_path: args.specPath, skipped: true, reason: "spec-path input" }, agentsDir);
    }
  }

  // specPath is required from here on.
  if (!specPath) {
    state.failed_stage = "review";
    return finalize(Either.left("cannot proceed to review: no spec path (plan not completed and no recovered path)"));
  }
  const specPathForLater = specPath;

  // ── Stage 2: spec-review (skip if resuming past it) ──────────────────────
  const shouldRunReview = !resume || (resume.resumeFrom !== "build" && resume.resumeFrom !== "test" && resume.resumeFrom !== "patch-review");
  if (shouldRunReview) {
    process.stderr.write("adw-plan-review-build-patch: stage 2/5 — spec-review\n");
    const reviewRes = await withHeartbeat(
      { stage: "spec-review", teeFile: join(agentsDir, id, "reviewer", "raw-output.jsonl") },
      () => deps.runSpecReview(specPathForLater, id),
    );
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
    process.stderr.write(`adw-plan-review-build-patch: stage 2/5 — spec-review [SKIPPED, already completed]\n`);
  }

  // ── Stage 3: build (runs unless resuming directly at test or patch-review) ───
  const forcedBuildRestart = resume?.forcedFromStage && resume.resumeFrom === "build";
  const shouldRunInitialBuild = !resume || (resume.resumeFrom !== "test" && resume.resumeFrom !== "patch-review");
  if (shouldRunInitialBuild) {
    process.stderr.write("adw-plan-review-build-patch: stage 3/5 — build\n");
    const buildRes = await withHeartbeat(
      { stage: "build", teeFile: join(agentsDir, id, "builder", "raw-output.jsonl") },
      () => deps.runBuild(specPathForLater, args.modelOverride, id),
    );
    if (Either.isLeft(buildRes)) {
      appendEvent(id, { event: "stage-error", stage: "build", detail: buildRes.left }, agentsDir);
      state.failed_stage = "build";
      return finalize(Either.left(`build stage failed: ${buildRes.left}`));
    }
    stages.build = buildRes.right;
    appendEvent(id, { event: "stage-complete", stage: "build", spec_path: buildRes.right.specPath }, agentsDir);
    if (!completedStages.includes("build")) completedStages.push("build");
    await checkpoint();
  } else {
    process.stderr.write(`adw-plan-review-build-patch: stage 3/5 — build [SKIPPED, resuming at test or patch-review]\n`);
  }

  // ── Stage 4: test (runs after build, on initial build AND on every retry build) ──
  // Inserted between build and patch-review. Runs `bun run test:unit` + `bun run
  // test:tmax-use` with a resolve-then-rerun loop per track. Test `gaps` does NOT
  // hard-stop the pipeline — patch-review sees the failing tests in results.json
  // and factors them into its verdict.
  const forcedTestRestart = resume?.forcedFromStage && resume.resumeFrom === "test";
  const shouldRunInitialTest = !resume || (resume.resumeFrom !== "patch-review");
  if (shouldRunInitialTest) {
    process.stderr.write("adw-plan-review-build-patch: stage 4/5 — test\n");
    const testRes = await withHeartbeat(
      { stage: "test", teeFile: join(agentsDir, id, "tester", "events.jsonl") },
      () => deps.runTest(specPathForLater, args.modelOverride, id),
    );
    if (Either.isLeft(testRes)) {
      appendEvent(id, { event: "stage-error", stage: "test", detail: testRes.left }, agentsDir);
      state.failed_stage = "test";
      return finalize(Either.left(`test stage failed: ${testRes.left}`));
    }
    stages.test = testRes.right;
    appendEvent(id, {
      event: "stage-complete",
      stage: "test",
      verdict: testRes.right.verdict,
      spec_path: testRes.right.specPath,
    }, agentsDir);
    if (!completedStages.includes("test")) completedStages.push("test");
    await checkpoint();
    if (testRes.right.verdict === "gaps") {
      process.stderr.write(
        `adw-plan-review-build-patch: test returned gaps (continuing to patch-review — gaps are audit input)\n`,
      );
    }
  } else {
    process.stderr.write(`adw-plan-review-build-patch: stage 4/5 — test [SKIPPED, resuming at patch-review]\n`);
  }
  // forcedTestRestart is captured for clarity but the resume path above already
  // reruns test when forcedFromStage is "test". The variable is intentionally
  // unused downstream to avoid dead state writes; the unused warning is muted
  // by referencing it once here.
  void forcedTestRestart;

  // ── Stage 5: patch-review + build→test→patch-review loop ────────────────
  // After the first build + test succeed (or release with gaps), run patch-review.
  // On PASS → finalize. On GAPS → patch-review appended audit findings to the
  // spec; re-run build → test → patch-review. Loop at most maxRetries times.
  // After the bound, release to completed with patch_review_verdict: "gaps".
  const maxRetries = args.maxRetries ?? 3;
  // On forced --from-stage build, ignore prior loop state: seed at 0.
  let patchIterations = forcedBuildRestart ? 0 : resume?.patchIterations ?? 0;

  // If forced restart from build, clear prior loop state.
  if (forcedBuildRestart) {
    delete state.patch_review_iterations;
    delete state.patch_review_verdict;
    delete state.patch_review_next_action;
  }

  while (patchIterations < maxRetries) {
    patchIterations++;
    process.stderr.write(
      `adw-plan-review-build-patch: stage 5/5 — patch-review (iteration ${patchIterations}/${maxRetries})\n`,
    );
    const patchRes = await withHeartbeat(
      {
        stage: `patch-review (iteration ${patchIterations}/${maxRetries})`,
        teeFile: join(agentsDir, id, "patch-reviewer", "raw-output.jsonl"),
      },
      () => deps.runPatchReview(specPathForLater, args.modelOverride, id),
    );
    if (Either.isLeft(patchRes)) {
      appendEvent(id, { event: "stage-error", stage: "patch-review", detail: patchRes.left, iteration: patchIterations }, agentsDir);
      state.failed_stage = "patch-review";
      return finalize(Either.left(`patch-review stage failed: ${patchRes.left}`));
    }
    stages.patchReview = patchRes.right;
    appendEvent(id, {
      event: "stage-complete",
      stage: "patch-review",
      verdict: patchRes.right.verdict,
      iteration: patchIterations,
      spec_path: patchRes.right.specPath,
    }, agentsDir);

    const patchVerdict = patchRes.right.verdict;
    state.patch_review_verdict = patchVerdict;
    state.patch_review_iterations = patchIterations;

    if (patchVerdict === "pass") {
      // Gaps closed — finalize as completed.
      delete state.patch_review_next_action;
      if (!completedStages.includes("patch-review")) completedStages.push("patch-review");
      await writeState(id, state as unknown as Record<string, unknown>, agentsDir).run();
      return finalize(Either.right({ id, specPath: specPathForLater, stages }));
    }

    // Persist immediately after every GAPS verdict so an interrupted run can
    // resume with the correct iteration count and pending rebuild action.
    state.patch_review_next_action = patchIterations < maxRetries ? "build" : "patch-review";
    await writeState(id, state as unknown as Record<string, unknown>, agentsDir).run();

    // GAPS — patch-review appended findings to the spec. If we have retries
    // left, re-run build → test; the next patch-review will re-audit the fixed
    // code and see the fresh results.json. Do NOT route retry builds directly
    // back to patch-review — the build→test→patch invariant must hold.
    if (patchIterations < maxRetries) {
      process.stderr.write(
        `adw-plan-review-build-patch: patch-review returned gaps (iteration ${patchIterations}); re-running build → test\n`,
      );
      appendEvent(id, { event: "loop-retry", from: "patch-review", to: "build", iteration: patchIterations, verdict: "gaps" }, agentsDir);
      const rebuildRes = await withHeartbeat(
        {
          stage: `build (retry ${patchIterations})`,
          teeFile: join(agentsDir, id, "builder", "raw-output.jsonl"),
        },
        () => deps.runBuild(specPathForLater, args.modelOverride, id),
      );
      if (Either.isLeft(rebuildRes)) {
        appendEvent(id, { event: "stage-error", stage: "build", detail: rebuildRes.left, iteration: patchIterations, retry: true }, agentsDir);
        state.failed_stage = "build";
        return finalize(Either.left(`build stage failed (retry ${patchIterations}): ${rebuildRes.left}`));
      }
      stages.build = rebuildRes.right;
      appendEvent(id, {
        event: "stage-complete",
        stage: "build",
        iteration: patchIterations,
        retry: true,
        spec_path: specPathForLater,
      }, agentsDir);
      // Invalidate prior test completion — the retry build requires a fresh
      // test run before the next patch-review attempt. Resume must NOT skip
      // the post-retry-build test rerun.
      const testIdx = completedStages.indexOf("test");
      if (testIdx >= 0) completedStages.splice(testIdx, 1);
      state.patch_review_next_action = "patch-review";
      await writeState(id, state as unknown as Record<string, unknown>, agentsDir).run();

      // Re-run test stage after the retry build.
      process.stderr.write(
        `adw-plan-review-build-patch: stage 4/5 — test (retry ${patchIterations})\n`,
      );
      const retestRes = await withHeartbeat(
        {
          stage: `test (retry ${patchIterations})`,
          teeFile: join(agentsDir, id, "tester", "events.jsonl"),
        },
        () => deps.runTest(specPathForLater, args.modelOverride, id),
      );
      if (Either.isLeft(retestRes)) {
        appendEvent(id, { event: "stage-error", stage: "test", detail: retestRes.left, iteration: patchIterations, retry: true }, agentsDir);
        state.failed_stage = "test";
        return finalize(Either.left(`test stage failed (retry ${patchIterations}): ${retestRes.left}`));
      }
      stages.test = retestRes.right;
      appendEvent(id, {
        event: "stage-complete",
        stage: "test",
        verdict: retestRes.right.verdict,
        iteration: patchIterations,
        retry: true,
        spec_path: specPathForLater,
      }, agentsDir);
      if (!completedStages.includes("test")) completedStages.push("test");
      await writeState(id, state as unknown as Record<string, unknown>, agentsDir).run();
      // Loop continues to the next patch-review iteration.
    }
  }

  // Loop bound reached — release to completed with unresolved gaps.
  process.stderr.write(
    `adw-plan-review-build-patch: max retries (${maxRetries}) reached; releasing with patch_review_verdict=gaps\n`,
  );
  state.patch_review_verdict = "gaps";
  state.patch_review_iterations = patchIterations;
  delete state.patch_review_next_action;
  if (!completedStages.includes("patch-review")) completedStages.push("patch-review");
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
