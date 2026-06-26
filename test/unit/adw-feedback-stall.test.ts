/**
 * @file adw-feedback-stall.test.ts
 * @description ADR-0108 (c) — feedback-channel integrity guard.
 *
 * The retry loop learns what to fix ONLY when patch-review appends findings to
 * the spec. When patch-review returns `gaps` but the spec file is unchanged
 * (same mtimeMs + size) since the last build, the guard emits `feedback-stalled`
 * and finalizes Left — it does NOT re-run build blind.
 *
 * Tested via runPipeline with mocked deps + a REAL spec file on disk (so the
 * stat fingerprint is meaningful). No real claude/codex (ADR-0105: per-test
 * temp AGENTS_DIR via the orchestrator's agentsDir seam).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  runPipeline,
  type PipelineDeps,
  type PlanResult,
  type SpecReviewResult,
  type BuildOutcome,
  type PatchReviewResult,
  type TestOutcome,
  type OrchestratorWorktreeDeps,
} from "../../adws/adw-plan-review-build-patch.ts";

let AGENTS_DIR = "";

// Shared mock worktree deps (satisfy OrchestratorWorktreeDeps; git ops unused).
const mockWorktreeDeps: OrchestratorWorktreeDeps = {
  withPlanningLock: async <T>(_rootPath: string, fn: () => Promise<T>): Promise<T> => fn(),
  commitSpecToMain: () => TaskEither.from(async () => Either.right({ committed: false })),
  commitWorktreeChanges: () => TaskEither.from(async () => Either.right({ committed: false })),
  createWorktree: () => TaskEither.from(async () => Either.right("")),
  createWorktreeFromBase: () => TaskEither.from(async () => Either.right("")),
  validateWorktree: () => TaskEither.from(async () => Either.right({ ok: true, path: "/mock", branch: "adw/test" })),
  removeWorktree: () => TaskEither.from(async () => Either.right(undefined)),
  detectWorktree: () => TaskEither.from(async () => Either.right(false)),
  gitRun: () => TaskEither.from(async () => Either.right("deadbeef")),
  mergeBranchToMain: () => TaskEither.from(async () => Either.right({ sha: "deadbeef" })),
};

const mockPatchGaps = (): PatchReviewResult => ({ id: "P", verdict: "gaps", specPath: "" });
const mockPatchPass = (): PatchReviewResult => ({ id: "P", verdict: "pass", specPath: "" });

/** Mock deps: all stages no-op successfully; patch-review returns the given sequence.
 * Counters are mutated on the returned object itself (deps.buildCalls/patchCalls). */
function mockDeps(patchSeq: PatchReviewResult[]): PipelineDeps & { patchCalls: number; buildCalls: number } {
  const tryPop = <T>(arr: T[], fallback: T): T => (arr.length > 0 ? (arr.shift() as T) : fallback);
  const deps = {
    buildCalls: 0,
    patchCalls: 0,
    runPlan: async (): Promise<Either<string, PlanResult>> => Either.right({ id: "P", specPath: null }),
    runSpecReview: async (_spec: string): Promise<Either<string, SpecReviewResult>> =>
      Either.right({ id: "R", specPath: _spec, kind: "unchanged" }),
    runBuild: async (): Promise<Either<string, BuildOutcome>> => {
      deps.buildCalls++;
      return Either.right({ id: "B", specPath: "" });
    },
    runTest: async (): Promise<Either<string, TestOutcome>> =>
      Either.right({ id: "T", verdict: "pass", specPath: "" }),
    runPatchReview: async (): Promise<Either<string, PatchReviewResult>> => {
      deps.patchCalls++;
      return Either.right(tryPop(patchSeq, mockPatchPass()));
    },
  };
  return deps as unknown as PipelineDeps & { patchCalls: number; buildCalls: number };
}

beforeEach(() => {
  AGENTS_DIR = mkdtempSync(join(tmpdir(), "adw-fb-stall-"));
});
afterEach(() => {
  rmSync(AGENTS_DIR, { recursive: true, force: true });
});

describe("ADR-0108 (c) — feedback-channel integrity guard", () => {
  test("spec unchanged across gaps iterations → feedback-stalled, finalize Left, no blind rebuild", async () => {
    // Real spec file on disk; we do NOT modify it between iterations, so the
    // fingerprint stays identical → the guard must fire on the first retry.
    const specPath = join(AGENTS_DIR, "SPEC-fb.md");
    writeFileSync(specPath, "# Spec\nunchanged body\n");

    // patch-review returns gaps 3× — but since the spec never changes, the guard
    // should stop the loop after the FIRST gaps (before the second rebuild).
    const deps = mockDeps([mockPatchGaps(), mockPatchGaps(), mockPatchGaps()]);

    const result = await runPipeline(
      deps,
      { description: "", specPath },
      AGENTS_DIR,
      mockWorktreeDeps,
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("feedback stalled");
    }

    // Exactly one initial build + one patch-review (gaps). The guard fires
    // BEFORE the rebuild, so buildCalls stays at 1 (no blind second build).
    expect(deps.buildCalls).toBe(1);
    expect(deps.patchCalls).toBe(1);
  });

  test("spec modified between gaps iterations → rebuild proceeds (no false positive)", async () => {
    // To simulate patch-review appending findings, we modify the spec file when
    // patch-review runs. Use a side-effecting patch mock that appends to the spec.
    const specPath = join(AGENTS_DIR, "SPEC-fb2.md");
    writeFileSync(specPath, "# Spec\noriginal\n");

    let patchCalls = 0;
    const counters = { buildCalls: 0 };
    const patchSeq: PatchReviewResult[] = [mockPatchGaps(), mockPatchPass()];
    const deps: PipelineDeps = {
      runPlan: async (): Promise<Either<string, PlanResult>> => Either.right({ id: "P", specPath: null }),
      runSpecReview: async (_spec): Promise<Either<string, SpecReviewResult>> =>
        Either.right({ id: "R", specPath: _spec, kind: "unchanged" }),
      runBuild: async (): Promise<Either<string, BuildOutcome>> => {
        counters.buildCalls++;
        return Either.right({ id: "B", specPath: "" });
      },
      runTest: async (): Promise<Either<string, TestOutcome>> =>
        Either.right({ id: "T", verdict: "pass", specPath: "" }),
      runPatchReview: async (): Promise<Either<string, PatchReviewResult>> => {
        const r = patchSeq.shift() ?? mockPatchPass();
        patchCalls++;
        if (r.verdict === "gaps") {
          // Simulate patch-review appending findings → spec changes.
          writeFileSync(specPath, `# Spec\noriginal\n## Audit ${patchCalls}\nnew finding\n`);
        }
        return Either.right(r);
      },
    };
    Object.assign(deps, counters);

    const result = await runPipeline(
      deps,
      { description: "", specPath },
      AGENTS_DIR,
      mockWorktreeDeps,
    );

    expect(Either.isRight(result)).toBe(true);
    // The spec was modified, so the guard did NOT fire; the loop rebuilt and passed.
    expect(counters.buildCalls).toBe(2);
  });
});
