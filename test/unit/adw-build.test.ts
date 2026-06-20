/**
 * @file adw-build.test.ts
 * @description Deterministic unit tests for adws/adw-build.ts (CLI parsing,
 * input resolution, git trace capture). No live `claude`, no live `git`, no
 * real `agents/` mutation — all fixtures in a temp dir.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  parseArgs,
  resolveInputFrom,
  captureGitTrace,
  type RunOpts,
} from "../../adws/adw-build.ts";

let tmp = "";
let agentsDir: string;
let specsDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "adw-build-test-"));
  agentsDir = join(tmp, "agents");
  specsDir = join(tmp, "specs");
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  test("accepts a bare spec path", () => {
    const r = parseArgs(["docs/specs/SPEC-001-x.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.input).toBe("docs/specs/SPEC-001-x.md");
      expect(r.right.model).toBeUndefined();
    }
  });

  test("accepts --model with a value before the input", () => {
    const r = parseArgs(["--model", "glm-4.7", "docs/specs/SPEC-001-x.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.model).toBe("glm-4.7");
      expect(r.right.input).toBe("docs/specs/SPEC-001-x.md");
    }
  });

  test("--model without a value → Left", () => {
    const r = parseArgs(["--model"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--model requires a value");
  });

  test("no args → usage", () => {
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
    const r = parseArgs(["docs/specs/SPEC-001-x.md", "extra"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("Unexpected extra argument");
  });
});

// ---------------------------------------------------------------------------
// resolveInputFrom
// ---------------------------------------------------------------------------

describe("resolveInputFrom", () => {
  test("resolves a bare filename found in specsDir → source 'path'", () => {
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "SPEC-001-x.md"), "# spec");
    // resolveInputFrom checks PROJECT_ROOT-relative paths too; to keep this
    // isolated we pass a bare filename that exists only in our temp specsDir.
    const r = resolveInputFrom("SPEC-001-x.md", agentsDir, specsDir);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.source).toBe("path");
      expect(r.right.specPath).toBe(join(specsDir, "SPEC-001-x.md"));
    }
  });

  test("resolves a 10-char adw-id whose state has spec_path → source 'adw-id'", () => {
    const id = "01KVCMAAAA";
    mkdirSync(join(agentsDir, id), { recursive: true });
    writeFileSync(
      join(agentsDir, id, "adw-state.json"),
      JSON.stringify({ adw_id: id, spec_path: "/abs/path/to/spec.md", status: "pass" }),
    );
    const r = resolveInputFrom(id, agentsDir, specsDir);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.source).toBe("adw-id");
      expect(r.right.specPath).toBe("/abs/path/to/spec.md");
    }
  });

  test("adw-id with state but no spec_path → Left with 'was it a plan run?' hint", () => {
    const id = "01KVCMBBBB";
    mkdirSync(join(agentsDir, id), { recursive: true });
    writeFileSync(
      join(agentsDir, id, "adw-state.json"),
      JSON.stringify({ adw_id: id, description: "a plan run", type: "feature", status: "completed" }),
    );
    const r = resolveInputFrom(id, agentsDir, specsDir);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("was it a plan run?");
  });

  test("adw-id with no state file → Left", () => {
    const r = resolveInputFrom("01KVCMCCCC", agentsDir, specsDir);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("no agents/");
  });

  test("non-spec, non-adw-id input → Left", () => {
    const r = resolveInputFrom("some-random-thing", agentsDir, specsDir);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("neither a spec path");
  });
});

// ---------------------------------------------------------------------------
// captureGitTrace
// ---------------------------------------------------------------------------

describe("captureGitTrace", () => {
  test("returns base_sha + diff_stat when both git commands succeed", async () => {
    const fakeGit = (_cmd: string, args: string[], _opts?: RunOpts): TaskEither<string, string> => {
      if (args[0] === "rev-parse") return TaskEither.right("abc123def456\n");
      if (args[0] === "diff") return TaskEither.right(" 3 files changed, 10 insertions(+)\n");
      return TaskEither.left("unexpected");
    };
    const warnings: string[] = [];
    const trace = await captureGitTrace(fakeGit, tmp, (m) => warnings.push(m)).run();
    expect(Either.isRight(trace)).toBe(true);
    if (Either.isRight(trace)) {
      expect(trace.right.base_sha).toBe("abc123def456");
      expect(trace.right.diff_stat).toContain("3 files changed");
    }
    expect(warnings).toEqual([]);
  });

  test("swallows rev-parse failure into a warning + empty trace (build still succeeds)", async () => {
    const fakeGit = (_cmd: string, args: string[], _opts?: RunOpts): TaskEither<string, string> => {
      if (args[0] === "rev-parse") return TaskEither.left("not a git repo");
      return TaskEither.right("");
    };
    const warnings: string[] = [];
    const trace = await captureGitTrace(fakeGit, tmp, (m) => warnings.push(m)).run();
    expect(Either.isRight(trace)).toBe(true); // never fails the pipeline
    if (Either.isRight(trace)) {
      expect(trace.right.base_sha).toBeUndefined();
      expect(trace.right.diff_stat).toBeUndefined();
    }
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("git capture failed");
  });

  test("truncates diff_stat to 400 chars", async () => {
    const longStat = "x".repeat(1000);
    const fakeGit = (_cmd: string, args: string[], _opts?: RunOpts): TaskEither<string, string> => {
      if (args[0] === "rev-parse") return TaskEither.right("sha\n");
      if (args[0] === "diff") return TaskEither.right(longStat);
      return TaskEither.left("");
    };
    const trace = await captureGitTrace(fakeGit, tmp, () => {}).run();
    if (Either.isRight(trace)) expect(trace.right.diff_stat!.length).toBe(400);
  });

  test("omits diff_stat when diff --stat fails but rev-parse succeeds", async () => {
    const fakeGit = (_cmd: string, args: string[], _opts?: RunOpts): TaskEither<string, string> => {
      if (args[0] === "rev-parse") return TaskEither.right("sha\n");
      if (args[0] === "diff") return TaskEither.left("diff failed");
      return TaskEither.left("");
    };
    const trace = await captureGitTrace(fakeGit, tmp, () => {}).run();
    if (Either.isRight(trace)) {
      expect(trace.right.base_sha).toBe("sha");
      expect(trace.right.diff_stat).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Workspace discovery integration
// ---------------------------------------------------------------------------
// The discovery helper itself is tested exhaustively in workspace.test.ts
// (10 cases: newest-match, null-on-no-match, corrupt-skip, ULID-filter, etc).
// runBuild's integration with it is verified structurally by typecheck (the
// import resolves, the call site typechecks) and was observed working live
// during the resume demo (stderr: "reusing workspace 01KVF905BH for ...").
