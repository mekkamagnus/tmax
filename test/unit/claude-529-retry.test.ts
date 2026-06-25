/**
 * @file claude-529-retry.test.ts
 * @description Unit tests for dispatcher-level Claude API 529 retry handling.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  CLAUDE_529_BACKOFF_MS,
  hasClaudeApiRateLimit529,
  withClaude529Retry,
} from "../../adws/claude-529-retry.ts";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "claude-529-retry-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function rateLimitLine(): string {
  return JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    api_error_status: 529,
    result: "rate_limit",
  });
}

function successLine(): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ok",
  });
}

describe("hasClaudeApiRateLimit529", () => {
  test("detects structured Claude 529 result lines", () => {
    expect(hasClaudeApiRateLimit529(`noise\n${rateLimitLine()}\n`)).toBe(true);
  });

  test("requires both is_error=true and api_error_status=529", () => {
    expect(hasClaudeApiRateLimit529(JSON.stringify({ is_error: false, api_error_status: 529 }))).toBe(false);
    expect(hasClaudeApiRateLimit529(JSON.stringify({ is_error: true, api_error_status: 500 }))).toBe(false);
    expect(hasClaudeApiRateLimit529("api_error_status: 529")).toBe(false);
  });
});

describe("withClaude529Retry", () => {
  test("backs off and retries claude -p until a non-529 result succeeds", async () => {
    const sequence: Array<Either<string, string>> = [
      Either.left(rateLimitLine()),
      Either.left(rateLimitLine()),
      Either.right(successLine()),
    ];
    let calls = 0;
    const delays: number[] = [];
    const wrapped = withClaude529Retry(
      () => TaskEither.from(async () => sequence[calls++]!),
      { sleep: async (ms) => { delays.push(ms); } },
    );

    const result = await wrapped("claude", ["-p", "prompt"], { teeTo: join(tmp, "raw.jsonl") }).run();

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right).toBe(successLine());
    expect(calls).toBe(3);
    expect(delays).toEqual([30_000, 60_000]);
  });

  test("fails only after the initial attempt plus all three 529 retries", async () => {
    let calls = 0;
    const delays: number[] = [];
    const wrapped = withClaude529Retry(
      () => TaskEither.from(async () => {
        calls++;
        return Either.left<string, string>(rateLimitLine());
      }),
      { sleep: async (ms) => { delays.push(ms); } },
    );

    const result = await wrapped("claude", ["-p", "prompt"], { teeTo: join(tmp, "raw.jsonl") }).run();

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toContain("529");
      expect(result.left).toContain("3 retries");
    }
    expect(calls).toBe(1 + CLAUDE_529_BACKOFF_MS.length);
    expect(delays).toEqual([...CLAUDE_529_BACKOFF_MS]);
  });

  test("does not retry non-claude commands even if their output looks like 529", async () => {
    let calls = 0;
    const delays: number[] = [];
    const wrapped = withClaude529Retry(
      () => TaskEither.from(async () => {
        calls++;
        return Either.left<string, string>(rateLimitLine());
      }),
      { sleep: async (ms) => { delays.push(ms); } },
    );

    const result = await wrapped("git", ["status"], { teeTo: join(tmp, "raw.jsonl") }).run();

    expect(Either.isLeft(result)).toBe(true);
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  test("detects 529 from the per-attempt tee suffix when stderr hides stdout", async () => {
    const teeTo = join(tmp, "raw.jsonl");
    let calls = 0;
    const delays: number[] = [];
    const wrapped = withClaude529Retry(
      (_cmd, _args, opts) => TaskEither.from(async () => {
        calls++;
        if (calls === 1) {
          appendFileSync(opts.teeTo, rateLimitLine() + "\n");
          return Either.left<string, string>("claude stderr without structured JSON");
        }
        appendFileSync(opts.teeTo, successLine() + "\n");
        return Either.right<string, string>(successLine());
      }),
      { sleep: async (ms) => { delays.push(ms); } },
    );

    const result = await wrapped("claude", ["-p", "prompt"], { teeTo }).run();

    expect(Either.isRight(result)).toBe(true);
    expect(calls).toBe(2);
    expect(delays).toEqual([30_000]);
  });
});
