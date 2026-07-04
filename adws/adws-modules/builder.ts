/**
 * builder.ts — the LLM interface for the adw build dispatcher.
 *
 * Owns the dependency guard (ensureAvailable) and the single `claude -p /implement`
 * call. No CLI, no argv, no run-state tracking — those live in the caller
 * (adw-build.ts).
 *
 * Subprocess execution is injected (BuilderDeps) so this module has no direct
 * dependency on child_process and is unit-testable with a mock. Mirrors the
 * AgentDeps / CodexDeps convention from agent.ts / reviewer.ts (CHORE-26/29).
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { Either, TaskEither } from "../../src/utils/task-either.ts";

const CLAUDE = "claude";

// Default implement model. Override per-run with `adw-build.ts --model <id>`.
export const BUILD_MODEL = "glm-5.2[1m]";

// CHORE-40: /goal mode constants.
/** Maximum goal turns before Claude emits the exhaustion marker and exits. */
export const GOAL_TURN_LIMIT = 50;
/** Exact marker Claude is instructed to emit when the goal cannot be met. */
export const GOAL_EXHAUSTED_MARKER = "ADW_GOAL_EXHAUSTED";

/** Minimum Claude Code version supporting the /goal command (Stop hook). */
const GOAL_MIN_VERSION = [2, 1, 139];

/**
 * Goal status, present on BuildResult only when goal mode was active. The
 * orchestrator threads it through the BuildOutcome side-channel to decide
 * whether to retry with a narrowed goal or fall back to plain /implement.
 */
export type GoalStatus = "goal-met" | "goal-exhausted" | "goal-error";

/** Result of a successful build: the path to the streamed claude output. */
export interface BuildResult {
  rawOutputPath: string; // agents/{id}/builder/raw-output.jsonl
  /** CHORE-40: only set when goal mode was active. */
  goalStatus?: GoalStatus;
  /** CHORE-40: total cost in USD parsed from the result event, when goal mode active. */
  goalCostUsd?: number;
  /** CHORE-40: assistant-message count (proxy for goal turns), when goal mode active. */
  goalTurns?: number;
}

/** Injected subprocess helpers (shape matches run/runCapture in adw-build.ts). */
export interface BuilderDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
  runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string; liveLabel?: string }) => TaskEither<string, string>;
}

/**
 * Dependency guard: probe the claude binary via a real exec. NOT `command -v`
 * (which spawns a shell builtin and is unreliable as a bare exec). Returns
 * Right<undefined> when claude responds to --version, Left otherwise.
 */
export function ensureAvailable(deps: BuilderDeps, cwd: string): TaskEither<string, void> {
  return deps.run(CLAUDE, ["--version"], { cwd })
    .mapLeft(() =>
      `The \`claude\` CLI was not runnable. Install Claude Code and ensure \`claude\` is on PATH, then retry.`,
    )
    .map(() => undefined);
}

/**
 * Parse the skill's final result line from claude's stream-json output.
 * Treats the LAST line whose `type === "result"` as authoritative; any
 * malformed trailing lines after it are ignored (a defensive scan backward).
 * Returns Right<SkillResult> on a success result line, Left on failure / absence.
 *
 * Note: claude can exit 0 even when the skill itself reported failure, so we
 * inspect the result line rather than trusting the exit code alone. This
 * mirrors the guard agent.ts added for dispatch.
 */
interface SkillResult {
  ok: boolean; // subtype === "success" && is_error === false
  summary: string; // the `.result` text (what the skill says it did)
}

const MISSING_RESULT = Symbol("__missing__");
export type MissingResult = typeof MISSING_RESULT;

export function parseSkillResult(builderLog: string, stdout: string): SkillResult | null {
  const content = stdout || (() => {
    try { return readFileSync(builderLog, "utf8"); } catch { return ""; }
  })();
  const lines = content.split("\n").filter((l) => l.trim());
  // Scan backward for the last parseable result line; ignore malformed lines.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // malformed trailing line — skip
    }
    if (obj?.type !== "result") continue;
    return {
      ok: obj.subtype === "success" && obj.is_error === false,
      summary: typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result ?? ""),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// CHORE-40: /goal mode
// ---------------------------------------------------------------------------

/**
 * Build the claude -p prompt. Without a goal, the classic /implement invocation.
 * With a goal, wraps /implement inside a /goal directive that tells Claude to
 * keep working until the condition is met, emitting the exhaustion marker if
 * it can't (so the outer test/patch-review loop can take over).
 *
 * Exported so tests can verify prompt construction without spawning Claude.
 */
export function buildImplementPrompt(specPath: string, goalCondition?: string): string {
  // BUG-22: Claude hardcodes `cd <main-repo>` in Bash commands, ignoring the
  // spawn cwd (the worktree). The worktree directive below tells Claude to
  // work relative to its current directory and never cd to a hardcoded path.
  // This is prepended to BOTH the goal and non-goal prompts so all build
  // dispatches benefit.
  const worktreeDirective = [
    "IMPORTANT: You are running inside an adw worktree.",
    "Your current working directory IS the worktree root — do all file edits,",
    "git operations, and validation commands here. NEVER run",
    "`cd /Users/mekael/Documents/programming/typescript/tmax` or any other",
    "hardcoded path. If you need to reference the repo root, use `pwd` or",
    "relative paths from the current directory.",
    "",
  ].join("\n");

  if (!goalCondition) return `${worktreeDirective}\n/implement ${specPath}`;

  const condition = [
    worktreeDirective,
    `Run the /implement skill for this exact spec path: ${JSON.stringify(specPath)}.`,
    "",
    "Then continue working until this completion condition is satisfied:",
    goalCondition,
    "",
    `If the condition is still not satisfied after ${GOAL_TURN_LIMIT} goal turns, stop and include this exact marker on its own line: ${GOAL_EXHAUSTED_MARKER}.`,
    "After the marker, summarize the unfinished work so the outer adw test/patch-review loop can continue.",
  ].join("\n");

  return `/goal ${condition}`;
}

/** Compare two [major,minor,patch] tuples. <0 if a<b, 0 if equal, >0 if a>b. */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

/**
 * Parse the first semver from a `claude --version` output string. Returns null
 * if none found.
 */
export function parseClaudeVersion(output: string): number[] | null {
  const m = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

/** Substrings that indicate /goal is unavailable or misconfigured. */
const GOAL_UNAVAILABLE_SUBSTRINGS = [
  "Unknown command: /goal",
  "No command named goal",
  "/goal is not available",
  "hooks are disabled",
  "disableAllHooks",
  "managed hooks",
  "workspace trust",
  "not trusted",
  "trust this workspace",
];

/** Substrings that indicate a nonzero exit was goal exhaustion, not a hard error. */
const GOAL_EXHAUSTION_SUBSTRINGS = [
  "context window",
  "context length",
  "maximum context",
  "token limit",
  "maximum number of turns",
  "turn limit reached",
  "max_turns",
  "rate limit",
  "overloaded",
  "529",
];

/** Check whether a string matches any goal-unavailability substring. */
export function matchGoalUnavailable(text: string): string | null {
  const lower = text.toLowerCase();
  for (const sub of GOAL_UNAVAILABLE_SUBSTRINGS) {
    if (lower.includes(sub.toLowerCase())) return sub;
  }
  return null;
}

/** Check whether a nonzero-exit error string indicates goal exhaustion. */
export function matchGoalExhaustion(text: string): string | null {
  const lower = text.toLowerCase();
  for (const sub of GOAL_EXHAUSTION_SUBSTRINGS) {
    if (lower.includes(sub.toLowerCase())) return sub;
  }
  return null;
}

/**
 * Result of the stream-json `result` event, parsed for goal classification.
 */
interface GoalResultEvent {
  resultString: string;
  totalCostUsd?: number;
}

/**
 * Extract the final `result` event from stream-json stdout. Returns null if
 * no parseable result line is found. Used to check for the exhaustion marker
 * (which must ONLY be read from this event, never the whole log — the marker
 * text echoes in the prompt and reasoning, causing false positives).
 */
function parseResultEvent(stdout: string): GoalResultEvent | null {
  const lines = stdout.split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(lines[i]!) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj?.type !== "result") continue;
    return {
      resultString: typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result ?? ""),
      totalCostUsd: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : undefined,
    };
  }
  return null;
}

/** Count assistant messages in stream-json stdout (proxy for goal turns). */
function countAssistantTurns(stdout: string): number {
  let n = 0;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj?.type === "assistant") n++;
    } catch {
      // skip malformed
    }
  }
  return n;
}

/**
 * Classify a goal-mode build outcome. Called by build() after runCapture
 * returns. On success (Right stdout), inspect the result event. On nonzero
 * exit (Left err), match exhaustion substrings.
 */
function classifyGoalOutcome(
  runCaptureResult: Either<string, string>,
  goalCondition: string,
): { status: GoalStatus; costUsd?: number; turns?: number; reason?: string } {
  if (Either.isLeft(runCaptureResult)) {
    const err = runCaptureResult.left;
    // Check unavailability first (it's a hard error, not exhaustion).
    const unavail = matchGoalUnavailable(err);
    if (unavail) return { status: "goal-error", reason: `goal-unavailable: ${unavail}` };
    const exhaust = matchGoalExhaustion(err);
    if (exhaust) return { status: "goal-exhausted", reason: `exhausted: ${exhaust}` };
    return { status: "goal-error", reason: err.slice(0, 300) };
  }
  const stdout = runCaptureResult.right;
  const result = parseResultEvent(stdout);
  if (result === null) {
    // No parseable result — ambiguous, prefer exhausted per the spec rule.
    return { status: "goal-exhausted", reason: "no parseable result event" };
  }
  const turns = countAssistantTurns(stdout);
  const marker = result.resultString.includes(GOAL_EXHAUSTED_MARKER);
  if (marker) {
    return {
      status: "goal-exhausted",
      costUsd: result.totalCostUsd,
      turns,
      reason: `${GOAL_EXHAUSTED_MARKER} present in result event`,
    };
  }
  return { status: "goal-met", costUsd: result.totalCostUsd, turns };
}

/**
 * Build = run `claude -p /implement` against the spec. Owns initializing the
 * raw-output log (clean file per run, matching agent.ts/reviewer.ts — not
 * appending to a stale file) and interpreting the stream-json result line.
 *
 * Returns TaskEither<string, BuildResult> on success (Right = the skill ran and
 * reported success), Left<string> on subprocess or skill-reported failure. No
 * run-state side effects — the caller logs.
 *
 * D4 (CHORE-30): unlike agent.ts's dispatch(), build() does NOT diff docs/specs/
 * to detect an "appeared" file — the builder's success signal is the skill's
 * result line, since /implement edits code across the repo rather than creating
 * a single new spec file.
 */
export function build(
  deps: BuilderDeps,
  cwd: string,
  specPath: string,
  builderLog: string, // full path: agents/{id}/builder/raw-output.jsonl
  model: string = BUILD_MODEL,
  liveLabel?: string,
  goalCondition?: string,
): TaskEither<string, BuildResult> {
  // CHORE-40: version guard — /goal requires Claude Code v2.1.139+. Probed
  // only when goal mode is active. Unparseable version warns but continues.
  const versionGuard: TaskEither<string, void> = goalCondition
    ? deps.run(CLAUDE, ["--version"], { cwd })
        .mapLeft(() =>
          `goal mode: could not run \`claude --version\` to verify /goal support`,
        )
        .flatMap((versionOut): TaskEither<string, void> => {
          const parsed = parseClaudeVersion(versionOut);
          if (parsed === null) {
            process.stderr.write(
              "adw-build: warning: could not parse claude --version output for /goal support\n",
            );
            return TaskEither.right<void, string>(undefined);
          }
          if (compareVersions(parsed, GOAL_MIN_VERSION) < 0) {
            return TaskEither.left<string, void>(
              `goal mode: claude ${parsed.join(".")} is older than ${GOAL_MIN_VERSION.join(".")} — /goal is unavailable. Upgrade Claude Code or drop the goal.`,
            );
          }
          return TaskEither.right<void, string>(undefined);
        })
    : TaskEither.right<void, string>(undefined);

  // Construct the prompt (goal-aware). Exported helper for testability.
  const prompt = buildImplementPrompt(specPath, goalCondition);

  // Initialize the raw-output log: ensure dir, truncate file. A failure here is
  // a build failure (can't capture output), surfaced via TaskEither.left.
  const init = TaskEither.tryCatch(
    async () => {
      mkdirSync(dirname(builderLog), { recursive: true });
      writeFileSync(builderLog, "");
    },
    (e) => `build: failed to initialize raw-output log: ${(e as Error).message}`,
  );

  return versionGuard.flatMap(() => init.flatMap(() =>
    deps.runCapture(
      CLAUDE,
      // stream-json requires --verbose under --print; verbose logs go to stderr,
      // the streamed JSON events are what we tee to builderLog on stdout.
      // --dangerously-skip-permissions is needed because builds run inside sibling
      // worktrees (tmax.<id>/) which lack the main repo's .claude/settings.json.
      ["-p", "--model", model, "--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json", prompt],
      { cwd, teeTo: builderLog, ...(liveLabel ? { liveLabel } : {}) },
    ).flatMap((stdout) => {
      const skill = parseSkillResult(builderLog, stdout);
      if (skill === null) {
        return TaskEither.left("build: skill produced no parseable result line in the builder log");
      }
      if (!skill.ok) {
        return TaskEither.left(`build: skill reported failure: ${skill.summary.slice(0, 300)}`);
      }
      const result: BuildResult = { rawOutputPath: builderLog };
      // CHORE-40: classify goal outcome when goal mode was active. Note this
      // branch is reached only on skill success (exit 0 + success result line);
      // nonzero-exit exhaustion is handled in the mapLeft below.
      if (goalCondition) {
        const goal = classifyGoalOutcome(Either.right(stdout), goalCondition);
        result.goalStatus = goal.status;
        if (goal.costUsd !== undefined) result.goalCostUsd = goal.costUsd;
        if (goal.turns !== undefined) result.goalTurns = goal.turns;
      }
      return TaskEither.right(result);
    }).mapLeft((err): string => {
      // CHORE-40: on nonzero exit with goal mode, classify for goal-exhausted
      // vs goal-error so the orchestrator can react. We can't return a Right
      // (the build genuinely failed), but we surface the goal status in the
      // error message via a typed prefix the caller can parse.
      if (goalCondition) {
        const goal = classifyGoalOutcome(Either.left(err), goalCondition);
        return `build: goal ${goal.status}${goal.reason ? `: ${goal.reason}` : ""} (underlying: ${err})`;
      }
      return err;
    }),
  ));
}
