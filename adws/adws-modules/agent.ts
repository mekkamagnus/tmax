/**
 * agent.ts — the LLM interface for the adw dispatcher.
 *
 * Owns the two `claude -p` calls (classify + dispatch) and their direct
 * helpers. No CLI, no argv, no run-state tracking — those live in the caller.
 *
 * Subprocess execution is injected (the `run`/`runCapture` callbacks) so this
 * module has no direct dependency on child_process and is unit-testable with
 * a mock.
 */
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import { readdirSync, statSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";

export type PlanType = "feature" | "bug" | "chore";
export const SKILL_BY_TYPE: Record<PlanType, string> = { feature: "feature", bug: "bug", chore: "chore" };

/** Result of a successful classify: the chosen type plus the model's short reason. */
export interface ClassifyResult {
  type: PlanType;
  reason: string;
}

const CLAUDE = "claude";
// Intended target model: the higher-capability sonnet-tier model on this gateway.
// Explicitly pinned (not left to default resolution) because z.ai's default-model
// discovery can hang silently. NOTE: as of the troubleshooting session on
// 2026-06-17, `glm-5.2[1m]` itself hangs on api.z.ai (returns nothing, never
// exits) while `glm-4.7` and `glm-4.5-air` work. This is the *intended* end-state
// model; until the gateway/model is healthy, live invocations of `claude` will
// stall. See the "Model availability risk" note in CHORE-26-adw-agent-module.md.
const CLAUDE_MODEL = "glm-5.2[1m]";

/** Injected subprocess helpers (shape matches the run/runCapture in adw-plan.ts). */
export interface AgentDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
  runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string }) => TaskEither<string, string>;
}

// ---------------------------------------------------------------------------
// classify()
// ---------------------------------------------------------------------------

function classifyPrompt(desc: string): string {
  return `Classify this software task description into exactly ONE of three categories.

Categories:
- bug: broken behavior, fix, error, crash, defect, unexpected, "not working", regression.
- feature: new functionality, add a capability, build, implement, extend, enhancement.
- chore: cleanup, refactor, maintenance, dependency update, reorganize, rename, migrate, config change (not a bug fix and not new user-facing functionality).

Description:
"""
${desc}
"""

Respond with ONLY a single JSON object on one line, no prose, no markdown fence:
{"type": "feature" | "bug" | "chore", "reason": "<one short clause>"}`;
}

function isPlanType(s: unknown): s is PlanType {
  return s === "feature" || s === "bug" || s === "chore";
}

function pickType(o: unknown): { type: PlanType; reason: string } | null {
  if (o && typeof o === "object" && isPlanType((o as Record<string, unknown>).type)) {
    return { type: (o as Record<string, unknown>).type as PlanType, reason: String((o as Record<string, unknown>).reason ?? "") };
  }
  return null;
}

/** Search the claude JSON envelope for an embedded {"type":...} object in any string field. */
function pickTypeFromEnvelope(o: unknown): { type: PlanType; reason: string } | null {
  if (!o || typeof o !== "object") return null;
  const stack: unknown[] = [o];
  while (stack.length) {
    const cur = stack.pop();
    const hit = pickType(cur);
    if (hit) return hit;
    if (cur && typeof cur === "object") {
      for (const v of Object.values(cur as Record<string, unknown>)) {
        if (typeof v === "string") {
          // the model's JSON may be a stringified object inside a text field
          const trimmed = v.trim();
          if (trimmed.startsWith("{") && trimmed.includes('"type"')) {
            const inner = Either.tryCatch(() => JSON.parse(trimmed) as unknown);
            if (Either.isRight(inner)) {
              const hit = pickType(inner.right);
              if (hit) return hit;
            }
          }
        } else if (v && typeof v === "object") {
          stack.push(v);
        }
      }
    }
  }
  return null;
}

/**
 * Classify a free-text description into feature | bug | chore via `claude -p`.
 * Returns TaskEither<string, ClassifyResult> (type + the model's short reason) on
 * success, Left<string> on failure. No run-state side effects — the caller logs.
 */
export function classify(
  deps: AgentDeps,
  cwd: string,
  desc: string,
): TaskEither<string, ClassifyResult> {
  return deps.run(CLAUDE, ["-p", "--model", CLAUDE_MODEL, "--output-format", "json", classifyPrompt(desc)], { cwd })
    .flatMap((raw) => {
      const parsed = Either.tryCatch(() => JSON.parse(raw) as unknown);
      if (Either.isLeft(parsed)) {
        return TaskEither.left(`classify: claude returned non-JSON: ${raw.slice(0, 500)}`);
      }
      const candidate = pickType(parsed.right) ?? pickTypeFromEnvelope(parsed.right);
      if (!candidate) {
        return TaskEither.left(`classify: no valid type in response: ${JSON.stringify(parsed.right).slice(0, 500)}`);
      }
      return TaskEither.right(candidate);
    });
}

// ---------------------------------------------------------------------------
// dispatch() (+ specs-dir snapshot/diff + skill-result parsing)
// ---------------------------------------------------------------------------

/** Outcome of a successful dispatch — what the skill did to docs/specs/. */
export type DispatchOutcome =
  | { _tag: "created"; kind: "created"; path: string }   // a new {SPEC,BUG,CHORE}-*.md appeared
  | { _tag: "modified"; kind: "modified"; path: string }  // an existing spec file was edited
  | { _tag: "noop"; kind: "noop"; summary: string };      // skill succeeded but wrote nothing

/**
 * Result of a `claude --output-format stream-json` run: the skill's own
 * self-reported outcome, parsed from the final `{"type":"result",...}` line.
 */
interface SkillResult {
  ok: boolean;        // subtype === "success" && is_error === false
  summary: string;    // the `.result` text (what the skill says it did)
}

/** Snapshot specs dir: filename → mtimeMs. Used to detect NEW and MODIFIED files. */
function snapshotSpecsDir(specsDir: string): Map<string, number> {
  const out = new Map<string, number>();
  const entries = Either.tryCatch(() => readdirSync(specsDir).filter((f) => /^(SPEC|BUG|CHORE)-/.test(f)));
  if (Either.isLeft(entries)) return out;
  for (const f of entries.right) {
    const stat = Either.tryCatch(() => statSync(join(specsDir, f)).mtimeMs);
    if (Either.isRight(stat)) out.set(f, stat.right);
  }
  return out;
}

function diffSpecsDir(before: Map<string, number>, specsDir: string): { created: string | null; modified: string | null } {
  const after = snapshotSpecsDir(specsDir);
  let created: string | null = null;
  let modified: string | null = null;
  for (const [f, mtime] of after) {
    if (!before.has(f)) created = created ?? join(specsDir, f);
    else if (mtime > before.get(f)!) modified = modified ?? join(specsDir, f);
  }
  return { created, modified };
}

/** Sentinel for "parsed but no valid result line found." */
const MISSING_RESULT = Symbol("__missing__");

/** Parse the skill's final result line from the teed planner log. */
function parseSkillResult(plannerLog: string): Either<string, SkillResult> {
  const raw = Either.tryCatch(() => {
    const content = readFileSync(plannerLog, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    const last = lines[lines.length - 1];
    if (!last) return MISSING_RESULT;
    const obj = JSON.parse(last) as Record<string, unknown>;
    if (obj?.type !== "result") return MISSING_RESULT;
    return {
      ok: obj.subtype === "success" && obj.is_error === false,
      summary: typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result ?? ""),
    } as SkillResult | typeof MISSING_RESULT;
  });

  if (Either.isLeft(raw)) {
    return Either.left(`failed to read planner log: ${(raw.left as Error).message}`);
  }
  if (raw.right === MISSING_RESULT) {
    return Either.left("skill produced no parseable result line in the planner log");
  }
  return Either.right(raw.right);
}

/**
 * Dispatch to the matching skill (/feature, /bug, /chore) via `claude -p`,
 * teeing the planner's streamed output to `plannerLog`.
 *
 * Success is determined by the skill's self-reported outcome (its final
 * stream-json `result` line: `subtype:"success" && is_error:false`), NOT by
 * whether a new file appeared — a skill may legitimately succeed by editing an
 * existing spec or by deciding none is needed. The outcome's `kind` records
 * what (if anything) changed in docs/specs/.
 *
 * Returns TaskEither<string, DispatchOutcome> on success, Left<string> on
 * subprocess or skill failure. No run-state side effects — the caller logs.
 */
export function dispatch(
  deps: AgentDeps,
  cwd: string,
  specsDir: string,
  plannerLog: string,
  type: PlanType,
  desc: string,
): TaskEither<string, DispatchOutcome> {
  const skill = SKILL_BY_TYPE[type];
  const before = snapshotSpecsDir(specsDir);

  // Ensure the planner log's dir exists and start it fresh.
  mkdirSync(dirname(plannerLog), { recursive: true });
  Either.tryCatch(() => writeFileSync(plannerLog, ""));

  return deps.runCapture(
    CLAUDE,
    // stream-json requires --verbose under --print; verbose logs go to stderr,
    // the streamed JSON events are what we tee to plannerLog on stdout.
    ["-p", "--model", CLAUDE_MODEL, "--verbose", "--output-format", "stream-json", `/${skill} ${desc}`],
    { cwd, teeTo: plannerLog },
  ).flatMap(() => {
    // Skill ran; inspect its self-reported outcome.
    const skillRes = parseSkillResult(plannerLog);
    if (Either.isLeft(skillRes)) return TaskEither.left(skillRes.left);
    if (!skillRes.right.ok) {
      return TaskEither.left(`skill reported failure: ${skillRes.right.summary.slice(0, 300)}`);
    }

    // Success — classify what (if anything) changed in docs/specs/.
    const { created, modified } = diffSpecsDir(before, specsDir);
    if (created) return TaskEither.right({ _tag: "created", kind: "created", path: created });
    if (modified) return TaskEither.right({ _tag: "modified", kind: "modified", path: modified });
    return TaskEither.right({ _tag: "noop", kind: "noop", summary: skillRes.right.summary });
  });
}
