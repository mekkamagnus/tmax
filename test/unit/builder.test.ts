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
  buildImplementPrompt,
  ensureAvailable,
  GOAL_EXHAUSTED_MARKER,
  GOAL_TURN_LIMIT,
  matchGoalExhaustion,
  matchGoalUnavailable,
  parseClaudeVersion,
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
    expect(calls[0]!.args.some((a: string) => a.includes("/implement /abs/spec.md"))).toBe(true);
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

// ---------------------------------------------------------------------------
// CHORE-40: buildImplementPrompt + goal-mode helpers
// ---------------------------------------------------------------------------

describe("buildImplementPrompt", () => {
  test("without a goal returns /implement with worktree directive (BUG-22)", () => {
    const prompt = buildImplementPrompt("/abs/spec.md");
    expect(prompt).toContain("/implement /abs/spec.md");
    expect(prompt).toContain("worktree");
    expect(prompt).toContain("NEVER");
  });

  test("with a goal returns /goal prompt containing /implement directive", () => {
    const prompt = buildImplementPrompt("/abs/spec.md", "bun run test:unit passes");
    expect(prompt.startsWith("/goal ")).toBe(true);
    expect(prompt).toContain("Run the /implement skill");
    // spec path is JSON-stringified inside the prose directive.
    expect(prompt).toContain(JSON.stringify("/abs/spec.md"));
    expect(prompt).toContain("bun run test:unit passes");
  });

  test("goal prompt includes the turn limit and exhaustion marker", () => {
    const prompt = buildImplementPrompt("/abs/spec.md", "done");
    expect(prompt).toContain(`${GOAL_TURN_LIMIT} goal turns`);
    expect(prompt).toContain(GOAL_EXHAUSTED_MARKER);
  });

  test("goal prompt preserves quotes and multiline goals", () => {
    const trickyGoal = 'a "quoted" goal\nwith /slash and #hash';
    const prompt = buildImplementPrompt("/abs/spec.md", trickyGoal);
    // The full tricky goal is embedded verbatim in the single prompt string.
    expect(prompt).toContain(trickyGoal);
  });
});

describe("parseClaudeVersion", () => {
  test("parses 'Claude Code v2.1.139'", () => {
    expect(parseClaudeVersion("Claude Code v2.1.139")).toEqual([2, 1, 139]);
  });
  test("parses bare '2.1.195'", () => {
    expect(parseClaudeVersion("2.1.195 (Claude Code)")).toEqual([2, 1, 195]);
  });
  test("returns null when no semver present", () => {
    expect(parseClaudeVersion("unknown")).toBeNull();
  });
});

describe("matchGoalUnavailable / matchGoalExhaustion", () => {
  test("matches Unknown command: /goal", () => {
    expect(matchGoalUnavailable("Error: Unknown command: /goal")).toBe("Unknown command: /goal");
  });
  test("matches hooks are disabled", () => {
    expect(matchGoalUnavailable("fatal: hooks are disabled in config")).toBe("hooks are disabled");
  });
  test("returns null when no unavailability substring", () => {
    expect(matchGoalUnavailable("some other error")).toBeNull();
  });
  test("matches context window exhaustion", () => {
    expect(matchGoalExhaustion("exceeded context window")).toBe("context window");
  });
  test("matches 529 rate limit exhaustion", () => {
    // Returns the first matching substring; both "529" and "rate limit" are
    // valid exhaustion signals.
    const matched = matchGoalExhaustion("HTTP 529 rate limit");
    expect(matched === "529" || matched === "rate limit").toBe(true);
  });
  test("returns null when no exhaustion substring", () => {
    expect(matchGoalExhaustion("permission denied")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CHORE-40: build() goal-mode classification
// ---------------------------------------------------------------------------

/** Build a stream-json stdout with a final result event. */
function streamWithResult(resultString: string, opts: { costUsd?: number; assistantCount?: number; extraLines?: string[] } = {}): string {
  const lines: string[] = [];
  for (let i = 0; i < (opts.assistantCount ?? 3); i++) {
    lines.push(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } }));
  }
  if (opts.extraLines) lines.push(...opts.extraLines);
  lines.push(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: resultString,
    ...(opts.costUsd !== undefined ? { total_cost_usd: opts.costUsd } : {}),
  }));
  return lines.join("\n");
}

describe("build goal-mode classification", () => {
  test("goal-met when result event has no exhausted marker", async () => {
    const deps = fakeDeps({
      runResult: Either.right("Claude Code v2.1.195"),
      runCaptureResult: Either.right(streamWithResult("Goal completed successfully.", { costUsd: 0.28, assistantCount: 7 })),
    });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl"), BUILD_MODEL, undefined, "the goal").run();
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.goalStatus).toBe("goal-met");
      expect(result.right.goalCostUsd).toBeCloseTo(0.28);
      expect(result.right.goalTurns).toBe(7);
    }
  });

  test("goal-exhausted when result event contains exhausted marker", async () => {
    const deps = fakeDeps({
      runResult: Either.right("Claude Code v2.1.195"),
      runCaptureResult: Either.right(streamWithResult(
        `Could not satisfy. ${GOAL_EXHAUSTED_MARKER}\nRemaining: nothing`,
        { costUsd: 0.37, assistantCount: 20 },
      )),
    });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl"), BUILD_MODEL, undefined, "the goal").run();
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.goalStatus).toBe("goal-exhausted");
      expect(result.right.goalTurns).toBe(20);
    }
  });

  test("marker in prompt echo (user message) does NOT cause false goal-exhausted", async () => {
    // The marker appears in an early user message but the final result event
    // does NOT contain it — this is the smoke-test-proven false-positive guard.
    const echoLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: `/goal ... ${GOAL_EXHAUSTED_MARKER} ...` },
    });
    const deps = fakeDeps({
      runResult: Either.right("Claude Code v2.1.195"),
      runCaptureResult: Either.right(streamWithResult("Goal met.", { extraLines: [echoLine] })),
    });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl"), BUILD_MODEL, undefined, "the goal").run();
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right.goalStatus).toBe("goal-met");
  });

  test("goal-error on nonzero exit with no recognized exhaustion signal", async () => {
    const deps = fakeDeps({
      runResult: Either.right("Claude Code v2.1.195"),
      runCaptureResult: Either.left("claude exited with code 1: permission denied"),
    });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl"), BUILD_MODEL, undefined, "the goal").run();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("goal-error");
  });

  test("goal-exhausted on nonzero exit with context-window substring", async () => {
    const deps = fakeDeps({
      runResult: Either.right("Claude Code v2.1.195"),
      runCaptureResult: Either.left("claude exited with code 1: exceeded context window"),
    });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl"), BUILD_MODEL, undefined, "the goal").run();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("goal-exhausted");
  });

  test("goal mode does not pass --max-turns", async () => {
    const calls: Array<{ cmd: string; args: string[]; teeTo: string }> = [];
    const deps = fakeDeps({
      runResult: Either.right("Claude Code v2.1.195"),
      runCaptureResult: Either.right(streamWithResult("done")),
      runCaptureCalls: calls,
    });
    await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl"), BUILD_MODEL, undefined, "the goal").run();
    expect(calls[0]!.args).not.toContain("--max-turns");
    expect(calls[0]!.args.some((a) => a.startsWith("/goal "))).toBe(true);
  });

  test("version guard rejects claude older than 2.1.139 for goal mode", async () => {
    const deps = fakeDeps({
      runResult: Either.right("Claude Code v2.1.37"),
      runCaptureResult: Either.right(streamWithResult("done")),
    });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl"), BUILD_MODEL, undefined, "the goal").run();
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) expect(result.left).toContain("older than 2.1.139");
  });

  test("non-goal build is unaffected (no version guard, no goalStatus)", async () => {
    const calls: Array<{ cmd: string; args: string[]; teeTo: string }> = [];
    const deps = fakeDeps({
      runResult: Either.right("claude 1.0.0"),
      runCaptureResult: Either.right(SUCCESS_RESULT_LINE),
      runCaptureCalls: calls,
    });
    const result = await build(deps, tmp, "/abs/spec.md", join(tmp, "b", "raw-output.jsonl")).run();
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right.goalStatus).toBeUndefined();
    // No extra --version probe for non-goal builds.
    expect(deps.runCalls).toEqual([]);
    expect(calls[0]!.args.some((a) => a.startsWith("/goal "))).toBe(false);
  });
});
