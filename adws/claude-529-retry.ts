import { readFileSync, statSync } from "fs";
import { Either, TaskEither } from "../src/utils/task-either.ts";

export const CLAUDE_529_BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000, 300_000] as const;

export interface Claude529RetryEvent {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  cmd: string;
  args: string[];
}

export interface Claude529RetryOptions {
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (event: Claude529RetryEvent) => void;
}

type CaptureOpts = { teeTo: string };
type RunCapture<Opts extends CaptureOpts> = (
  cmd: string,
  args: string[],
  opts: Opts,
) => TaskEither<string, string>;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isClaudePrint(cmd: string, args: string[]): boolean {
  return cmd === "claude" && args.includes("-p");
}

function teeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function readTeeSuffix(path: string, offset: number): string {
  try {
    return readFileSync(path).subarray(offset).toString("utf8");
  } catch {
    return "";
  }
}

export function hasClaudeApiRateLimit529(output: string): boolean {
  for (const rawLine of output.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const jsonStart = trimmed.indexOf("{");
    if (jsonStart < 0) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed.slice(jsonStart)) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (obj.is_error === true && Number(obj.api_error_status) === 529) {
      return true;
    }
  }
  return false;
}

export function withClaude529Retry<Opts extends CaptureOpts>(
  runCapture: RunCapture<Opts>,
  options: Claude529RetryOptions = {},
): RunCapture<Opts> {
  const delays = options.delaysMs ?? CLAUDE_529_BACKOFF_MS;
  const sleep = options.sleep ?? sleepMs;

  return (cmd, args, opts) => TaskEither.from(async () => {
    for (let attempt = 0; ; attempt++) {
      const startSize = teeSize(opts.teeTo);
      const result = await runCapture(cmd, args, opts).run();
      const directOutput = Either.isLeft(result) ? result.left : result.right;
      const teeOutput = readTeeSuffix(opts.teeTo, startSize);
      const rateLimited = isClaudePrint(cmd, args)
        && (hasClaudeApiRateLimit529(directOutput) || hasClaudeApiRateLimit529(teeOutput));

      if (!rateLimited) return result;
      if (attempt >= delays.length) {
        return Either.left(
          `claude -p hit API 529 rate_limit after ${delays.length} retries`,
        );
      }

      const delayMs = delays[attempt]!;
      options.onRetry?.({
        attempt: attempt + 1,
        maxRetries: delays.length,
        delayMs,
        cmd,
        args,
      });
      await sleep(delayMs);
    }
  });
}
