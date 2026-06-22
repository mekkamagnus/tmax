/**
 * @file adw-pipeline-loop.test.ts
 * @description Deterministic unit tests for adws/adw-plan-review-build-patch.ts.
 * No live `claude`, no live `codex`, no real `agents/` mutation beyond temp
 * state files written by runPipeline (which uses the real AGENTS_DIR — these
 * tests create throwaway orchestrator-id dirs that are cleaned up after).
 *
 * All four stages are mocked via PipelineDeps — the tests assert the
 * orchestrator's stage-chaining, patch-review loop, retry counting, gap-release,
 * resume-mid-loop, and error-recording behavior.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Either } from "../../src/utils/task-either.ts";
import {
  parseArgs,
  runPipeline,
  loadWorkspace,
  type PipelineDeps,
  type OrchestratorArgs,
  type PlanResult,
  type SpecReviewResult,
  type BuildOutcome,
  type PatchReviewResult,
  type TestOutcome,
} from "../../adws/adw-plan-review-build-patch.ts";

// Track created orchestrator-id dirs so we can clean them up.
const createdIds: string[] = [];
const AGENTS_DIR = join(process.cwd(), "agents");

beforeEach(() => {
  createdIds.length = 0;
});

afterEach(() => {
  // Best-effort cleanup of any agents/{id}/ dirs created during the test.
  for (const id of createdIds) {
    const dir = join(AGENTS_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockPlan = (specPath: string | null): PlanResult => ({
  id: "PLANTEST01",
  specPath,
});

const mockReview = (kind: "pass" | "upgraded" | "unchanged"): SpecReviewResult => ({
  id: "REVIEWTEST",
  specPath: "/abs/spec.md",
  kind,
});

const mockBuild = (): BuildOutcome => ({
  id: "BUILDTEST1",
  specPath: "/abs/spec.md",
});

const mockPatchPass = (): PatchReviewResult => ({
  id: "PATCHTEST1",
  verdict: "pass",
  specPath: "/abs/spec.md",
});

const mockPatchGaps = (): PatchReviewResult => ({
  id: "PATCHTEST1",
  verdict: "gaps",
  specPath: "/abs/spec.md",
});

const mockTestPass = (): TestOutcome => ({
  id: "TESTTEST1",
  verdict: "pass",
  specPath: "/abs/spec.md",
});

/**
 * Build mock deps whose stages return canned values or sequences. The patch
 * and build stages support an array of Eithers — each call pops the next.
 * This enables testing the loop (gaps→rebuild→gaps→rebuild→pass).
 */
function mockDeps(opts: {
  plan?: Either<string, PlanResult>;
  review?: Either<string, SpecReviewResult>;
  build?: Either<string, BuildOutcome> | Array<Either<string, BuildOutcome>>;
  patch?: Either<string, PatchReviewResult> | Array<Either<string, PatchReviewResult>>;
  test?: Either<string, TestOutcome> | Array<Either<string, TestOutcome>>;
} = {}): PipelineDeps & {
  planCalls: Array<{ description: string; forcedType?: string; id: string }>;
  reviewCalls: Array<{ input: string; id: string }>;
  buildCalls: Array<{ input: string; modelOverride?: string; id: string }>;
  patchCalls: Array<{ input: string; modelOverride?: string; id: string }>;
} {
  const planCalls: Array<{ description: string; forcedType?: string; id: string }> = [];
  const reviewCalls: Array<{ input: string; id: string }> = [];
  const buildCalls: Array<{ input: string; modelOverride?: string; id: string }> = [];
  const patchCalls: Array<{ input: string; modelOverride?: string; id: string }> = [];

  const buildQueue = Array.isArray(opts.build) ? [...opts.build] : null;
  const patchQueue = Array.isArray(opts.patch) ? [...opts.patch] : null;
  const testQueue = Array.isArray(opts.test) ? [...opts.test] : null;

  return {
    planCalls,
    reviewCalls,
    buildCalls,
    patchCalls,
    runPlan: async (description, forcedType, id) => {
      planCalls.push({ description, forcedType, id });
      return opts.plan ?? Either.right(mockPlan("/abs/spec.md"));
    },
    runSpecReview: async (input, id) => {
      reviewCalls.push({ input, id });
      return opts.review ?? Either.right(mockReview("pass"));
    },
    runBuild: async (input, modelOverride, id) => {
      buildCalls.push({ input, modelOverride, id });
      if (buildQueue) {
        const next = buildQueue.shift();
        return next ?? Either.right(mockBuild());
      }
      return opts.build && !Array.isArray(opts.build) ? opts.build : Either.right(mockBuild());
    },
    runTest: async () => {
      if (testQueue) {
        const next = testQueue.shift();
        return next ?? Either.right(mockTestPass());
      }
      return opts.test && !Array.isArray(opts.test) ? opts.test : Either.right(mockTestPass());
    },
    runPatchReview: async (input, modelOverride, id) => {
      patchCalls.push({ input, modelOverride, id });
      if (patchQueue) {
        const next = patchQueue.shift();
        return next ?? Either.right(mockPatchPass());
      }
      return opts.patch && !Array.isArray(opts.patch) ? opts.patch : Either.right(mockPatchPass());
    },
  };
}

/** Track the orchestrator id from a result for cleanup. */
function trackId(result: Either<string, { id: string }>): void {
  if (Either.isRight(result)) createdIds.push(result.right.id);
}

const baseArgs = (overrides: Partial<OrchestratorArgs> = {}): OrchestratorArgs => ({
  description: "add a feature",
  ...overrides,
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  test("accepts a bare description", () => {
    const r = parseArgs(["add a feature"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.description).toBe("add a feature");
      expect(r.right.maxRetries).toBeUndefined();
    }
  });

  test("accepts --max-retries with a value", () => {
    const r = parseArgs(["--max-retries", "2", "add a feature"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.maxRetries).toBe(2);
  });

  test("accepts --from-stage patch-review", () => {
    const r = parseArgs(["--id", "01TESTWS01", "--from-stage", "patch-review"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.fromStage).toBe("patch-review");
  });

  test("rejects --max-retries 0", () => {
    const r = parseArgs(["--max-retries", "0", "add a feature"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--max-retries must be a positive integer");
  });

  test("rejects --max-retries -1", () => {
    const r = parseArgs(["--max-retries", "-1", "add a feature"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--max-retries must be a positive integer");
  });

  test("rejects --max-retries without a value", () => {
    const r = parseArgs(["--max-retries"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--max-retries requires a value");
  });

  test("--from-stage patch-review without --id → error", () => {
    const r = parseArgs(["--from-stage", "patch-review", "desc"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--from-stage requires --id");
  });

  test("detects a SPEC path and sets specPath", () => {
    const r = parseArgs(["docs/specs/SPEC-059-adw-pipeline-loop.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.specPath).toBe("docs/specs/SPEC-059-adw-pipeline-loop.md");
      expect(r.right.description).toBe("");
    }
  });

  test("--help → help sentinel", () => {
    const r = parseArgs(["--help"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left.startsWith("__help__:")).toBe(true);
  });

  test("no args → usage error", () => {
    const r = parseArgs([]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left.startsWith("__usage__:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runPipeline — fresh-run pipeline (4-stage)
// ---------------------------------------------------------------------------

describe("runPipeline — fresh run", () => {
  test("full 4-stage success: plan → review → build → patch-review(pass)", async () => {
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, baseArgs());
    trackId(result);

    expect(Either.isRight(result)).toBe(true);
    // All 4 deps called exactly once.
    expect(deps.planCalls).toHaveLength(1);
    expect(deps.reviewCalls).toHaveLength(1);
    expect(deps.buildCalls).toHaveLength(1);
    expect(deps.patchCalls).toHaveLength(1);
    // The id is shared across all stages.
    const sharedId = deps.planCalls[0]!.id;
    expect(deps.reviewCalls[0]!.id).toBe(sharedId);
    expect(deps.buildCalls[0]!.id).toBe(sharedId);
    expect(deps.patchCalls[0]!.id).toBe(sharedId);
  });

  test("final state has patch_review_verdict: pass, patch_review_iterations: 1", async () => {
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, baseArgs());
    trackId(result);
    if (Either.isLeft(result)) throw new Error("expected success");

    const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
    expect(state.status).toBe("completed");
    expect(state.patch_review_verdict).toBe("pass");
    expect(state.patch_review_iterations).toBe(1);
    expect(state.completed_stages).toEqual(["plan", "review", "build", "test", "patch-review"]);
    expect(state.agents).toContain("patch-reviewer");
    expect(state.agents).toContain("tester");
  });
});

// ---------------------------------------------------------------------------
// runPipeline — build↔patch-review loop
// ---------------------------------------------------------------------------

describe("runPipeline — build↔patch-review loop", () => {
  test("patch-review gaps on first try, pass on second iteration", async () => {
    const deps = mockDeps({
      patch: [
        Either.right(mockPatchGaps()),  // iteration 1: gaps
        Either.right(mockPatchPass()),  // iteration 2: pass
      ],
    });
    const result = await runPipeline(deps, baseArgs());
    trackId(result);

    expect(Either.isRight(result)).toBe(true);
    // build called twice (initial + 1 retry), patch called twice.
    expect(deps.buildCalls).toHaveLength(2);
    expect(deps.patchCalls).toHaveLength(2);

    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
      expect(state.patch_review_verdict).toBe("pass");
      expect(state.patch_review_iterations).toBe(2);
    }
  });

  test("patch-review gaps 3 times → release with patch_review_verdict: gaps", async () => {
    const deps = mockDeps({
      patch: [
        Either.right(mockPatchGaps()),
        Either.right(mockPatchGaps()),
        Either.right(mockPatchGaps()),
      ],
    });
    const result = await runPipeline(deps, baseArgs());
    trackId(result);

    expect(Either.isRight(result)).toBe(true);
    // 3 patch-review calls + initial build + 2 rebuilds = 3 build calls.
    expect(deps.patchCalls).toHaveLength(3);
    expect(deps.buildCalls).toHaveLength(3);

    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
      expect(state.status).toBe("completed"); // released, not failed
      expect(state.patch_review_verdict).toBe("gaps");
      expect(state.patch_review_iterations).toBe(3);
    }
  });

  test("--max-retries 1: patch-review gaps once → immediately release (no rebuild)", async () => {
    const deps = mockDeps({
      patch: [Either.right(mockPatchGaps())],
    });
    const result = await runPipeline(deps, baseArgs({ maxRetries: 1 }));
    trackId(result);

    expect(Either.isRight(result)).toBe(true);
    // Only 1 patch-review call, 1 build call (initial). No retry build.
    expect(deps.patchCalls).toHaveLength(1);
    expect(deps.buildCalls).toHaveLength(1);

    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
      expect(state.patch_review_verdict).toBe("gaps");
      expect(state.patch_review_iterations).toBe(1);
    }
  });

  test("patch-review subprocess crashes (Left) → pipeline fails at patch-review", async () => {
    const deps = mockDeps({
      patch: Either.left("claude not found"),
    });
    const result = await runPipeline(deps, baseArgs());
    trackId(result);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("patch-review stage failed");
  });

  test("build fails on retry → pipeline fails at build with retry marker", async () => {
    const deps = mockDeps({
      patch: [Either.right(mockPatchGaps())],
      build: [
        Either.right(mockBuild()),   // initial build succeeds
        Either.left("implement failed on retry"),
      ],
    });
    const result = await runPipeline(deps, baseArgs());
    trackId(result);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("build stage failed (retry 1)");
  });
});

// ---------------------------------------------------------------------------
// runPipeline — spec-path input (skip plan)
// ---------------------------------------------------------------------------

describe("runPipeline — spec-path input", () => {
  test("skips plan and goes straight to review → build → patch-review", async () => {
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, { description: "", specPath: "/abs/SPEC-059.md" });
    trackId(result);

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toHaveLength(1);
    expect(deps.buildCalls).toHaveLength(1);
    expect(deps.patchCalls).toHaveLength(1);
  });

  test("final state for spec-path input includes completed_stages with all 4 stages", async () => {
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, { description: "", specPath: "/abs/SPEC-059.md" });
    trackId(result);
    if (Either.isLeft(result)) throw new Error("expected success");

    const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
    expect(state.completed_stages).toEqual(["plan", "review", "build", "test", "patch-review"]);
    expect(state.spec_path).toBe("/abs/SPEC-059.md");
  });
});

// ---------------------------------------------------------------------------
// Resume tests
// ---------------------------------------------------------------------------

/** Seed a workspace state file at agents/{id}/adw-state.json for resume tests. */
function seedWorkspaceState(
  id: string,
  state: Record<string, unknown>,
): void {
  createdIds.push(id);
  const dir = join(AGENTS_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "adw-state.json"), JSON.stringify(state, null, 2) + "\n");
}

describe("runPipeline — resume at patch-review", () => {
  test("resume at patch-review: skips plan/review/build, runs patch-review", async () => {
    const wsId = "01TESTWS02";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/abs/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder"],
    });
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, { description: "", id: wsId });

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toHaveLength(0);
    expect(deps.buildCalls).toHaveLength(0);
    expect(deps.patchCalls).toHaveLength(1);
  });
});

describe("runPipeline — resume mid-loop after GAPS before rebuild", () => {
  test("patch_review_next_action=build: runs build before next patch-review", async () => {
    const wsId = "01TESTWS03";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/abs/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder"],
      patch_review_iterations: 1,
      patch_review_verdict: "gaps",
      patch_review_next_action: "build",
    });
    const deps = mockDeps({
      patch: [
        Either.right(mockPatchPass()),  // iteration 2: pass (after the rebuild)
      ],
    });
    const result = await runPipeline(deps, { description: "", id: wsId });

    expect(Either.isRight(result)).toBe(true);
    // plan/review NOT called.
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toHaveLength(0);
    // build IS called (the rebuild) — exactly once, then patch-review passes.
    expect(deps.buildCalls).toHaveLength(1);
    // patch-review called once after the rebuild.
    expect(deps.patchCalls).toHaveLength(1);

    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, wsId, "adw-state.json"), "utf8"));
      // Iteration 2 is the next patch-review after the rebuild.
      expect(state.patch_review_iterations).toBe(2);
      expect(state.patch_review_verdict).toBe("pass");
    }
  });
});

describe("runPipeline — resume mid-loop after rebuild before patch-review", () => {
  test("patch_review_next_action=patch-review: skips build, runs patch-review directly", async () => {
    const wsId = "01TESTWS04";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/abs/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder"],
      patch_review_iterations: 1,
      patch_review_verdict: "gaps",
      patch_review_next_action: "patch-review",
    });
    const deps = mockDeps({
      patch: [
        Either.right(mockPatchPass()),  // iteration 2: pass
      ],
    });
    const result = await runPipeline(deps, { description: "", id: wsId });

    expect(Either.isRight(result)).toBe(true);
    // plan/review/build NOT called — patch-review is next.
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toHaveLength(0);
    expect(deps.buildCalls).toHaveLength(0);
    expect(deps.patchCalls).toHaveLength(1);

    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, wsId, "adw-state.json"), "utf8"));
      expect(state.patch_review_iterations).toBe(2);
      expect(state.patch_review_verdict).toBe("pass");
    }
  });
});

describe("runPipeline — forced --from-stage build with prior loop state", () => {
  test("forced build restart ignores prior loop state and starts fresh", async () => {
    const wsId = "01TESTWS05";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/abs/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder", "patch-reviewer"],
      patch_review_iterations: 2,
      patch_review_verdict: "gaps",
      patch_review_next_action: "patch-review",
    });
    const deps = mockDeps({
      patch: [
        Either.right(mockPatchPass()),  // iteration 1 (fresh): pass
      ],
    });
    const result = await runPipeline(deps, { description: "", id: wsId, fromStage: "build" });

    expect(Either.isRight(result)).toBe(true);
    // Build runs before patch-review (forced restart).
    expect(deps.buildCalls).toHaveLength(1);
    expect(deps.patchCalls).toHaveLength(1);

    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, wsId, "adw-state.json"), "utf8"));
      // Loop started from scratch — iteration is 1, not based on stored 2.
      expect(state.patch_review_iterations).toBe(1);
      expect(state.patch_review_verdict).toBe("pass");
    }
  });
});

describe("runPipeline — forced --from-stage patch-review", () => {
  test("forced patch-review: skips plan/review/build, runs patch-review next", async () => {
    const wsId = "01TESTWS06";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/abs/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder"],
    });
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, { description: "", id: wsId, fromStage: "patch-review" });

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toHaveLength(0);
    expect(deps.buildCalls).toHaveLength(0);
    expect(deps.patchCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Resume validation
// ---------------------------------------------------------------------------

describe("runPipeline — resume validation", () => {
  test("--id for a nonexistent workspace → Left", async () => {
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", id: "01TESTWS99" });
    createdIds.push("01TESTWS99");
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("nothing to resume");
  });

  test("--id for an already-completed workspace → Left", async () => {
    const wsId = "01TESTWS08";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "done",
      status: "completed",
      completed_stages: ["plan", "review", "build", "patch-review"],
      spec_path: "/spec.md",
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", id: wsId });
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("already completed");
  });
});

// ---------------------------------------------------------------------------
// loadWorkspace — unit tests
// ---------------------------------------------------------------------------

describe("loadWorkspace", () => {
  test("infers patch-reviewer agent from agents array", () => {
    const wsId = "01TESTWS10";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      spec_path: "/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder", "patch-reviewer"],
    });
    const result = loadWorkspace(wsId);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.completedStages).toContain("patch-review");
    }
  });

  test("uses patch_review_next_action for auto-detect at build", () => {
    const wsId = "01TESTWS11";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder"],
      patch_review_iterations: 1,
      patch_review_verdict: "gaps",
      patch_review_next_action: "build",
    });
    const result = loadWorkspace(wsId);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.resumeFrom).toBe("build");
      expect(result.right.patchIterations).toBe(1);
      expect(result.right.patchNextAction).toBe("build");
    }
  });

  test("uses patch_review_next_action for auto-detect at patch-review", () => {
    const wsId = "01TESTWS12";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder"],
      patch_review_iterations: 1,
      patch_review_verdict: "gaps",
      patch_review_next_action: "patch-review",
    });
    const result = loadWorkspace(wsId);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.resumeFrom).toBe("patch-review");
      expect(result.right.patchNextAction).toBe("patch-review");
    }
  });

  test("forcedFromStage is set when --from-stage is supplied", () => {
    const wsId = "01TESTWS13";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder"],
      patch_review_next_action: "patch-review",
    });
    const result = loadWorkspace(wsId, "build");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.forcedFromStage).toBe(true);
      expect(result.right.resumeFrom).toBe("build");
    }
  });
});
