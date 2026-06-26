/**
 * @file adw-plan-resume-by-spec.test.ts
 * @description Deterministic unit tests for the spec-path discovery change in
 * adws/adw-plan-review-build-patch.ts. Covers the AC #9–#11 contract:
 *
 *   - /adw-implement docs/specs/SPEC-###.md reuses a "planned" workspace at build
 *   - /adw-implement docs/specs/SPEC-###.md with a "completed" workspace → fresh mint
 *   - --id takes precedence over discovery
 *   - --from-stage with spec-path discovery is accepted and applied
 *   - Multiple workspaces for one spec → newest wins
 *   - Free-text description → no discovery
 *
 * All five stages are mocked via PipelineDeps — the tests seed real
 * `agents/<id>/adw-state.json` files under a per-test temp AGENTS_DIR (the
 * orchestrator's `agentsDir` injection seam, BUG-17 / ADR-0105).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  parseArgs,
  runPipeline,
  type PipelineDeps,
  type OrchestratorArgs,
  type PlanResult,
  type SpecReviewResult,
  type BuildOutcome,
  type PatchReviewResult,
  type TestOutcome,
  type OrchestratorWorktreeDeps,
} from "../../adws/adw-plan-review-build-patch.ts";

let AGENTS_DIR = "";
const REAL_AGENTS_DIR = join(process.cwd(), "agents");
let realAgentsSnapshot: string[] = [];

beforeEach(() => {
  AGENTS_DIR = mkdtempSync(join(tmpdir(), "adw-plan-resume-by-spec-"));
  realAgentsSnapshot = existsSync(REAL_AGENTS_DIR) ? readdirSync(REAL_AGENTS_DIR) : [];
});

afterEach(() => {
  rmSync(AGENTS_DIR, { recursive: true, force: true });
  // BUG-17 regression guard: real agents/ must be unchanged after every test.
  const after = existsSync(REAL_AGENTS_DIR) ? readdirSync(REAL_AGENTS_DIR) : [];
  expect(new Set(after)).toEqual(new Set(realAgentsSnapshot));
});

// ---------------------------------------------------------------------------
// Mock factories — same shape as adw-pipeline-loop.test.ts, kept minimal here.
// ---------------------------------------------------------------------------

const mockPlan = (specPath: string | null): PlanResult => ({ id: "PLANTEST01", specPath });
const mockReview = (kind: "pass" | "upgraded" | "unchanged"): SpecReviewResult => ({
  id: "REVIEWTEST",
  specPath: "/abs/spec.md",
  kind,
});
const mockBuild = (): BuildOutcome => ({ id: "BUILDTEST1", specPath: "/abs/spec.md" });
const mockTestPass = (): TestOutcome => ({ id: "TESTTEST1", verdict: "pass", specPath: "/abs/spec.md" });
const mockPatchPass = (): PatchReviewResult => ({ id: "PATCHTEST1", verdict: "pass", specPath: "/abs/spec.md" });

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
  validateWorktree: () => TaskEither.from(async () => Either.right({ ok: true, path: "/mock/worktree", branch: "adw/test" })),
  removeWorktree: () => TaskEither.from(async () => Either.right(undefined)),
  detectWorktree: () => TaskEither.from(async () => Either.right(false)),
  // OrchestratorWorktreeDeps extends WorktreeDeps. gitRun returns a plausible
  // SHA so the fresh-setup base_sha capture records a value.
  gitRun: () => TaskEither.from(async () => Either.right("deadbeef")),
  mergeBranchToMain: () => TaskEither.from(async () => Either.right({ sha: "deadbeef" })),
};

function mockDeps(): PipelineDeps & {
  planCalls: Array<{ description: string; forcedType?: string; id: string }>;
  reviewCalls: Array<{ input: string; id: string }>;
  buildCalls: Array<{ input: string; modelOverride?: string; id: string }>;
  testCalls: Array<{ input: string; modelOverride?: string; id: string }>;
  patchCalls: Array<{ input: string; modelOverride?: string; id: string }>;
} {
  const planCalls: Array<{ description: string; forcedType?: string; id: string }> = [];
  const reviewCalls: Array<{ input: string; id: string }> = [];
  const buildCalls: Array<{ input: string; modelOverride?: string; id: string }> = [];
  const testCalls: Array<{ input: string; modelOverride?: string; id: string }> = [];
  const patchCalls: Array<{ input: string; modelOverride?: string; id: string }> = [];
  return {
    planCalls,
    reviewCalls,
    buildCalls,
    testCalls,
    patchCalls,
    runPlan: async (description, forcedType, id) => {
      planCalls.push({ description, forcedType, id });
      return Either.right(mockPlan("/abs/spec.md"));
    },
    runSpecReview: async (input, id) => {
      reviewCalls.push({ input, id });
      return Either.right(mockReview("pass"));
    },
    runBuild: async (input, modelOverride, id) => {
      buildCalls.push({ input, modelOverride, id });
      return Either.right(mockBuild());
    },
    runTest: async (input, modelOverride, id) => {
      testCalls.push({ input, modelOverride, id });
      return Either.right(mockTestPass());
    },
    runPatchReview: async (input, modelOverride, id) => {
      patchCalls.push({ input, modelOverride, id });
      return Either.right(mockPatchPass());
    },
  };
}

/** Seed a workspace state file at agents/{id}/adw-state.json. */
function seedWorkspaceState(id: string, state: Record<string, unknown>): void {
  const dir = join(AGENTS_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "adw-state.json"), JSON.stringify(state, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// parseArgs — --from-stage now accepts --id OR spec path; rejects free text
// ---------------------------------------------------------------------------

describe("parseArgs — --from-stage + spec-path discovery", () => {
  test("--from-stage + spec-path is accepted (discovery will resolve workspace)", () => {
    const r = parseArgs(["--from-stage", "review", "docs/specs/SPEC-064.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.fromStage).toBe("review");
      expect(r.right.specPath).toBe("docs/specs/SPEC-064.md");
    }
  });

  test("--from-stage + free-text description remains rejected", () => {
    const r = parseArgs(["--from-stage", "review", "a free-text description"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--from-stage requires --id or a spec path");
  });

  test("--from-stage + --id remains accepted", () => {
    const r = parseArgs(["--from-stage", "build", "--id", "01TESTWS01"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.fromStage).toBe("build");
  });
});

// ---------------------------------------------------------------------------
// runPipeline — spec-path discovery
// ---------------------------------------------------------------------------

describe("runPipeline — spec-path discovery reuses a 'planned' workspace at build", () => {
  test("spec-path input reuses the 'planned' workspace — plan/review skipped, build runs", async () => {
    const wsId = "01TESTWS01";
    const SPEC = "docs/specs/SPEC-999.md";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original /adw-plan description",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
      agents: ["planner", "reviewer", "upgrader"],
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", specPath: SPEC }, AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    // plan + review NOT called (skipped via resume); build IS called.
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toHaveLength(0);
    expect(deps.buildCalls).toHaveLength(1);
    expect(deps.buildCalls[0]!.id).toBe(wsId); // reused, not fresh mint
    expect(deps.patchCalls).toHaveLength(1);

    // Final state id is the seeded id (no fresh mint).
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(wsId);
    }
  });

  test("stderr records the reuse event in orchestrator/events.jsonl", async () => {
    const wsId = "01TESTWS02";
    const SPEC = "docs/specs/SPEC-998.md";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", specPath: SPEC }, AGENTS_DIR, mockWorktreeDeps);
    if (Either.isLeft(result)) throw new Error("expected success");

    // The resume event in events.jsonl records the workspace id reused.
    const eventsFile = join(AGENTS_DIR, wsId, "orchestrator", "events.jsonl");
    const events = readFileSync(eventsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const resumeEvent = events.find((e) => e.event === "resume");
    expect(resumeEvent).toBeDefined();
    expect(resumeEvent.from_stage).toBe("build");
  });
});

describe("runPipeline — spec-path discovery with non-resumable or absent workspaces", () => {
  test("spec-path input with a 'completed' workspace → fresh mint, spec-review re-runs (no regression)", async () => {
    const wsId = "01TESTWS03";
    const SPEC = "docs/specs/SPEC-997.md";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "done",
      status: "completed",
      completed_stages: ["plan", "review", "build", "test", "patch-review"],
      spec_path: SPEC,
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", specPath: SPEC }, AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    // Fresh id minted — NOT the seeded id.
    if (Either.isRight(result)) {
      expect(result.right.id).not.toBe(wsId);
    }
    // spec-review IS called (the "rebuild a finished spec" behavior preserved).
    expect(deps.reviewCalls).toHaveLength(1);
    expect(deps.buildCalls).toHaveLength(1);
    expect(deps.planCalls).toHaveLength(0); // plan still skipped (spec path given)
  });

  test("spec-path input with no prior workspace → fresh mint", async () => {
    const SPEC = "docs/specs/SPEC-996.md";
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", specPath: SPEC }, AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls).toHaveLength(0); // plan still skipped (spec path given)
    expect(deps.reviewCalls).toHaveLength(1);
    expect(deps.buildCalls).toHaveLength(1);
  });

  test("spec-path input with a 'failed' workspace → resume (failed is resumable)", async () => {
    const wsId = "01TESTWS04";
    const SPEC = "docs/specs/SPEC-995.md";
    // Failed mid-build — resume from build.
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "in-progress",
      status: "failed",
      failed_stage: "build",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", specPath: SPEC }, AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(wsId); // reused
    }
    expect(deps.buildCalls).toHaveLength(1);
    expect(deps.buildCalls[0]!.id).toBe(wsId);
  });
});

describe("runPipeline — discovery precedence", () => {
  test("--id takes precedence over discovery", async () => {
    const discoveredId = "01TESTWS05";
    const explicitId = "01TESTWS06";
    const SPEC = "docs/specs/SPEC-994.md";
    // Discovered workspace exists for the spec...
    seedWorkspaceState(discoveredId, {
      adw_id: discoveredId,
      description: "discovered",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
    });
    // ...but the user passes a different --id (also resumable).
    seedWorkspaceState(explicitId, {
      adw_id: explicitId,
      description: "explicit",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: "docs/specs/SPEC-OTHER.md",
    });
    const deps = mockDeps();
    const result = await runPipeline(
      deps,
      { description: "", id: explicitId, specPath: SPEC },
      AGENTS_DIR,
      mockWorktreeDeps,
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(explicitId); // --id wins
      expect(result.right.id).not.toBe(discoveredId);
    }
    expect(deps.buildCalls[0]!.id).toBe(explicitId);
  });

  test("newest of multiple workspaces for one spec wins", async () => {
    const olderId = "01TESTWS07"; // lower ULID = older
    const newerId = "01TESTWS08"; // higher ULID = newer
    const SPEC = "docs/specs/SPEC-993.md";
    seedWorkspaceState(olderId, {
      adw_id: olderId,
      description: "older run",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
    });
    seedWorkspaceState(newerId, {
      adw_id: newerId,
      description: "newer run",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", specPath: SPEC }, AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(newerId); // newest wins
      expect(result.right.id).not.toBe(olderId);
    }
  });

  test("free-text description → no discovery, fresh mint", async () => {
    // Seed a planned workspace for an unrelated spec — must NOT be picked up.
    const wsId = "01TESTWS09";
    const SPEC = "docs/specs/SPEC-992.md";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "unrelated",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "a fresh description" }, AGENTS_DIR, mockWorktreeDeps);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).not.toBe(wsId); // fresh mint, discovery not consulted
    }
    // Plan IS called (free-text input, no spec path).
    expect(deps.planCalls).toHaveLength(1);
    expect(deps.reviewCalls).toHaveLength(1);
    expect(deps.buildCalls).toHaveLength(1);
  });
});

describe("runPipeline — --from-stage + spec-path discovery", () => {
  test("--from-stage review with spec-path forces re-running review on discovered workspace", async () => {
    const wsId = "01TESTWS10";
    const SPEC = "docs/specs/SPEC-991.md";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "planned workspace",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
    });
    const deps = mockDeps();
    const result = await runPipeline(
      deps,
      { description: "", specPath: SPEC, fromStage: "review" },
      AGENTS_DIR,
      mockWorktreeDeps,
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(wsId); // discovered + reused
    }
    // --from-stage review forces review to re-run despite already being complete.
    expect(deps.reviewCalls).toHaveLength(1);
    expect(deps.buildCalls).toHaveLength(1);
  });
});
