/**
 * @file adw-pipeline-loop.test.ts
 * @description Deterministic unit tests for adws/adw-plan-review-build-patch.ts.
 * No live `claude`, no live `codex`, no real `agents/` mutation. All state I/O
 * is redirected to a per-test temp dir via the orchestrator's `agentsDir`
 * injection seam (BUG-17 / ADR-0105).
 *
 * All five stages are mocked via PipelineDeps — the tests assert the
 * orchestrator's stage-chaining, patch-review loop, retry counting, gap-release,
 * resume-mid-loop, and error-recording behavior.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
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
  type OrchestratorWorktreeDeps,
} from "../../adws/adw-plan-review-build-patch.ts";

// Per-test temp dir — runPipeline writes all state here via the agentsDir seam.
// The real repo agents/ dir is snapshotted in beforeEach/afterEach to assert
// no test pollution (BUG-17 regression guard).
let AGENTS_DIR = "";
const REAL_AGENTS_DIR = join(process.cwd(), "agents");
let realAgentsSnapshot: string[] = [];

beforeEach(() => {
  AGENTS_DIR = mkdtempSync(join(tmpdir(), "adw-pipeline-loop-test-"));
  realAgentsSnapshot = existsSync(REAL_AGENTS_DIR) ? readdirSync(REAL_AGENTS_DIR) : [];
});

afterEach(() => {
  rmSync(AGENTS_DIR, { recursive: true, force: true });
  // BUG-17 regression guard: real agents/ must be unchanged after every test.
  const after = existsSync(REAL_AGENTS_DIR) ? readdirSync(REAL_AGENTS_DIR) : [];
  expect(new Set(after)).toEqual(new Set(realAgentsSnapshot));
});

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockPlan = (specPath: string | null): PlanResult => ({
  id: "PLANTEST01",
  specPath,
});

/** Mock spec path — must be a real path inside a project/worktree root for
 * normalizeSpecPath (SPEC-065). Using a temp path that actually exists avoids
 * the "outside both projectRoot and worktreeRoot" validation error. */
const mockSpecPath = (): string => join(AGENTS_DIR, "SPEC-test.md");

const mockReview = (kind: "pass" | "upgraded" | "unchanged"): SpecReviewResult => ({
  id: "REVIEWTEST",
  specPath: mockSpecPath(),
  kind,
});

const mockBuild = (): BuildOutcome => ({
  id: "BUILDTEST1",
  specPath: mockSpecPath(),
});

const mockTestPass = (): TestOutcome => ({
  id: "TESTTEST1",
  verdict: "pass",
  specPath: mockSpecPath(),
});

const mockPatchPass = (): PatchReviewResult => ({
  id: "PATCHTEST",
  verdict: "pass",
  specPath: mockSpecPath(),
});

const mockPatchGaps = (): PatchReviewResult => ({
  id: "PATCHTEST",
  verdict: "gaps",
  specPath: mockSpecPath(),
});

/**
 * Mock worktree deps — no-op implementations that don't touch real git.
 * detectWorktree returns false (pretend we're in the main checkout) so the
 * orchestrator doesn't refuse to create a worktree inside the test's temp dir.
 * All other ops return Right with no real effect.
 */
const mockWorktreeDeps: OrchestratorWorktreeDeps = {
  // Generic signature matches OrchestratorWorktreeDeps.withPlanningLock<T>.
  withPlanningLock: async <T>(_rootPath: string, fn: () => Promise<T>): Promise<T> => fn(),
  commitSpecToMain: () => TaskEither.from(async () => Either.right({ committed: false })),
  commitWorktreeChanges: () => TaskEither.from(async () => Either.right({ committed: false })),
  createWorktree: () => TaskEither.from(async () => Either.right("")),
  createWorktreeFromBase: () => TaskEither.from(async () => Either.right("")),
  // BUG-20: default to "valid reusable worktree" so existing resume tests
  // (which don't seed a real worktree) exercise the reuse path unchanged.
  validateWorktree: () => TaskEither.from(async () => Either.right({ ok: true, path: "/mock/worktree", branch: "adw/test" })),
  removeWorktree: () => TaskEither.from(async () => Either.right(undefined)),
  detectWorktree: () => TaskEither.from(async () => Either.right(false)),
  // OrchestratorWorktreeDeps extends WorktreeDeps. gitRun returns a plausible
  // SHA so the fresh-setup base_sha capture (guarded by `typeof === "function"`)
  // records a value rather than failing on empty output.
  gitRun: () => TaskEither.from(async () => Either.right("deadbeef")),
  mergeBranchToMain: () => TaskEither.from(async () => Either.right({ sha: "deadbeef" })),
};

/**
 * BUG-20: build worktree deps whose validation + recreation are controllable,
 * and which RECORD calls (so tests assert createWorktreeFromBase is/isn't
 * invoked). The validate outcome decides whether resume reuses, recreates, or
 * refuses.
 */
function mockWorktreeDepsConfigurable(opts: {
  validate?: { ok: true; path: string; branch: string }
    | { ok: false; reason: "missing" }
    | { ok: false; reason: "not-a-worktree"; path: string }
    | { ok: false; reason: "wrong-repo"; path: string; toplevel: string }
    | { ok: false; reason: "wrong-branch"; path: string; branch: string | undefined; expected: string };
  recreate?: Either<string, string>;
} = {}): OrchestratorWorktreeDeps & {
  recreateCalls: Array<{ branch: string; worktreePath: string; baseSha: string }>;
} {
  const recreateCalls: Array<{ branch: string; worktreePath: string; baseSha: string }> = [];
  const validate = opts.validate ?? { ok: true as const, path: "/mock/worktree", branch: "adw/test" };
  const recreate = opts.recreate ?? Either.right("/mock/worktree");
  return {
    // Generic signature matches OrchestratorWorktreeDeps.withPlanningLock<T>.
    withPlanningLock: async <T>(_rootPath: string, fn: () => Promise<T>): Promise<T> => fn(),
    commitSpecToMain: () => TaskEither.from(async () => Either.right({ committed: false })),
    commitWorktreeChanges: () => TaskEither.from(async () => Either.right({ committed: false })),
    createWorktree: () => TaskEither.from(async () => Either.right("")),
    createWorktreeFromBase: (_rootPath: string, branch: string, worktreePath: string, baseSha: string) => {
      recreateCalls.push({ branch, worktreePath, baseSha });
      return TaskEither.from(async () => recreate);
    },
    validateWorktree: () => TaskEither.from(async () => Either.right(validate)),
    removeWorktree: () => TaskEither.from(async () => Either.right(undefined)),
    detectWorktree: () => TaskEither.from(async () => Either.right(false)),
    // OrchestratorWorktreeDeps extends WorktreeDeps. gitRun returns a plausible
    // SHA so the fresh-setup base_sha capture records a value.
    gitRun: () => TaskEither.from(async () => Either.right("deadbeef")),
    mergeBranchToMain: () => TaskEither.from(async () => Either.right({ sha: "deadbeef" })),
    recreateCalls,
  };
}

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
  buildCalls: Array<{ input: string; modelOverride?: string; id: string; goalCondition?: string }>;
  patchCalls: Array<{ input: string; modelOverride?: string; id: string }>;
  testCalls: Array<{ input: string; modelOverride?: string; id: string; retry?: boolean }>;
} {
  const planCalls: Array<{ description: string; forcedType?: string; id: string }> = [];
  const reviewCalls: Array<{ input: string; id: string }> = [];
  const buildCalls: Array<{ input: string; modelOverride?: string; id: string; goalCondition?: string }> = [];
  const patchCalls: Array<{ input: string; modelOverride?: string; id: string }> = [];
  const testCalls: Array<{ input: string; modelOverride?: string; id: string; retry?: boolean }> = [];

  const buildQueue = Array.isArray(opts.build) ? [...opts.build] : null;
  const patchQueue = Array.isArray(opts.patch) ? [...opts.patch] : null;
  const testQueue = Array.isArray(opts.test) ? [...opts.test] : null;

  return {
    planCalls,
    reviewCalls,
    buildCalls,
    patchCalls,
    testCalls,
    runPlan: async (description, forcedType, id) => {
      planCalls.push({ description, forcedType, id });
      return opts.plan ?? Either.right(mockPlan(mockSpecPath()));
    },
    runSpecReview: async (input, id) => {
      reviewCalls.push({ input, id });
      return opts.review ?? Either.right(mockReview("pass"));
    },
    runBuild: async (input, modelOverride, id, goalCondition) => {
      buildCalls.push({ input, modelOverride, id, goalCondition });
      if (buildQueue) {
        const next = buildQueue.shift();
        return next ?? Either.right(mockBuild());
      }
      return opts.build && !Array.isArray(opts.build) ? opts.build : Either.right(mockBuild());
    },
    runTest: async (input, modelOverride, id) => {
      // The dispatcher signature is (specPath, modelOverride, id). Track all 3
      // and mark retry invocations via call-order heuristic (initial test is
      // the 1st call; subsequent ones are retry reruns after rebuild).
      testCalls.push({ input, modelOverride, id, retry: testCalls.length > 0 });
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
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR, mockWorktreeDeps);

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
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR, mockWorktreeDeps);
    if (Either.isLeft(result)) throw new Error("expected success");

    const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
    expect(state.status).toBe("completed");
    expect(state.patch_review_verdict).toBe("pass");
    expect(state.patch_review_iterations).toBe(1);
    expect(state.completed_stages).toEqual(["plan", "review", "build", "test", "patch-review"]);
    expect(state.agents).toContain("patch-reviewer");
    expect(state.agents).toContain("tester");
  });

  test("records base_sha before worktree creation and includes from_sha on event", async () => {
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const baseSha = "abc123def456";
    const worktreeDeps = {
      ...mockWorktreeDeps,
      gitRun: () => TaskEither.from(async () => Either.right(baseSha)),
    };
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR, worktreeDeps);
    if (Either.isLeft(result)) throw new Error(result.left);

    const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
    expect(state.base_sha).toBe(baseSha);

    const events = readFileSync(join(AGENTS_DIR, result.right.id, "orchestrator", "events.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    expect(events.some((event) => event.event === "base-sha-recorded" && event.base_sha === baseSha)).toBe(true);
    expect(events.some((event) => event.event === "worktree-created" && event.from_sha === baseSha)).toBe(true);
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
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    // build called twice (initial + 1 retry), patch called twice.
    expect(deps.buildCalls).toHaveLength(2);
    expect(deps.patchCalls).toHaveLength(2);
    // test called twice — once after initial build, once after retry build.
    // The build→test→patch-review invariant requires test to be re-run after
    // every retry build, not routed directly back to patch-review.
    expect(deps.testCalls).toHaveLength(2);
    expect(deps.testCalls[0]!.retry).toBe(false);  // initial test
    expect(deps.testCalls[1]!.retry).toBe(true);   // post-retry-build test rerun
    // Sanity: build, test, patch call IDs all share the orchestrator id.
    const sharedId = deps.buildCalls[0]!.id;
    expect(deps.testCalls[0]!.id).toBe(sharedId);
    expect(deps.testCalls[1]!.id).toBe(sharedId);

    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
      expect(state.patch_review_verdict).toBe("pass");
      expect(state.patch_review_iterations).toBe(2);
    }
  });

  test("retry-build → test-rerun → patch-review invariant (direct testCalls assertion)", async () => {
    // Dedicated test for the AC#11 invariant: after a patch-review `gaps`
    // retry build, the test stage is re-run before patch-review runs again.
    // The retry build MUST NOT route directly back to patch-review.
    const deps = mockDeps({
      patch: [
        Either.right(mockPatchGaps()),  // iteration 1: gaps → retry build
        Either.right(mockPatchGaps()),  // iteration 2: gaps → retry build
        Either.right(mockPatchPass()),  // iteration 3: pass
      ],
    });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    // 3 patch-review iterations + 2 retry builds + 1 initial build = 3 build calls.
    expect(deps.buildCalls).toHaveLength(3);
    expect(deps.patchCalls).toHaveLength(3);
    // Critical assertion: test runs once after each build (initial + 2 retries = 3).
    // The invariant is build → test → patch-review on EVERY pass through the loop.
    expect(deps.testCalls).toHaveLength(3);
    expect(deps.testCalls[0]!.retry).toBe(false);  // after initial build
    expect(deps.testCalls[1]!.retry).toBe(true);   // after 1st retry build
    expect(deps.testCalls[2]!.retry).toBe(true);   // after 2nd retry build
    // Verify call ordering: build[0] → test[0] → patch[0] → build[1] → test[1] → patch[1] → ...
    // We approximate ordering by checking that test calls happen after their
    // corresponding build calls (buildCalls[N] is recorded before testCalls[N]
    // since the orchestrator's sequence is awaited).
    expect(deps.buildCalls[1]!.id).toBe(deps.testCalls[1]!.id);
    expect(deps.buildCalls[2]!.id).toBe(deps.testCalls[2]!.id);
  });

  test("patch-review gaps 3 times → release with patch_review_verdict: gaps", async () => {
    const deps = mockDeps({
      patch: [
        Either.right(mockPatchGaps()),
        Either.right(mockPatchGaps()),
        Either.right(mockPatchGaps()),
      ],
    });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR, mockWorktreeDeps);

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
    const result = await runPipeline(deps, baseArgs({ maxRetries: 1 }), AGENTS_DIR, mockWorktreeDeps);

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
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR, mockWorktreeDeps);

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
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR, mockWorktreeDeps);

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
    const result = await runPipeline(deps, { description: "", specPath: mockSpecPath() }, AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toHaveLength(1);
    expect(deps.buildCalls).toHaveLength(1);
    expect(deps.patchCalls).toHaveLength(1);
  });

  test("final state for spec-path input includes completed_stages with all 4 stages", async () => {
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, { description: "", specPath: mockSpecPath() }, AGENTS_DIR, mockWorktreeDeps);
    if (Either.isLeft(result)) throw new Error("expected success");

    const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
    expect(state.completed_stages).toEqual(["plan", "review", "build", "test", "patch-review"]);
    expect(state.spec_path).toContain("SPEC-test.md");
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
      spec_path: join(AGENTS_DIR, "SPEC-test.md"),
      agents: ["planner", "reviewer", "upgrader", "builder"],
    });
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, mockWorktreeDeps);

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
      spec_path: join(AGENTS_DIR, "SPEC-test.md"),
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
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, mockWorktreeDeps);

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
      spec_path: join(AGENTS_DIR, "SPEC-test.md"),
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
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, mockWorktreeDeps);

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
      spec_path: join(AGENTS_DIR, "SPEC-test.md"),
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
    const result = await runPipeline(deps, { description: "", id: wsId, fromStage: "build" }, AGENTS_DIR, mockWorktreeDeps);

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
      spec_path: join(AGENTS_DIR, "SPEC-test.md"),
      agents: ["planner", "reviewer", "upgrader", "builder"],
    });
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, { description: "", id: wsId, fromStage: "patch-review" }, AGENTS_DIR, mockWorktreeDeps);

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
    const result = await runPipeline(deps, { description: "", id: "01TESTWS99" }, AGENTS_DIR, mockWorktreeDeps);
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
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, mockWorktreeDeps);
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
    const result = loadWorkspace(wsId, undefined, AGENTS_DIR);
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
    const result = loadWorkspace(wsId, undefined, AGENTS_DIR);
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
    const result = loadWorkspace(wsId, undefined, AGENTS_DIR);
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
    const result = loadWorkspace(wsId, "build", AGENTS_DIR);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.forcedFromStage).toBe(true);
      expect(result.right.resumeFrom).toBe("build");
    }
  });

  test("recovers baseSha from worktree-created event when state is missing base_sha", () => {
    const wsId = "01TESTWS14";
    const baseSha = "def456abc123";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review", "build"],
      spec_path: "/spec.md",
      agents: ["planner", "reviewer", "upgrader", "builder"],
    });
    mkdirSync(join(AGENTS_DIR, wsId, "orchestrator"), { recursive: true });
    writeFileSync(join(AGENTS_DIR, wsId, "orchestrator", "events.jsonl"), JSON.stringify({
      event: "worktree-created",
      from_sha: baseSha,
      path: "/repo.01TESTWS14",
      branch: `adw/${wsId}`,
    }) + "\n");

    const result = loadWorkspace(wsId, undefined, AGENTS_DIR);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right.baseSha).toBe(baseSha);
  });
});

// ---------------------------------------------------------------------------
// BUG-20: worktree duplication on resume — validation, reuse, recreate, refuse.
// These tests seed state with worktree_path/branch/base_sha and assert the
// resume path validates the recorded worktree instead of trusting existsSync.
// ---------------------------------------------------------------------------

const RECORDED_WT = "/repo.01BUG020";
const RECORDED_BRANCH = "adw/01BUG020";
const RECORDED_BASE = "abc1234";

/** Seed a workspace that has completed plan+review+build and recorded a worktree. */
function seedResumeWorkspace(id: string, extra: Record<string, unknown> = {}): void {
  seedWorkspaceState(id, {
    adw_id: id,
    description: "BUG-20 resume scenario",
    status: "running",
    completed_stages: ["plan", "review", "build"],
    spec_path: join(AGENTS_DIR, "SPEC-bug20.md"),
    agents: ["planner", "reviewer", "upgrader", "builder"],
    worktree_path: RECORDED_WT,
    branch: RECORDED_BRANCH,
    base_sha: RECORDED_BASE,
    ...extra,
  });
}

describe("BUG-20 — resume reuses a valid recorded worktree", () => {
  test("valid worktree: createWorktreeFromBase NOT called, worktree-reused emitted", async () => {
    const wsId = "01BUG020A";
    seedResumeWorkspace(wsId);
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const wtDeps = mockWorktreeDepsConfigurable({
      validate: { ok: true, path: RECORDED_WT, branch: RECORDED_BRANCH },
    });
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, wtDeps);

    expect(Either.isRight(result)).toBe(true);
    // Recreation must NOT happen when the worktree is valid.
    expect(wtDeps.recreateCalls).toHaveLength(0);
    // plan/review/build skipped (already completed); only patch-review runs.
    expect(deps.patchCalls).toHaveLength(1);

    // worktree-reused event recorded with the recorded path + branch.
    const events = readFileSync(join(AGENTS_DIR, wsId, "orchestrator", "events.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim());
    const reused = events.map((l) => JSON.parse(l)).find((e) => e.event === "worktree-reused");
    expect(reused).toBeDefined();
    expect(reused.path).toBe(RECORDED_WT);
    expect(reused.branch).toBe(RECORDED_BRANCH);
  });

  test("ResumeContext carries the recorded worktree_path + branch into runPipeline", () => {
    const wsId = "01BUG020B";
    seedResumeWorkspace(wsId);
    const loaded = loadWorkspace(wsId, undefined, AGENTS_DIR);
    expect(Either.isRight(loaded)).toBe(true);
    if (Either.isRight(loaded)) {
      expect(loaded.right.worktreePath).toBe(RECORDED_WT);
      expect(loaded.right.branch).toBe(RECORDED_BRANCH);
      expect(loaded.right.baseSha).toBe(RECORDED_BASE);
    }
  });
});

describe("BUG-20 — resume recreates a missing recorded worktree from base_sha", () => {
  test("validation reports missing: recreate uses recorded base_sha + branch", async () => {
    const wsId = "01BUG020C";
    seedResumeWorkspace(wsId);
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const wtDeps = mockWorktreeDepsConfigurable({
      validate: { ok: false, reason: "missing" },
      recreate: Either.right(RECORDED_WT),
    });
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, wtDeps);

    expect(Either.isRight(result)).toBe(true);
    // Recreation happened exactly once, with the recorded base_sha (NOT HEAD).
    expect(wtDeps.recreateCalls).toHaveLength(1);
    expect(wtDeps.recreateCalls[0]!.baseSha).toBe(RECORDED_BASE);
    expect(wtDeps.recreateCalls[0]!.branch).toBe(RECORDED_BRANCH);

    // Event is worktree-created (NOT worktree-recreated) per spec contract.
    const events = readFileSync(join(AGENTS_DIR, wsId, "orchestrator", "events.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim());
    const created = events.map((l) => JSON.parse(l)).find((e) => e.event === "worktree-created");
    expect(created).toBeDefined();
    expect(created.from_sha).toBe(RECORDED_BASE);
    // No worktree-reused event should fire on the recreate path.
    expect(events.map((l) => JSON.parse(l)).some((e) => e.event === "worktree-reused")).toBe(false);
  });

  test("missing worktree + no recorded base_sha: captures HEAD and recreates (BUG-20 fix)", async () => {
    const wsId = "01BUG020D";
    // Seed WITHOUT base_sha — the BUG-20 fix captures HEAD on resume rather
    // than failing, since plan+review are already complete.
    seedResumeWorkspace(wsId, { base_sha: undefined });
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const wtDeps = mockWorktreeDepsConfigurable({
      validate: { ok: false, reason: "missing" },
    });
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, wtDeps);

    // BUG-20 fix: recreation proceeds using the freshly-captured HEAD SHA.
    expect(Either.isRight(result)).toBe(true);
    expect(wtDeps.recreateCalls).toHaveLength(1);
    expect(wtDeps.recreateCalls[0]!.baseSha).toBe("deadbeef"); // mock gitRun returns this.
    // A base-sha-recorded event with reason resume-fresh-capture was emitted.
    const events = readFileSync(join(AGENTS_DIR, wsId, "orchestrator", "events.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim());
    const captured = events.map((l) => JSON.parse(l)).find((e) => e.event === "base-sha-recorded");
    expect(captured).toBeDefined();
    expect(captured.reason).toBe("resume-fresh-capture");
  });
});

describe("BUG-20 — resume refuses an invalid recorded worktree", () => {
  test("wrong branch: fails loudly, does not reuse or overwrite", async () => {
    const wsId = "01BUG020E";
    seedResumeWorkspace(wsId);
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const wtDeps = mockWorktreeDepsConfigurable({
      validate: { ok: false, reason: "wrong-branch", path: RECORDED_WT, branch: "adw/someone-else", expected: RECORDED_BRANCH },
    });
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, wtDeps);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      // The error names the wrong branch and the expected one (refuse loudly).
      expect(result.left).toContain("adw/someone-else");
      expect(result.left).toContain(RECORDED_BRANCH);
    }
    // No recreation, no patch-review — refused before either runs.
    expect(wtDeps.recreateCalls).toHaveLength(0);
    expect(deps.patchCalls).toHaveLength(0);
  });

  test("arbitrary dir (not-a-worktree): fails, does not silently reuse", async () => {
    const wsId = "01BUG020F";
    seedResumeWorkspace(wsId);
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const wtDeps = mockWorktreeDepsConfigurable({
      validate: { ok: false, reason: "not-a-worktree", path: RECORDED_WT },
    });
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR, wtDeps);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("not a git worktree");
    }
    expect(wtDeps.recreateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CHORE-40: orchestrator goal-exhausted reaction
// ---------------------------------------------------------------------------

describe("CHORE-40 — orchestrator goal-exhausted reaction", () => {
  /** Seed a spec file at mockSpecPath with the given goal frontmatter. */
  function seedGoalSpec(goal: string | undefined): void {
    const content = goal === undefined
      ? "# Spec\n\nNo goal."
      : `---\ngoal: "${goal}"\n---\n\n# Spec`;
    writeFileSync(mockSpecPath(), content);
  }

  /** A build outcome that reports goal-exhausted. */
  function mockBuildGoalExhausted(): BuildOutcome {
    return { id: "BUILDTEST1", specPath: mockSpecPath(), goalStatus: "goal-exhausted", goalCondition: "the goal", goalTurns: 50 };
  }

  test("orchestrator reads goalStatus from build outcome (no sidecar needed with injected deps)", async () => {
    seedGoalSpec("tests pass");
    const deps = mockDeps({
      build: Either.right(mockBuildGoalExhausted()),
      patch: Either.right(mockPatchGaps()),
    });
    // Limit retries so the loop terminates after one gaps iteration.
    const result = await runPipeline(deps, { description: "", specPath: mockSpecPath() }, AGENTS_DIR, mockWorktreeDeps);
    // The pipeline completes (goal-exhausted is recorded but not fatal on its own;
    // patch-review drives the verdict). The first build carried the goal.
    expect(deps.buildCalls.length).toBeGreaterThanOrEqual(1);
    expect(deps.buildCalls[0]!.goalCondition).toBe("tests pass");
  });

  test("orchestrator narrows goal scope after goal-exhausted on retry", async () => {
    seedGoalSpec("tests pass");
    // Initial build: goal-met (clean). Then patch-review gaps → retry build
    // returns goal-exhausted → next retry should narrow.
    // Custom patch mock mutates the spec file between iterations so the
    // feedback-stalled check (spec fingerprint unchanged) doesn't block retries.
    let patchCallCount = 0;
    const deps = mockDeps({
      build: [
        Either.right(mockBuild()), // initial build: goal-met
        Either.right(mockBuildGoalExhausted()), // retry 1: exhausted
        Either.right(mockBuild()), // retry 2: should be narrowed goal
      ],
      test: Either.right(mockTestPass()),
    });
    deps.runPatchReview = async (input) => {
      patchCallCount++;
      // Touch the spec so its mtime/size changes — avoids feedback-stalled.
      writeFileSync(input, readFileSync(input, "utf8") + `\n<!-- patch ${patchCallCount} -->\n`);
      return Either.right(mockPatchGaps());
    };
    await runPipeline(deps, baseArgs({ specPath: mockSpecPath() }), AGENTS_DIR, mockWorktreeDeps);
    expect(deps.buildCalls.length).toBeGreaterThanOrEqual(3);
    // Retry 2's goal should start with the narrowing prefix (set after retry 1's exhausted).
    const retryGoal = deps.buildCalls[2]!.goalCondition;
    expect(retryGoal).toBeDefined();
    expect(retryGoal!.startsWith("Continue from the current repository state")).toBe(true);
  });

  test("orchestrator falls back to plain /implement after two consecutive goal-exhausted on retries", async () => {
    seedGoalSpec("tests pass");
    let patchCallCount = 0;
    const deps = mockDeps({
      build: [
        Either.right(mockBuild()), // initial build: clean
        Either.right(mockBuildGoalExhausted()), // retry 1: exhausted (count=1)
        Either.right(mockBuildGoalExhausted()), // retry 2: exhausted (count=2)
        Either.right(mockBuild()), // retry 3: should be plain /implement (no goal)
      ],
      test: Either.right(mockTestPass()),
    });
    deps.runPatchReview = async (input) => {
      patchCallCount++;
      writeFileSync(input, readFileSync(input, "utf8") + `\n<!-- patch ${patchCallCount} -->\n`);
      return Either.right(mockPatchGaps());
    };
    await runPipeline(deps, baseArgs({ specPath: mockSpecPath(), maxRetries: 4 }), AGENTS_DIR, mockWorktreeDeps);
    // After two consecutive exhausted with no progress, the third retry gets no goal.
    expect(deps.buildCalls.length).toBeGreaterThanOrEqual(4);
    expect(deps.buildCalls[3]!.goalCondition).toBeUndefined();
  });

  test("goal-frontmatter-error fails the pipeline on malformed frontmatter", async () => {
    // Malformed: unquoted ': ' in goal value.
    writeFileSync(mockSpecPath(), "---\ngoal: run: thing\n---\n\n# Spec");
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    const result = await runPipeline(deps, { description: "", specPath: mockSpecPath() }, AGENTS_DIR, mockWorktreeDeps);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("goal frontmatter error");
  });

  test("no goal in spec → build dispatched without goalCondition", async () => {
    seedGoalSpec(undefined);
    const deps = mockDeps({ patch: Either.right(mockPatchPass()) });
    await runPipeline(deps, { description: "", specPath: mockSpecPath() }, AGENTS_DIR, mockWorktreeDeps);
    expect(deps.buildCalls[0]!.goalCondition).toBeUndefined();
  });
});
