/**
 * @file adw-patch-review.test.ts
 * @description Deterministic unit tests for adws/adw-patch-review.ts and
 * adws/adws-modules/patch-reviewer.ts. No live `claude`, no live `git`, no
 * real `agents/` mutation — all fixtures in a temp dir.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  parseArgs,
  resolveInputFrom,
  runPatchReviewWithDeps,
} from "../../adws/adw-patch-review.ts";
import {
  parseVerdict,
  parseClaudeStreamVerdict,
  renderGatherBundle,
  buildAuditPrompt,
  ensureAvailable,
  type PatchReviewerDeps,
  type RawRunResult,
  type GatherBundle,
  type GateResults,
  type AuditVerdict,
} from "../../adws/adws-modules/patch-reviewer.ts";

let tmp = "";
let agentsDir: string;
let specsDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "adw-patch-review-test-"));
  agentsDir = join(tmp, "agents");
  specsDir = join(tmp, "specs");
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockDeps(
  overrides: Partial<{
    run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
    runRaw: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, RawRunResult>;
    runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string }) => TaskEither<string, string>;
  }> = {},
): PatchReviewerDeps {
  return {
    run: overrides.run ?? ((_cmd, _args, _opts) => TaskEither.right("mock")),
    runRaw: overrides.runRaw ?? ((_cmd, _args, _opts) =>
      TaskEither.right<RawRunResult, string>({ ok: true, exitCode: 0, stdout: "", stderr: "" })),
    runCapture: overrides.runCapture ?? ((_cmd, _args, _opts) => TaskEither.right("mock")),
  };
}

function passGates(): GateResults {
  return {
    typecheck: { ok: true, exitCode: 0, stdout: "", stderr: "", output: "" },
    unit: { ok: true, exitCode: 0, stdout: "", stderr: "", output: "" },
  };
}

function failGates(): GateResults {
  return {
    typecheck: { ok: false, exitCode: 1, stdout: "", stderr: "type error", output: "type error" },
    unit: { ok: true, exitCode: 0, stdout: "", stderr: "", output: "" },
  };
}

function passVerdict(): AuditVerdict {
  return {
    verdict: "pass",
    summary: "All criteria implemented.",
    criteria: [{ criterion: "feature exists", status: "implemented", evidence: "src/a.ts:10" }],
    tests: [{ behavior: "basic test", status: "covered", evidence: "test/a.test.ts:5" }],
    edge_cases: [{ case: "empty input", status: "handled", evidence: "src/a.ts:15" }],
  };
}

function gapsVerdict(): AuditVerdict {
  return {
    verdict: "gaps",
    summary: "Missing test coverage.",
    criteria: [{ criterion: "feature exists", status: "partial", evidence: "src/a.ts:10" }],
    tests: [{ behavior: "edge case test", status: "uncovered", evidence: "" }],
    edge_cases: [{ case: "empty input", status: "missed", evidence: "" }],
  };
}

/** Build a stream-json result line containing a verdict JSON as the `result` string. */
function streamResultLine(verdict: AuditVerdict): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(verdict) });
}

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
      expect(r.right.id).toBeUndefined();
    }
  });

  test("accepts --model with a value", () => {
    const r = parseArgs(["--model", "glm-5.2", "docs/specs/SPEC-001-x.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.model).toBe("glm-5.2");
  });

  test("accepts --id with a value", () => {
    const r = parseArgs(["--id", "01KVCMJ0QR", "docs/specs/SPEC-001-x.md"]);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.id).toBe("01KVCMJ0QR");
  });

  test("--model without a value → Left", () => {
    const r = parseArgs(["--model"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--model requires a value");
  });

  test("--id without a value → Left", () => {
    const r = parseArgs(["--id"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--id requires a value");
  });

  test("--id with invalid format → Left", () => {
    const r = parseArgs(["--id", "short", "docs/specs/SPEC-001-x.md"]);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("--id must be a 10-char");
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
    const r = resolveInputFrom("SPEC-001-x.md", agentsDir, specsDir);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.source).toBe("path");
      expect(r.right.specPath).toBe(join(specsDir, "SPEC-001-x.md"));
    }
  });

  test("resolves an adw-id whose state has spec_path and base_sha → source 'adw-id' + diffBase", () => {
    const id = "01KVCMAAAA";
    mkdirSync(join(agentsDir, id), { recursive: true });
    writeFileSync(
      join(agentsDir, id, "adw-state.json"),
      JSON.stringify({ adw_id: id, spec_path: "/abs/path/to/spec.md", status: "completed", base_sha: "abc123" }),
    );
    const r = resolveInputFrom(id, agentsDir, specsDir);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) {
      expect(r.right.source).toBe("adw-id");
      expect(r.right.specPath).toBe("/abs/path/to/spec.md");
      expect(r.right.diffBase).toBe("abc123");
    }
  });

  test("adw-id without base_sha → diffBase undefined", () => {
    const id = "01KVCMBBBB";
    mkdirSync(join(agentsDir, id), { recursive: true });
    writeFileSync(
      join(agentsDir, id, "adw-state.json"),
      JSON.stringify({ adw_id: id, spec_path: "/abs/path/to/spec.md", status: "completed" }),
    );
    const r = resolveInputFrom(id, agentsDir, specsDir);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.diffBase).toBeUndefined();
  });

  test("adw-id with state but no spec_path → Left", () => {
    const id = "01KVCMCCCC";
    mkdirSync(join(agentsDir, id), { recursive: true });
    writeFileSync(
      join(agentsDir, id, "adw-state.json"),
      JSON.stringify({ adw_id: id, status: "completed" }),
    );
    const r = resolveInputFrom(id, agentsDir, specsDir);
    expect(Either.isLeft(r)).toBe(true);
  });

  test("non-spec, non-adw-id input → Left", () => {
    const r = resolveInputFrom("some-random-thing", agentsDir, specsDir);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("neither a spec path");
  });
});

// ---------------------------------------------------------------------------
// parseVerdict
// ---------------------------------------------------------------------------

describe("parseVerdict", () => {
  test("valid pass verdict", () => {
    const raw = JSON.stringify(passVerdict());
    const r = parseVerdict(raw);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.verdict).toBe("pass");
  });

  test("valid gaps verdict", () => {
    const raw = JSON.stringify(gapsVerdict());
    const r = parseVerdict(raw);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.verdict).toBe("gaps");
  });

  test("invalid verdict field → Left", () => {
    const raw = JSON.stringify({ verdict: "maybe", summary: "x", criteria: [], tests: [], edge_cases: [] });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("malformed JSON → Left", () => {
    expect(Either.isLeft(parseVerdict("{not json"))).toBe(true);
  });

  test("missing criteria array → Left", () => {
    const raw = JSON.stringify({ verdict: "pass", summary: "x", tests: [], edge_cases: [] });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("missing tests array → Left", () => {
    const raw = JSON.stringify({ verdict: "pass", summary: "x", criteria: [], edge_cases: [] });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("missing edge_cases array → Left", () => {
    const raw = JSON.stringify({ verdict: "pass", summary: "x", criteria: [], tests: [] });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("non-array criteria → Left", () => {
    const raw = JSON.stringify({ verdict: "pass", summary: "x", criteria: "oops", tests: [], edge_cases: [] });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("invalid criterion status → Left", () => {
    const raw = JSON.stringify({
      verdict: "pass", summary: "x",
      criteria: [{ criterion: "c", status: "done", evidence: "e" }],
      tests: [], edge_cases: [],
    });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("invalid test status → Left", () => {
    const raw = JSON.stringify({
      verdict: "pass", summary: "x", criteria: [],
      tests: [{ behavior: "b", status: "maybe", evidence: "e" }],
      edge_cases: [],
    });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("invalid edge_case status → Left", () => {
    const raw = JSON.stringify({
      verdict: "pass", summary: "x", criteria: [], tests: [],
      edge_cases: [{ case: "c", status: "unknown", evidence: "e" }],
    });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("missing item string fields → Left", () => {
    const raw = JSON.stringify({
      verdict: "pass", summary: "x",
      criteria: [{ status: "implemented", evidence: "e" }],
      tests: [], edge_cases: [],
    });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });

  test("non-string summary → Left", () => {
    const raw = JSON.stringify({ verdict: "pass", summary: 42, criteria: [], tests: [], edge_cases: [] });
    expect(Either.isLeft(parseVerdict(raw))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseClaudeStreamVerdict
// ---------------------------------------------------------------------------

describe("parseClaudeStreamVerdict", () => {
  test("extracts the final result from stream-json", () => {
    const stream = [
      JSON.stringify({ type: "assistant", content: "working" }),
      streamResultLine(passVerdict()),
    ].join("\n");
    const r = parseClaudeStreamVerdict(stream);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.verdict).toBe("pass");
  });

  test("ignores malformed non-result lines", () => {
    const stream = [
      "garbage line",
      JSON.stringify({ type: "message", content: "thinking" }),
      streamResultLine(gapsVerdict()),
      "more garbage",
    ].join("\n");
    const r = parseClaudeStreamVerdict(stream);
    expect(Either.isRight(r)).toBe(true);
    if (Either.isRight(r)) expect(r.right.verdict).toBe("gaps");
  });

  test("missing result → Left", () => {
    const stream = [
      JSON.stringify({ type: "assistant", content: "working" }),
    ].join("\n");
    const r = parseClaudeStreamVerdict(stream);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("no result event");
  });

  test("non-string result → Left", () => {
    const stream = [
      JSON.stringify({ type: "result", result: { foo: "bar" } }),
    ].join("\n");
    const r = parseClaudeStreamVerdict(stream);
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("non-string result");
  });

  test("string result with invalid verdict → Left", () => {
    const stream = [
      JSON.stringify({ type: "result", result: '{"verdict":"nope","summary":"x","criteria":[],"tests":[],"edge_cases":[]}' }),
    ].join("\n");
    const r = parseClaudeStreamVerdict(stream);
    expect(Either.isLeft(r)).toBe(true);
  });

  test("empty stream → Left", () => {
    const r = parseClaudeStreamVerdict("");
    expect(Either.isLeft(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderGatherBundle
// ---------------------------------------------------------------------------

describe("renderGatherBundle", () => {
  test("includes spec path, diff base, changed files, and gates", () => {
    const gather: GatherBundle = {
      specContent: "# My Spec",
      diff: "--- a/x\n+++ b/x\n+hello",
      untrackedDiff: "",
      filesChanged: ["src/x.ts"],
      diffBase: "abc123",
    };
    const md = renderGatherBundle("/path/to/spec.md", gather, passGates());
    expect(md).toContain("/path/to/spec.md");
    expect(md).toContain("abc123");
    expect(md).toContain("src/x.ts");
    expect(md).toContain("hello");
    expect(md).toContain("gates_failed: false");
    expect(md).toContain("PASS");
  });

  test("includes git warning when present", () => {
    const gather: GatherBundle = {
      specContent: "# Spec",
      diff: "",
      untrackedDiff: "",
      filesChanged: [],
      gitWarning: "no build base_sha",
    };
    const md = renderGatherBundle("/path/to/spec.md", gather);
    expect(md).toContain("no build base_sha");
  });

  test("includes untracked diff section", () => {
    const gather: GatherBundle = {
      specContent: "# Spec",
      diff: "",
      untrackedDiff: "diff --git a/new.ts b/new.ts\nnew file mode 100644",
      filesChanged: ["new.ts"],
    };
    const md = renderGatherBundle("/path/to/spec.md", gather);
    expect(md).toContain("Untracked files");
    expect(md).toContain("new file mode 100644");
  });

  test("shows gates_failed: true when gates fail", () => {
    const gather: GatherBundle = {
      specContent: "# Spec",
      diff: "",
      untrackedDiff: "",
      filesChanged: [],
    };
    const md = renderGatherBundle("/path/to/spec.md", gather, failGates());
    expect(md).toContain("gates_failed: true");
    expect(md).toContain("FAIL");
  });

  test("deterministic for same input", () => {
    const gather: GatherBundle = {
      specContent: "# Spec",
      diff: "diff",
      untrackedDiff: "",
      filesChanged: ["a.ts"],
    };
    const md1 = renderGatherBundle("/p.md", gather, passGates());
    const md2 = renderGatherBundle("/p.md", gather, passGates());
    expect(md1).toBe(md2);
  });
});

// ---------------------------------------------------------------------------
// buildAuditPrompt
// ---------------------------------------------------------------------------

describe("buildAuditPrompt", () => {
  test("includes spec content, diff, and gate results", () => {
    const gather: GatherBundle = {
      specContent: "# SPEC-001\n\nAcceptance: thing exists",
      diff: "+added thing",
      untrackedDiff: "",
      filesChanged: ["a.ts"],
    };
    const prompt = buildAuditPrompt("/spec.md", gather, passGates());
    expect(prompt).toContain("SPEC-001");
    expect(prompt).toContain("Acceptance: thing exists");
    expect(prompt).toContain("added thing");
    expect(prompt).toContain("typecheck:src");
    expect(prompt).toContain("PASS");
  });

  test("includes rubric instructions", () => {
    const gather: GatherBundle = {
      specContent: "# Spec",
      diff: "",
      untrackedDiff: "",
      filesChanged: [],
    };
    const prompt = buildAuditPrompt("/spec.md", gather, passGates());
    expect(prompt).toContain("Rubric");
    expect(prompt).toContain("acceptance criterion");
    expect(prompt).toContain("file:line");
  });

  test("truncates massive diffs", () => {
    const hugeDiff = "+x".repeat(60_000);
    const gather: GatherBundle = {
      specContent: "# Spec",
      diff: hugeDiff,
      untrackedDiff: "",
      filesChanged: [],
    };
    const prompt = buildAuditPrompt("/spec.md", gather, passGates());
    expect(prompt).toContain("diff truncated");
    expect(prompt.length).toBeLessThan(hugeDiff.length);
  });

  test("shows FAIL when gates fail", () => {
    const gather: GatherBundle = {
      specContent: "# Spec",
      diff: "",
      untrackedDiff: "",
      filesChanged: [],
    };
    const prompt = buildAuditPrompt("/spec.md", gather, failGates());
    expect(prompt).toContain("FAIL");
  });
});

// ---------------------------------------------------------------------------
// ensureAvailable
// ---------------------------------------------------------------------------

describe("ensureAvailable", () => {
  test("Right when claude --version succeeds", async () => {
    const deps: PatchReviewerDeps = {
      ...mockDeps(),
      run: (_cmd, _args, _opts) => TaskEither.right("claude 1.0"),
    };
    const r = await ensureAvailable(deps, tmp).run();
    expect(Either.isRight(r)).toBe(true);
  });

  test("Left when claude --version fails", async () => {
    const deps: PatchReviewerDeps = {
      ...mockDeps(),
      run: (_cmd, _args, _opts) => TaskEither.left("not found"),
    };
    const r = await ensureAvailable(deps, tmp).run();
    expect(Either.isLeft(r)).toBe(true);
    if (Either.isLeft(r)) expect(r.left).toContain("claude");
  });
});
