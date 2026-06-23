/**
 * reviewer.ts — the codex interface for the adw spec-reviewer.
 *
 * Owns the two `codex exec` calls (review read-only + upgrade workspace-write)
 * and their direct helpers. No CLI, no argv, no run-state tracking — those
 * live in the caller.
 *
 * Subprocess execution is injected (the `run`/`runCapture` callbacks) so this
 * module has no direct dependency on child_process and is unit-testable with
 * a mock. Mirrors the AgentDeps pattern in ./agent.ts.
 */
import { TaskEither } from "../../src/utils/task-either.ts";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export type ReviewVerdict = "pass" | "fail";

/** Structured verdict from Pass 1 (validated by codex's --output-schema). */
export interface ReviewVerdictPayload {
  verdict: ReviewVerdict;
  summary: string;
  issues: string[];
}

/** Injected subprocess helpers (shape matches run/runCapture in adw-spec-review.ts). */
export interface CodexDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => TaskEither<string, string>;
  runCapture: (cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; teeTo: string }) => TaskEither<string, string>;
}

/**
 * Environment for codex subprocess calls. codex authenticates via stored
 * ChatGPT OAuth tokens; a set-but-invalid OPENAI_API_KEY env var causes codex
 * to try API-key auth and hang (HTTP 401 in a retry loop). Strip it so codex
 * uses its token store cleanly. Caller passes this as the `env` option.
 */
export function codexEnv(): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "OPENAI_API_KEY") e[k] = v;
  }
  return e;
}

// Intended target model: the latest codex model (per OpenAI's codex docs, 2026-06).
// Pinned via --model so the script never depends on codex's default resolution.
export const CODEX_MODEL = "gpt-5.5";

/**
 * Resolve the codex binary path. Scans candidate install locations (every nvm
 * node version dir, newest version first), then falls back to bare "codex"
 * (resolved by PATH at exec time). The caller's ensureCodex() guard validates
 * that the resolved path actually runs.
 *
 * Why scan instead of pinning one path: codex is installed per-nvm-version, so
 * a single hardcoded path silently breaks on `nvm uninstall`/upgrade. Scanning
 * the version dirs makes resolution robust to version churn.
 */
export function resolveCodex(): string {
  const nvmNodeDir = "/Users/mekael/.nvm/versions/node";
  const candidates: string[] = [];
  if (existsSync(nvmNodeDir)) {
    let versions: string[] = [];
    try {
      versions = readdirSync(nvmNodeDir).filter((d) => /^v?\d/.test(d));
    } catch { /* unreadable nvm dir — fall through to PATH */ }
    // Sort descending by the numeric value of the version so the newest
    // available codex wins. "v24.13.1" → [24,13,1].
    const byVersion = (v: string): number[] =>
      v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
    versions.sort((a, b) => {
      const va = byVersion(a), vb = byVersion(b);
      for (let i = 0; i < Math.max(va.length, vb.length); i++) {
        const d = (vb[i] ?? 0) - (va[i] ?? 0);
        if (d !== 0) return d;
      }
      return 0;
    });
    for (const v of versions) candidates.push(join(nvmNodeDir, v, "bin", "codex"));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "codex";
}

/** The resolved codex path (computed once at module load). */
export const CODEX = resolveCodex();

// ---------------------------------------------------------------------------
// reviewSpec() — Pass 1 (read-only, structured verdict)
// ---------------------------------------------------------------------------

/** JSON Schema codex validates its final message against (--output-schema).
 *  NOTE: OpenAI's --output-schema is stricter than standard JSON Schema —
 *  `required` MUST list every key in `properties` (no optional fields allowed),
 *  else the API rejects with invalid_json_schema. So `issues` is required even
 *  though it's empty for a "pass" verdict. */
const REVIEW_SCHEMA = {
  type: "object",
  required: ["verdict", "summary", "issues"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    summary: { type: "string", description: "one-paragraph rationale" },
    issues: {
      type: "array",
      items: { type: "string" },
      description: "specific problems if verdict is fail; empty if pass",
    },
  },
};

function reviewPrompt(specPath: string, specContent: string): string {
  return `You are reviewing an implementation spec for the tmax terminal editor. Evaluate it against this rubric:

- Completeness: does it cover the described feature/bug/chore end-to-end?
- Implementability: could a developer execute it without ambiguity?
- File references: do the cited files/dirs exist or are they clearly marked as new?
- Validation: are there concrete, runnable validation commands?
- Correctness: are there technical errors, contradictions, or missing edge cases?

Spec path: ${specPath}

Spec content:
"""
${specContent}
"""

Respond with a JSON object matching the schema: {"verdict":"pass"|"fail", "summary":"...", "issues":["...", ...]}. If the spec is good, verdict is "pass" and issues is empty. If it has problems, verdict is "fail" and each issue is a specific, actionable string.`;
}

/**
 * Pass 1: review a spec read-only via codex, forcing a structured verdict.
 * Writes codex's JSONL stream to `reviewerLog` and its validated final message
 * to `verdictFile`. Returns Right<ReviewVerdictPayload> on success, Left<string>
 * on failure. No run-state side effects.
 */
export function reviewSpec(
  deps: CodexDeps,
  cwd: string,
  specPath: string,
  reviewerLog: string,
  verdictFile: string,
): TaskEither<string, ReviewVerdictPayload> {
  const codex = CODEX;

  // Write the schema + init the log file (best-effort I/O — non-critical setup).
  mkdirSync(dirname(verdictFile), { recursive: true });
  try { writeFileSync(reviewerLog, ""); } catch { /* ignore */ }
  const schemaPath = verdictFile + ".schema.json";
  writeFileSync(schemaPath, JSON.stringify(REVIEW_SCHEMA));

  // Read spec content.
  const specContentE = TaskEither.tryCatch(
    async () => readFileSync(specPath, "utf8"),
    (e) => `review: failed to read spec ${specPath}: ${(e as Error).message}`,
  );

  return specContentE.flatMap((specContent) => {
    // codex reads the prompt from the arg, NOT stdin.
    // -c model_reasoning_effort=medium: review needs read+judge, not deep multi-step
    // reasoning; medium cuts wall-time from ~6min to ~2min for large specs.
    const prompt = reviewPrompt(specPath, specContent);
    return deps.runCapture(
      codex,
      [
        "exec",
        "--sandbox", "read-only",
        "--model", CODEX_MODEL,
        "-c", "model_reasoning_effort=medium",
        "--json",
        "--output-schema", schemaPath,
        "-o", verdictFile,
        prompt,
      ],
      { cwd, env: codexEnv(), teeTo: reviewerLog },
    ).flatMap(() => {
      // codex wrote its validated final message to verdictFile (-o). Parse it.
      return TaskEither.tryCatch(
        async () => readFileSync(verdictFile, "utf8"),
        (e) => `review: codex did not write verdict file ${verdictFile}: ${(e as Error).message}`,
      ).flatMap((raw) => parseVerdict(raw));
    });
  });
}

/** Parse the verdict JSON from codex output into a ReviewVerdictPayload. */
function parseVerdict(raw: string): TaskEither<string, ReviewVerdictPayload> {
  return TaskEither.tryCatch(async () => {
    const parsed = JSON.parse(raw) as unknown;
    const obj = parsed as Record<string, unknown>;
    if (obj.verdict !== "pass" && obj.verdict !== "fail") {
      throw new Error(`review: verdict field missing or invalid: ${raw.slice(0, 300)}`);
    }
    const issues = Array.isArray(obj.issues)
      ? obj.issues.filter((i: unknown): i is string => typeof i === "string")
      : [];
    return {
      verdict: obj.verdict as ReviewVerdict,
      summary: typeof obj.summary === "string" ? obj.summary : "",
      issues,
    };
  }, (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("review: verdict field")) return msg;
    return `review: verdict file is not valid JSON: ${raw.slice(0, 300)}`;
  });
}

// ---------------------------------------------------------------------------
// upgradeSpec() — Pass 2 (workspace-write, conditional)
// ---------------------------------------------------------------------------

function upgradePrompt(specPath: string, verdict: ReviewVerdictPayload): string {
  const issueList = verdict.issues.length > 0
    ? verdict.issues.map((i, n) => `${n + 1}. ${i}`).join("\n")
    : "(no specific issues listed)";
  return `You are upgrading an implementation spec for the tmax terminal editor. The spec at ${specPath} was reviewed and found to have these issues:

${issueList}

Reviewer summary: ${verdict.summary}

Apply the fixes directly to the spec file at ${specPath}. Make ONLY the changes needed to address the issues — do not rewrite the spec wholesale, do not change its Feature/Bug/Chore template structure, and preserve all correct sections. Edit the file in place.`;
}

/**
 * Pass 2: apply the review's identified fixes to the spec in place via codex
 * (workspace-write). Returns Right<{changed, summary}> — `changed` is true if
 * the spec file's mtime advanced. Called only when Pass 1 verdict is "fail".
 * No run-state side effects.
 */
export function upgradeSpec(
  deps: CodexDeps,
  cwd: string,
  specPath: string,
  verdict: ReviewVerdictPayload,
  upgraderLog: string,
): TaskEither<string, { changed: boolean; summary: string }> {
  const codex = CODEX;

  // Init the log file (best-effort I/O — non-critical setup).
  mkdirSync(dirname(upgraderLog), { recursive: true });
  try { writeFileSync(upgraderLog, ""); } catch { /* ignore */ }

  // Get mtime before.
  const mtimeBeforeE = TaskEither.tryCatch(
    async () => statSync(specPath).mtimeMs,
    (e) => `upgrade: cannot stat spec ${specPath}: ${(e as Error).message}`,
  );

  return mtimeBeforeE.flatMap((mtimeBefore) => {
    // -c model_reasoning_effort=medium: upgrade applies listed fixes, not open-
    // ended discovery; medium is sufficient and far faster than xhigh.
    const prompt = upgradePrompt(specPath, verdict);
    return deps.runCapture(
      codex,
      [
        "exec",
        "--sandbox", "workspace-write",
        "--model", CODEX_MODEL,
        "-c", "model_reasoning_effort=medium",
        "--json",
        prompt,
      ],
      { cwd, env: codexEnv(), teeTo: upgraderLog },
    ).flatMap(() => {
      return TaskEither.tryCatch(
        async () => statSync(specPath).mtimeMs,
        (e) => `upgrade: cannot stat spec after run ${specPath}: ${(e as Error).message}`,
      ).map((mtimeAfter) => ({ changed: mtimeAfter > mtimeBefore, summary: "" }));
    });
  });
}
