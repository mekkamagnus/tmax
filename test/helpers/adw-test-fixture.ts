/**
 * @file adw-test-fixture.ts
 * @description Shared test fixtures for adw orchestrator tests. Issue #35:
 *   mockWorktreeDeps was duplicated (with drift) across 3 test files.
 *   This factory returns a FRESH object per call (no shared mutable state).
 */
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import type { OrchestratorWorktreeDeps } from "../../adws/adw-plan-review-build-patch.ts";

/**
 * Factory: fresh mock worktree deps satisfying OrchestratorWorktreeDeps.
 * All ops return Right with no real effect. detectWorktree returns false
 * (pretend main checkout) so the orchestrator doesn't refuse to create a
 * worktree inside the test's temp dir. gitRun returns a plausible SHA.
 */
export function createMockWorktreeDeps(): OrchestratorWorktreeDeps {
  return {
    withPlanningLock: async <T>(_rootPath: string, fn: () => Promise<T>): Promise<T> => fn(),
    commitSpecToMain: () => TaskEither.from(async () => Either.right({ committed: false })),
    commitWorktreeChanges: () => TaskEither.from(async () => Either.right({ committed: false })),
    createWorktree: () => TaskEither.from(async () => Either.right("")),
    createWorktreeFromBase: () => TaskEither.from(async () => Either.right("")),
    validateWorktree: () => TaskEither.from(async () => Either.right({ ok: true, path: "/mock/worktree", branch: "adw/test" })),
    removeWorktree: () => TaskEither.from(async () => Either.right(undefined)),
    detectWorktree: () => TaskEither.from(async () => Either.right(false)),
    gitRun: () => TaskEither.from(async () => Either.right("deadbeef")),
    mergeBranchToMain: () => TaskEither.from(async () => Either.right({ sha: "deadbeef" })),
  };
}
