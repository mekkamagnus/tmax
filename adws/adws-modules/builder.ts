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
import { TaskEither } from "../../src/utils/task-either.ts";

const CLAUDE = "claude";

// Default implement model. Override per-run with `adw-build.ts --model <id>`.
export const BUILD_MODEL = "glm-5.2[1m]";

/** Result of a successful build: the path to the streamed claude output. */
export interface BuildResult {
  rawOutputPath: string; // agents/{id}/builder/raw-output.jsonl
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
): TaskEither<string, BuildResult> {
  // Initialize the raw-output log: ensure dir, truncate file. A failure here is
  // a build failure (can't capture output), surfaced via TaskEither.left.
  const init = TaskEither.tryCatch(
    async () => {
      mkdirSync(dirname(builderLog), { recursive: true });
      writeFileSync(builderLog, "");
    },
    (e) => `build: failed to initialize raw-output log: ${(e as Error).message}`,
  );

  return init.flatMap(() =>
    deps.runCapture(
      CLAUDE,
      // stream-json requires --verbose under --print; verbose logs go to stderr,
      // the streamed JSON events are what we tee to builderLog on stdout.
      // --dangerously-skip-permissions is needed because builds run inside sibling
      // worktrees (tmax.<id>/) which lack the main repo's .claude/settings.json.
      ["-p", "--model", model, "--dangerously-skip-permissions", "--verbose", "--output-format", "stream-json", `/implement ${specPath}`],
      { cwd, teeTo: builderLog, ...(liveLabel ? { liveLabel } : {}) },
    ).flatMap((stdout) => {
      const skill = parseSkillResult(builderLog, stdout);
      if (skill === null) {
        return TaskEither.left("build: skill produced no parseable result line in the builder log");
      }
      if (!skill.ok) {
        return TaskEither.left(`build: skill reported failure: ${skill.summary.slice(0, 300)}`);
      }
      return TaskEither.right({ rawOutputPath: builderLog });
    }),
  );
}
