/**
 * @file builder.test.ts
 * @description Deterministic unit tests for adws/adws-modules/builder.ts.
 *
 * No live `claude`, no live `codex`, no real `agents/` mutation. All subprocess
 * I/O is faked via BuilderDeps mocks; all files go to a temp dir.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  BUILD_MODEL,
  build,
  ensureAvailable,
  parseSkillResult,
  type BuilderDeps,
} from "../../adws/adws-modules/builder.ts";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "builder-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Build a fake BuilderDeps whose run/runCapture return canned values. */
function fakeDeps(opts: {
  runResult?: Either<string, string>;
  runCaptureResult?: Either<string, string>;
  runCaptureCalls?: Array<{ cmd: string; args: string[]; teeTo: string }>;
} = {}): BuilderDeps & { runCalls: Array<{ cmd: string; args: string[] }> } {
  const runCalls: Array<{ cmd: string; args: string[] }> = [];
  const runCaptureCalls = opts.runCaptureCalls;
  return {
    runCalls,
    run: (cmd, args) => {
      runCalls.push({ cmd, args });
      return TaskEither.from(async () => opts.runResult ?? Either.right("claude 1.0.0"));
    },
    runCapture: (cmd, args, captureOpts) => {
      if (runCaptureCalls) runCaptureCalls.push({ cmd, args, teeTo: captureOpts.teeTo });
      return TaskEither.from(async () => opts.runCaptureResult ?? Either.right(""));
    },
  };
}

const SUCCESS_RESULT_LINE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Implementation complete.",
});

// ---------------------------------------------------------------------------
// ensureAvailable
// ---------------------------------------------------------------------------

describe("ensureAvailable", () => {
  test("probes `claude --version` and returns Right when it responds", async () => {
    const deps = fakeDeps({ runResult: Either.right("claude 1.0.0") });
    const result = await ensureAvailable(deps, tmp).run();
    expect(Either.isRight(result)).toBe(true);
    expect(deps.runCalls).toEqual([{ cmd: "claude", args: ["--version"] }]);
  });

  test("returns a Left mentioning claude when the probe fails", async () => {
    const deps = fakeDeps({ runResult: Either.left("spawn failed") });
    const result = await ensureAvailable(deps, tmp).run();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("`claude`");
  });
});

// ---------------------------------------------------------------------------
// parseSkillResult
// ---------------------------------------------------------------------------

describe("parseSkillResult", () => {
  test("returns ok=true on a success result line", () => {
    const r = parseSkillResult(join(tmp, "missing.jsonl"), SUCCESS_RESULT_LINE);
    expect(r).not.toBeNull();
    if (r) {
      expect(r.ok).toBe(true);
      expect(r.summary).toBe("Implementation complete.");
    }
  });

  test("returns ok=false on a failure result line (is_error)", () => {
    const failure = JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "Tests failed.",
    });
    const r = parseSkillResult(join(tmp, "missing.jsonl"), failure);
    if (r) expect(r.ok).toBe(false);
  });

  test("uses the LAST result line when several are present", () => {
    const twoResults = [
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "first" }),
      JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "second" }),
    ].join("\n");
    const r = parseSkillResult(join(tmp, "missing.jsonl"), twoResults);
    if (r) {
      expect(r.ok).toBe(false);
      expect(r.summary).toBe("second");
    }
  });

  test("ignores malformed trailing lines after the result line", () => {
    const withJunk = SUCCESS_RESULT_LINE + "\n{this is not json";
    const r = parseSkillResult(join(tmp, "missing.jsonl"), withJunk);
    if (r) expect(r.ok).toBe(true);
  });

  test("falls back to reading the builder log file when stdout is empty", () => {
    const logPath = join(tmp, "raw-output.jsonl");
    writeFileSync(logPath, SUCCESS_RESULT_LINE);
    const r = parseSkillResult(logPath, "");
    if (r) expect(r.ok).toBe(true);
  });

  test("returns null when no result line exists", () => {
    const r = parseSkillResult(join(tmp, "missing.jsonl"), "");
    expect(r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

describe("build", () => {
  test("initializes raw-output.jsonl, calls runCapture with /implement, returns Right on success", async () => {
    const calls: Array<{ cmd: string; args: string[]; teeTo: string }> = [];
    const deps = fakeDeps({
      runCaptureResult: Either.right(SUCCESS_RESULT_LINE),
      runCaptureCalls: calls,
    });
    const builderLog = join(tmp, "builder", "raw-output.jsonl");

    const result = await build(deps, tmp, "/abs/spec.md", builderLog).run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right.rawOutputPath).toBe(builderLog);
    // raw-output.jsonl was truncated to empty before runCapture.
    expect(readFileSync(builderLog, "utf8")).toBe("");
    // runCapture got the expected invocation.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe("claude");
    expect(calls[0]!.args).toContain("/implement /abs/spec.md");
    expect(calls[0]!.teeTo).toBe(builderLog);
  });

  test("uses BUILD_MODEL by default, override when passed", async () => {
    const calls: Array<{ cmd: string; args: string[]; teeTo: string }> = [];
    const deps = fakeDeps({
      runCaptureResult: Either.right(SUCCESS_RESULT_LINE),
      runCaptureCalls: calls,
    });
    const builderLog = join(tmp, "builder", "raw-output.jsonl");

    await build(deps, tmp, "/abs/spec.md", builderLog).run();
    expect(calls[0]!.args).toContain("--model");
    const defaultModelIdx = calls[0]!.args.indexOf("--model");
    expect(calls[0]!.args[defaultModelIdx! + 1]).toBe(BUILD_MODEL);

    calls.length = 0;
    await build(deps, tmp, "/abs/spec.md", builderLog, "glm-4.7").run();
    const overrideIdx = calls[0]!.args.indexOf("--model");
    expect(calls[0]!.args[overrideIdx! + 1]).toBe("glm-4.7");
  });

  test("returns Left when the skill reports failure (is_error)", async () => {
    const deps = fakeDeps({
      runCaptureResult: Either.right(JSON.stringify({
        type: "result",
        subtype: "error",
        is_error: true,
        result: "Build failed.",
      })),
    });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl")).run();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("skill reported failure");
  });

  test("returns Left when no parseable result line is present", async () => {
    const deps = fakeDeps({ runCaptureResult: Either.right("just some text\nno json here") });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl")).run();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("no parseable result line");
  });

  test("returns Left when runCapture itself fails (non-zero exit)", async () => {
    const deps = fakeDeps({ runCaptureResult: Either.left("claude exited with code 124") });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl")).run();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("code 124");
  });
});
