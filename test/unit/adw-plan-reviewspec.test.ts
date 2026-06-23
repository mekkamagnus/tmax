/**
 * @file adw-plan-reviewspec.test.ts
 * @description Deterministic unit tests for adws/adw-plan-reviewspec.ts
 * (the 2-stage planning-only orchestrator: plan → review, terminal "planned").
 *
 * No live `claude`, no live `codex`, no real `agents/` mutation. All state I/O
 * is redirected to a per-test temp dir via the orchestrator's `agentsDir`
 * injection seam (BUG-17 / ADR-0105).
 *
 * Both stages are mocked via PipelineDeps — the tests assert the orchestrator's
 * stage-chaining, abort, continue, terminal-status, and resume behavior, plus
 * the id-based cross-orchestrator handoff (a "planned" workspace here must be
 * accepted by the full orchestrator's loadWorkspace and resume at "build").
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either } from "../../src/utils/task-either.ts";
import {
  parseArgs,
  runPipeline,
  loadWorkspace,
  type PipelineDeps,
  type OrchestratorArgs,
  type PlanResult,
  type SpecReviewResult,
} from "../../adws/adw-plan-reviewspec.ts";
import { loadWorkspace as loadWorkspaceFull } from "../../adws/adw-plan-review-build-patch.ts";

// Per-test temp dir — runPipeline writes all state here via the agentsDir seam.
// The real repo agents/ dir is snapshotted in beforeEach/afterEach to assert
// no test pollution (BUG-17 regression guard).
let AGENTS_DIR = "";
const REAL_AGENTS_DIR = join(process.cwd(), "agents");
let realAgentsSnapshot: string[] = [];

beforeEach(() => {
  AGENTS_DIR = mkdtempSync(join(tmpdir(), "adw-plan-reviewspec-test-"));
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

const mockReview = (kind: "pass" | "upgraded" | "unchanged"): SpecReviewResult => ({
  id: "REVIEWTEST",
  specPath: "/abs/spec.md",
  kind,
});

/**
 * Build mock deps whose stages return canned values. Each stage also records
 * the args it was called with so tests can assert forwarding (e.g. id).
 */
function mockDeps(opts: {
  plan?: Either<string, PlanResult>;
  review?: Either<string, SpecReviewResult>;
} = {}): PipelineDeps & {
  planCalls: Array<{ description: string; forcedType?: string; id: string }>;
  reviewCalls: Array<{ input: string; id: string }>;
} {
  const planCalls: Array<{ description: string; forcedType?: string; id: string }> = [];
  const reviewCalls: Array<{ input: string; id: string }> = [];
  return {
    planCalls,
    reviewCalls,
    runPlan: async (description, forcedType, id) => {
      planCalls.push({ description, forcedType, id });
      return opts.plan ?? Either.right(mockPlan("/abs/spec.md"));
    },
    runSpecReview: async (input, id) => {
      reviewCalls.push({ input, id });
      return opts.review ?? Either.right(mockReview("pass"));
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
      expect(r.right.forcedType).toBeUndefined();
    }
  });

  test("accepts --feature before the description", () => {
    const r = parseArgs(["--feature", "add a feature"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.forcedType).toBe("feature");
  });

  test("rejects --model as unsupported (no build stage)", () => {
    const r = parseArgs(["--model", "glm-4.7", "add a feature"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) {
      expect(r.left).toContain("--model is not supported");
      // Not consumed as description either — the user must resubmit without --model.
    }
  });

  test("rejects --model even with a value missing", () => {
    const r = parseArgs(["--model"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--model is not supported");
  });

  test("rejects unknown leading-dash flags instead of treating them as descriptions", () => {
    const r = parseArgs(["--bogus-flag", "add a feature"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("Unsupported option: --bogus-flag");
  });

  test("rejects multiple type flags", () => {
    const r = parseArgs(["--feature", "--bug", "desc"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("at most one");
  });

  test("no description → usage", () => {
    const r = parseArgs([]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left.startsWith("__usage__:")).toBe(true);
  });

  test("--help → help sentinel", () => {
    const r = parseArgs(["--help"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left.startsWith("__help__:")).toBe(true);
  });

  test("extra positional arg → Left", () => {
    const r = parseArgs(["desc1", "desc2"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("Unexpected extra argument");
  });
});

// ---------------------------------------------------------------------------
// parseArgs — spec-path input (skip plan)
// ---------------------------------------------------------------------------

describe("parseArgs — spec-path input", () => {
  test("detects a SPEC path and sets specPath (not description)", () => {
    const r = parseArgs(["docs/specs/SPEC-064-adw-plan-skill.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.specPath).toBe("docs/specs/SPEC-064-adw-plan-skill.md");
      expect(r.right.description).toBe("");
    }
  });

  test("detects a BUG path", () => {
    const r = parseArgs(["docs/specs/BUG-005-crash.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.specPath).toBe("docs/specs/BUG-005-crash.md");
  });

  test("detects a CHORE path", () => {
    const r = parseArgs(["docs/specs/CHORE-30-adw-build.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.specPath).toBe("docs/specs/CHORE-30-adw-build.md");
  });

  test("a description is treated as description, not specPath", () => {
    const r = parseArgs(["add a URL bar to the status line"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.description).toBe("add a URL bar to the status line");
      expect(r.right.specPath).toBeUndefined();
    }
  });

  test("--feature + spec-path → error (forcedType needs plan, but spec skips plan)", () => {
    const r = parseArgs(["--feature", "docs/specs/SPEC-064.md"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--feature/--bug/--chore require a description");
  });

  test("spec-path + --id is accepted (resume with explicit spec)", () => {
    const r = parseArgs(["--id", "01TESTWS01", "docs/specs/SPEC-064.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.specPath).toBe("docs/specs/SPEC-064.md");
      expect(r.right.id).toBe("01TESTWS01");
    }
  });
});

// ---------------------------------------------------------------------------
// parseArgs — resume flag validation
// ---------------------------------------------------------------------------

describe("parseArgs — resume flags", () => {
  test("--id <valid-id> without description is accepted (resume)", () => {
    const r = parseArgs(["--id", "01TESTWS01"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.id).toBe("01TESTWS01");
      expect(r.right.description).toBe("");
    }
  });

  test("--id rejects malformed ids", () => {
    expect(Either.isLeft(parseArgs(["--id", "BAD"]))).toBe(true);
    expect(Either.isLeft(parseArgs(["--id", "01TESTID01"]))).toBe(true); // I,L not in Crockford
  });

  test("--from-stage requires --id", () => {
    const r = parseArgs(["--from-stage", "review", "desc"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--from-stage requires --id");
  });

  test("--from-stage validates the stage value (plan|review only)", () => {
    const r = parseArgs(["--id", "01TESTWS01", "--from-stage", "build"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--from-stage must be one of: plan, review");
  });

  test("--from-stage review + --id is accepted", () => {
    const r = parseArgs(["--id", "01TESTWS01", "--from-stage", "review"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.fromStage).toBe("review");
  });

  test("--from-stage plan + --id is accepted", () => {
    const r = parseArgs(["--id", "01TESTWS01", "--from-stage", "plan"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.fromStage).toBe("plan");
  });
});

// ---------------------------------------------------------------------------
// runPipeline — spec-path input (skip plan)
// ---------------------------------------------------------------------------

describe("runPipeline — spec-path input", () => {
  test("skips plan and goes straight to review", async () => {
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", specPath: "/abs/SPEC-064.md" }, AGENTS_DIR);

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toEqual([{ input: "/abs/SPEC-064.md", id: expect.any(String) }]);
  });

  test("records plan as completed (skipped) plus review in the final state", async () => {
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", specPath: "/abs/SPEC-064.md" }, AGENTS_DIR);
    if (Either.isLeft(result)) throw new Error("expected success");

    const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
    expect(state.completed_stages).toEqual(["plan", "review"]);
    expect(state.spec_path).toBe("/abs/SPEC-064.md");
    expect(state.status).toBe("planned");
  });
});

// ---------------------------------------------------------------------------
// runPipeline — fresh success path
// ---------------------------------------------------------------------------

describe("runPipeline — success", () => {
  test("runs plan then review in order, finalizes as planned", async () => {
    const deps = mockDeps();
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.specPath).toBe("/abs/spec.md");
      expect(result.right.stages.plan?.id).toBe("PLANTEST01");
      expect(result.right.stages.review?.id).toBe("REVIEWTEST");
    }
    expect(deps.planCalls).toHaveLength(1);
    expect(deps.planCalls[0]!.description).toBe("add a feature");
    expect(deps.reviewCalls).toEqual([{ input: "/abs/spec.md", id: deps.planCalls[0]!.id }]);
    const sharedId = deps.planCalls[0]!.id;
    expect(deps.reviewCalls[0]!.id).toBe(sharedId);
  });

  test("forwards forcedType to plan", async () => {
    const deps = mockDeps();
    const result = await runPipeline(deps, baseArgs({ forcedType: "chore" }), AGENTS_DIR);

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls[0]!.forcedType).toBe("chore");
  });

  test("writes planned workspace state with the agents that ran", async () => {
    const deps = mockDeps();
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);
    if (Either.isLeft(result)) throw new Error("expected success");

    const statePath = join(AGENTS_DIR, result.right.id, "adw-state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.status).toBe("planned");
    expect(state.completed_stages).toEqual(["plan", "review"]);
    expect(state.agents).toEqual(["planner", "reviewer", "upgrader"]);
  });
});

// ---------------------------------------------------------------------------
// runPipeline — plan stage behaviors
// ---------------------------------------------------------------------------

describe("runPipeline — plan stage", () => {
  test("aborts when plan produces no spec (noop), before calling review", async () => {
    const deps = mockDeps({ plan: Either.right(mockPlan(null)) });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("produced no spec");
    expect(deps.reviewCalls).toHaveLength(0);
  });

  test("aborts and records failed_stage when plan returns Left", async () => {
    const deps = mockDeps({ plan: Either.left("claude not found") });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("plan stage failed");
    expect(deps.reviewCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runPipeline — review stage behaviors (all kinds succeed; gaps don't block)
// ---------------------------------------------------------------------------

describe("runPipeline — review stage (all kinds succeed)", () => {
  test("finalizes as planned when review returns 'pass'", async () => {
    const deps = mockDeps({ review: Either.right(mockReview("pass")) });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
      expect(state.status).toBe("planned");
      expect(state.completed_stages).toEqual(["plan", "review"]);
    }
  });

  test("finalizes as planned when review returns 'upgraded'", async () => {
    const deps = mockDeps({ review: Either.right(mockReview("upgraded")) });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
      expect(state.status).toBe("planned");
    }
  });

  test("finalizes as planned when review returns 'unchanged'", async () => {
    const deps = mockDeps({ review: Either.right(mockReview("unchanged")) });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, result.right.id, "adw-state.json"), "utf8"));
      expect(state.status).toBe("planned");
    }
  });

  test("records the review kind in the stage-complete event", async () => {
    const deps = mockDeps({ review: Either.right(mockReview("upgraded")) });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);
    if (Either.isLeft(result)) throw new Error("expected success");

    const eventsFile = join(AGENTS_DIR, result.right.id, "orchestrator", "events.jsonl");
    const events = readFileSync(eventsFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const reviewEvent = events.find((e) => e.event === "stage-complete" && e.stage === "review");
    expect(reviewEvent).toBeDefined();
    expect(reviewEvent.kind).toBe("upgraded");
  });

  test("aborts when review returns Left (hard failure)", async () => {
    const deps = mockDeps({ review: Either.left("codex crashed") });
    const result = await runPipeline(deps, baseArgs(), AGENTS_DIR);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("spec-review stage failed");
  });
});

// ---------------------------------------------------------------------------
// Resume — loadWorkspace
// ---------------------------------------------------------------------------

/** Seed a workspace state file at agents/{id}/adw-state.json for resume tests. */
function seedWorkspaceState(
  id: string,
  state: Record<string, unknown>,
  orchestratorEvents?: string[],
): void {
  const dir = join(AGENTS_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "adw-state.json"), JSON.stringify(state, null, 2) + "\n");
  if (orchestratorEvents && orchestratorEvents.length > 0) {
    const orchDir = join(dir, "orchestrator");
    mkdirSync(orchDir, { recursive: true });
    const lines = orchestratorEvents.map((e) => {
      const obj = JSON.parse(e) as Record<string, unknown>;
      if (!obj.ts) obj.ts = new Date().toISOString();
      return JSON.stringify(obj);
    });
    writeFileSync(join(orchDir, "events.jsonl"), lines.join("\n") + "\n");
  }
}

describe("loadWorkspace — terminal / inconsistent resume states", () => {
  test("refuses to resume a 'planned' workspace (both stages done)", () => {
    const wsId = "01TESTWS01";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: "/abs/spec.md",
      agents: ["planner", "reviewer", "upgrader"],
    });
    const r = loadWorkspace(wsId, undefined, AGENTS_DIR);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("already planned");
  });

  test("refuses to resume a 'completed' workspace", () => {
    const wsId = "01TESTWS02";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "done",
      status: "completed",
      completed_stages: ["plan", "review"],
      spec_path: "/abs/spec.md",
    });
    const r = loadWorkspace(wsId, undefined, AGENTS_DIR);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("already completed");
  });

  test("refuses a 'running' workspace with both plan+review complete (no valid post-review stage)", () => {
    const wsId = "01TESTWS03";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review"],
      spec_path: "/abs/spec.md",
      agents: ["planner", "reviewer", "upgrader"],
    });
    const r = loadWorkspace(wsId, undefined, AGENTS_DIR);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("nothing to resume");
  });

  test("--from-stage review on a fully-complete 'running' workspace is allowed (override)", () => {
    const wsId = "01TESTWS04";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review"],
      spec_path: "/abs/spec.md",
      agents: ["planner", "reviewer", "upgrader"],
    });
    const r = loadWorkspace(wsId, "review", AGENTS_DIR);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.resumeFrom).toBe("review");
  });
});

describe("runPipeline — resume (auto-detect)", () => {
  const SPEC = "/abs/path/to/SPEC-999.md";

  test("resumes at review when plan completed (skips plan, runs review)", async () => {
    const wsId = "01TESTWS05";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan"],
      spec_path: SPEC,
      agents: ["planner"],
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", id: wsId }, AGENTS_DIR);

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toEqual([{ input: SPEC, id: wsId }]);

    if (Either.isRight(result)) {
      const state = JSON.parse(readFileSync(join(AGENTS_DIR, wsId, "adw-state.json"), "utf8"));
      expect(state.status).toBe("planned");
      expect(state.completed_stages).toEqual(["plan", "review"]);
    }
  });

  test("resumes via --from-stage review forces re-running review", async () => {
    const wsId = "01TESTWS06";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "original desc",
      status: "running",
      completed_stages: ["plan", "review"],
      spec_path: SPEC,
      agents: ["planner", "reviewer", "upgrader"],
    });
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", id: wsId, fromStage: "review" }, AGENTS_DIR);

    expect(Either.isRight(result)).toBe(true);
    expect(deps.planCalls).toHaveLength(0);
    expect(deps.reviewCalls).toHaveLength(1);
  });
});

describe("runPipeline — resume validation errors", () => {
  test("--id for a nonexistent workspace → Left", async () => {
    const deps = mockDeps();
    const result = await runPipeline(deps, { description: "", id: "01TESTWS99" }, AGENTS_DIR);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("nothing to resume");
  });
});

// ---------------------------------------------------------------------------
// Cross-orchestrator handoff — the crux
// ---------------------------------------------------------------------------

describe("cross-orchestrator handoff (id form)", () => {
  test("a 'planned' workspace from /adw-plan is accepted by the full orchestrator's loadWorkspace at 'build'", () => {
    // Seed exactly what /adw-plan leaves on disk after a successful run.
    const wsId = "01TESTWS07";
    seedWorkspaceState(wsId, {
      adw_id: wsId,
      description: "add a planning skill",
      status: "planned",
      completed_stages: ["plan", "review"],
      spec_path: "/abs/SPEC-064.md",
      agents: ["planner", "reviewer", "upgrader"],
    });

    // The full orchestrator's loadWorkspace must NOT refuse "planned" — only
    // "completed" is refused. resumeFrom must auto-detect to "build" so plan
    // and review are skipped when /adw-implement --resume <id> runs.
    const r = loadWorkspaceFull(wsId, undefined, AGENTS_DIR);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.resumeFrom).toBe("build");
      expect(r.right.completedStages).toEqual(["plan", "review"]);
      expect(r.right.specPath).toBe("/abs/SPEC-064.md");
    }
  });
});
