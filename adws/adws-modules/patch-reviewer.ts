/**
 * patch-reviewer.ts — the LLM interface for the adw patch-review dispatcher.
 *
 * Owns the dependency guard (ensureAvailable), context gathering (gatherContext),
 * gate running (runGates), the audit prompt construction, and the single
 * `claude -p` audit call. No CLI, no argv, no run-state tracking — those live
 * in the caller (adw-patch-review.ts).
 *
 * Subprocess execution is injected (PatchReviewerDeps) so this module has no
 * direct dependency on child_process and is unit-testable with a mock. Mirrors
 * the BuilderDeps / CodexDeps convention from builder.ts / reviewer.ts.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { TaskEither, Either } from "../../src/utils/task-either.ts";

const CLAUDE = "claude";

// Default audit model. Override per-run with `adw-patch-review.ts --model <id>`.
export const PATCH_REVIEW_MODEL = "glm-5.2[1m]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Injected subprocess helpers. `run` = zero/non-zero exit. `runRaw` = exit-code
 * visibility. `runCapture` = streaming capture with tee. */
export interface PatchReviewerDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, string>;
  runRaw: (cmd: string, args: string[], opts?: { cwd?: string }) => TaskEither<string, RawRunResult>;
  runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string }) => TaskEither<string, string>;
}

/** Result of a subprocess that completed (even with non-zero exit). Left = spawn/setup failure. */
export interface RawRunResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Result of a single gate command. */
export interface GateResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

/** Gathered context: spec content, diff, untracked files, and optional git warning. */
export interface GatherBundle {
  specContent: string;
  diff: string;
  untrackedDiff: string;
  filesChanged: string[];
  diffBase?: string;
  gitWarning?: string;
}

export interface GatherContextOptions {
  /** Set when the caller resolved the workspace state's worktree_path. */
  worktreePath?: string;
  /** Orchestrator event log for legacy workspaces whose state lacks base_sha. */
  orchestratorEventsFile?: string;
}

/** Gate results for typecheck and unit tests. */
export interface GateResults {
  typecheck: GateResult;
  unit: GateResult;
  /**
   * Optional tmax-use gate. Populated when `tmax-use/playbooks/` or
   * `tmax-use/tests/` has any files; otherwise undefined (gate skipped).
   * Allows the build-agent to verify visual/state behavior via the tmax-use
   * runner without forcing projects that don't use tmax-use to install it.
   */
  tmaxUse?: GateResult;
}

/** Validated audit verdict from the sub-agent. */
export type AuditVerdictKind = "pass" | "gaps";

export interface CriterionAssessment {
  criterion: string;
  status: "implemented" | "missing" | "partial";
  evidence: string;
}

export interface TestAssessment {
  behavior: string;
  status: "covered" | "uncovered";
  evidence: string;
}

export interface EdgeCaseAssessment {
  case: string;
  status: "handled" | "missed";
  evidence: string;
}

export interface AuditVerdict {
  verdict: AuditVerdictKind;
  summary: string;
  criteria: CriterionAssessment[];
  tests: TestAssessment[];
  edge_cases: EdgeCaseAssessment[];
}

// ---------------------------------------------------------------------------
// JSON Schema for forced verdict via --json-schema
// ---------------------------------------------------------------------------

export const AUDIT_SCHEMA = {
  type: "object",
  required: ["verdict", "summary", "criteria", "tests", "edge_cases"],
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "gaps"] },
    summary: { type: "string", description: "one-paragraph rationale for the verdict" },
    criteria: {
      type: "array",
      items: {
        type: "object",
        required: ["criterion", "status", "evidence"],
        additionalProperties: false,
        properties: {
          criterion: { type: "string" },
          status: { type: "string", enum: ["implemented", "missing", "partial"] },
          evidence: { type: "string", description: "file:line citations" },
        },
      },
    },
    tests: {
      type: "array",
      items: {
        type: "object",
        required: ["behavior", "status", "evidence"],
        additionalProperties: false,
        properties: {
          behavior: { type: "string" },
          status: { type: "string", enum: ["covered", "uncovered"] },
          evidence: { type: "string" },
        },
      },
    },
    edge_cases: {
      type: "array",
      items: {
        type: "object",
        required: ["case", "status", "evidence"],
        additionalProperties: false,
        properties: {
          case: { type: "string" },
          status: { type: "string", enum: ["handled", "missed"] },
          evidence: { type: "string" },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// ensureAvailable — dependency guard
// ---------------------------------------------------------------------------

export function ensureAvailable(deps: PatchReviewerDeps, cwd: string): TaskEither<string, void> {
  return deps.run(CLAUDE, ["--version"], { cwd })
    .mapLeft(() =>
      `The \`claude\` CLI was not runnable. Install Claude Code and ensure \`claude\` is on PATH, then retry.`,
    )
    .map(() => undefined);
}

// ---------------------------------------------------------------------------
// gatherContext — collect spec, diff, untracked files
// ---------------------------------------------------------------------------

const GIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

function cleanGitSha(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const sha = value.trim();
  return GIT_SHA_RE.test(sha) ? sha : undefined;
}

function recoverDiffBaseFromEvents(eventsFile: string | undefined): string | undefined {
  if (!eventsFile) return undefined;
  try {
    const lines = readFileSync(eventsFile, "utf8").split("\n").filter((line) => line.trim());
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.event === "base-sha-recorded") {
          const base = cleanGitSha(event.base_sha);
          if (base) return base;
        }
        if (event.event === "worktree-created") {
          const base = cleanGitSha(event.from_sha);
          if (base) return base;
        }
      } catch {
        // Ignore malformed event lines; later well-formed lines may still help.
      }
    }
  } catch {
    // Missing event logs are expected for standalone patch-review runs.
  }
  return undefined;
}

export function gatherContext(
  deps: PatchReviewerDeps,
  cwd: string,
  specPath: string,
  diffBase?: string,
  opts: GatherContextOptions = {},
): TaskEither<string, GatherBundle> {
  // Read the spec file (sync read inside tryCatch).
  const specContentTE = TaskEither.tryCatch(
    async () => readFileSync(specPath, "utf8"),
    (e) => `gather: failed to read spec ${specPath}: ${(e as Error).message}`,
  );

  return specContentTE.flatMap((specContent) => {
    // Run git diff and git ls-files in parallel via TaskEither.parallel-like manual compose.
    // We need: git diff, git diff --name-only, git ls-files --others --exclude-standard -z
    return TaskEither.from(async () => {
      const inWorktree = Boolean(process.env.ADW_WORKTREE || opts.worktreePath);
      let resolvedDiffBase = diffBase;
      let gitWarning = inWorktree || diffBase
        ? undefined
        : "no build base_sha; diff may include pre-existing dirty changes";
      const addWarning = (message: string): void => {
        gitWarning = `${gitWarning ? `${gitWarning}; ` : ""}${message}`;
      };

      if (inWorktree && !resolvedDiffBase) {
        const eventBase = recoverDiffBaseFromEvents(opts.orchestratorEventsFile);
        if (eventBase) {
          resolvedDiffBase = eventBase;
          addWarning("no build base_sha; using recorded worktree creation base");
        } else {
          const reflogRes = await deps.runRaw("git", ["reflog", "--format=%H", "--reverse", "HEAD"], { cwd }).run();
          if (Either.isLeft(reflogRes)) {
            return Either.left(`gather: git reflog failed to spawn: ${reflogRes.left}`);
          }
          if (reflogRes.right.ok) {
            const reflogBase = reflogRes.right.stdout
              .split("\n")
              .map((line) => cleanGitSha(line))
              .find((sha): sha is string => Boolean(sha));
            if (reflogBase) {
              resolvedDiffBase = reflogBase;
              addWarning("no recorded base_sha; using earliest worktree HEAD reflog entry");
            } else {
              addWarning("git reflog HEAD produced no usable base");
            }
          } else {
            addWarning(`git reflog HEAD exited ${reflogRes.right.exitCode}`);
          }
        }
      }

      let diffArgs: string[];
      let nameArgs: string[];
      if (inWorktree && resolvedDiffBase) {
        const range = `${resolvedDiffBase}..HEAD`;
        diffArgs = ["diff", range, "--no-color"];
        nameArgs = ["diff", "--name-only", range];
      } else {
        const base = resolvedDiffBase ?? "HEAD";
        if (inWorktree && !resolvedDiffBase) {
          addWarning("no worktree diff base; falling back to git diff HEAD");
        }
        diffArgs = ["diff", base, "--no-color"];
        nameArgs = ["diff", "--name-only", base];
      }

      // Gather tracked diff
      const diffRes = await deps.runRaw("git", diffArgs, { cwd }).run();
      if (Either.isLeft(diffRes)) {
        return Either.left(`gather: git diff failed to spawn: ${diffRes.left}`);
      }
      const diffResult = diffRes.right;
      let diff = diffResult.stdout;
      if (!diffResult.ok) {
        diff = "";
        addWarning(`git diff exited ${diffResult.exitCode}`);
      }

      // Gather changed file names
      const namesRes = await deps.runRaw("git", nameArgs, { cwd }).run();
      let filesChanged: string[] = [];
      if (Either.isRight(namesRes) && namesRes.right.ok) {
        filesChanged = namesRes.right.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
      } else if (Either.isLeft(namesRes)) {
        return Either.left(`gather: git diff --name-only failed to spawn: ${namesRes.left}`);
      } else {
        addWarning(`git diff --name-only exited ${namesRes.right.exitCode}`);
      }

      // Gather untracked files
      const untrackedRes = await deps.runRaw("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd }).run();
      let untrackedDiff = "";
      if (Either.isRight(untrackedRes) && untrackedRes.right.ok) {
        const untrackedFiles = untrackedRes.right.stdout.split("\0").map((s) => s.trim()).filter((s) => s.length > 0);
        untrackedDiff = buildUntrackedDiff(cwd, untrackedFiles);
        // Add untracked files to the filesChanged list
        for (const f of untrackedFiles) {
          if (!filesChanged.includes(f)) filesChanged.push(f);
        }
      } else if (Either.isLeft(untrackedRes)) {
        return Either.left(`gather: git ls-files failed to spawn: ${untrackedRes.left}`);
      }

      return Either.right<GatherBundle, string>({
        specContent,
        diff,
        untrackedDiff,
        filesChanged,
        diffBase: resolvedDiffBase,
        gitWarning,
      });
    });
  });
}

/** Build a synthetic new-file diff for untracked files. */
function buildUntrackedDiff(cwd: string, files: string[]): string {
  const parts: string[] = [];
  for (const f of files) {
    const fullPath = join(cwd, f);
    try {
      const content = readFileSync(fullPath, "utf8");
      const lines = content.split("\n");
      // Remove trailing empty line from split if content ends with \n
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      parts.push(`diff --git a/${f} b/${f}`);
      parts.push(`new file mode 100644`);
      parts.push(`--- /dev/null`);
      parts.push(`+++ b/${f}`);
      for (const line of lines) {
        parts.push(`+${line}`);
      }
      parts.push("");
    } catch {
      // Binary or unreadable — include a deterministic marker
      parts.push(`diff --git a/${f} b/${f}`);
      parts.push(`new file mode 100644`);
      parts.push(`--- /dev/null`);
      parts.push(`+++ b/${f}`);
      parts.push(`Binary or unreadable file (content omitted)`);
      parts.push("");
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// renderGatherBundle — pure markdown renderer for gather.md
// ---------------------------------------------------------------------------

export function renderGatherBundle(
  specPath: string,
  gather: GatherBundle,
  gates?: GateResults,
): string {
  const lines: string[] = [];
  lines.push(`# Patch Review Gather Bundle`);
  lines.push(``);
  lines.push(`## Spec`);
  lines.push(`- Path: ${specPath}`);
  lines.push(``);
  if (gather.diffBase) {
    lines.push(`## Diff base`);
    lines.push(`- Base SHA: ${gather.diffBase}`);
    lines.push(``);
  }
  if (gather.gitWarning) {
    lines.push(`## Git warning`);
    lines.push(`${gather.gitWarning}`);
    lines.push(``);
  }
  lines.push(`## Files changed (${gather.filesChanged.length} files)`);
  for (const f of gather.filesChanged) lines.push(`- ${f}`);
  if (gather.filesChanged.length === 0 && !gather.diff && !gather.untrackedDiff) {
    lines.push(`- No changes detected.`);
  }
  lines.push(``);
  lines.push(`## Tracked diff`);
  lines.push(`\`\`\`diff`);
  lines.push(gather.diff || "(no tracked changes)");
  lines.push(`\`\`\``);
  lines.push(``);
  if (gather.untrackedDiff) {
    lines.push(`## Untracked files (synthetic diffs)`);
    lines.push(`\`\`\`diff`);
    lines.push(gather.untrackedDiff);
    lines.push(`\`\`\``);
    lines.push(``);
  }
  if (gates) {
    const gatesFailed = !gates.typecheck.ok || !gates.unit.ok;
    lines.push(`## Gates (gates_failed: ${gatesFailed})`);
    lines.push(``);
    lines.push(`### typecheck:src (${gates.typecheck.ok ? "PASS" : "FAIL"} — exit ${gates.typecheck.exitCode})`);
    lines.push(`\`\`\``);
    lines.push(gates.typecheck.output || "(no output)");
    lines.push(`\`\`\``);
    lines.push(``);
    lines.push(`### test:unit (${gates.unit.ok ? "PASS" : "FAIL"} — exit ${gates.unit.exitCode})`);
    lines.push(`\`\`\``);
    lines.push(gates.unit.output || "(no output)");
    lines.push(`\`\`\``);
    lines.push(``);
  }
  return lines.join("\n") + "\n";
}

/** CLI-side helper: write the gather bundle markdown to a file. */
export function writeGatherBundle(gatherFile: string, markdown: string): TaskEither<string, void> {
  return TaskEither.tryCatch(
    async () => {
      mkdirSync(dirname(gatherFile), { recursive: true });
      writeFileSync(gatherFile, markdown);
    },
    (e) => `writeGatherBundle: failed to write ${gatherFile}: ${(e as Error).message}`,
  );
}

// ---------------------------------------------------------------------------
// runGates — typecheck:src + test:unit
// ---------------------------------------------------------------------------

/** §C2: phase callback for runGates. Fires before each sequential gate command
 * so the dispatcher can emit one stderr line per gate transition. The callback
 * is best-effort: a throw inside it is swallowed so observation cannot change
 * gate execution. */
export type GatePhaseCallback = (phase: GatePhase, command: string) => void;
export type GatePhase = "gates:typecheck" | "gates:unit" | "gates:tmax-use";

export interface RunGatesOptions {
  onPhase?: GatePhaseCallback;
}

/** Helper that invokes onPhase defensively; never throws. */
function safePhase(onPhase: GatePhaseCallback | undefined, phase: GatePhase, command: string): void {
  if (!onPhase) return;
  try { onPhase(phase, command); } catch { /* observer must not affect gates */ }
}

export function runGates(
  deps: PatchReviewerDeps,
  cwd: string,
  options: RunGatesOptions = {},
): TaskEither<string, GateResults> {
  return TaskEither.from(async () => {
    safePhase(options.onPhase, "gates:typecheck", "bun run typecheck:src");
    const tcRes = await deps.runRaw("bun", ["run", "typecheck:src"], { cwd }).run();
    if (Either.isLeft(tcRes)) {
      return Either.left(`runGates: typecheck spawn failed: ${tcRes.left}`);
    }
    const typecheck: GateResult = {
      ok: tcRes.right.ok,
      exitCode: tcRes.right.exitCode,
      stdout: tcRes.right.stdout,
      stderr: tcRes.right.stderr,
      output: (tcRes.right.stdout + tcRes.right.stderr).trim(),
    };

    safePhase(options.onPhase, "gates:unit", "bun test test/unit/");
    // Spawn 'bun test' directly, NOT 'bun run test:unit'. Same grandchild
    // drain-block fix as BUG-18 in tester.ts — 'bun run' creates a grandchild
    // that keeps pipes open with detached:true, preventing stream 'end'.
    // BUG-16: race against a 10-min wall-clock timeout. The full suite can
    // hang due to the cumulative server-test handle leak; without this cap the
    // patch-review gate blocks indefinitely.
    const UNIT_GATE_TIMEOUT_MS = 600_000;
    let unit: GateResult;
    try {
      const unitResult = await Promise.race([
        deps.runRaw("bun", ["test", "--timeout", "30000", "test/unit/"], { cwd }).run(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`BUG-16 timeout`)), UNIT_GATE_TIMEOUT_MS),
        ),
      ]);
      if (Either.isLeft(unitResult)) {
        return Either.left(`runGates: test:unit spawn failed: ${unitResult.left}`);
      }
      unit = {
        ok: unitResult.right.ok,
        exitCode: unitResult.right.exitCode,
        stdout: unitResult.right.stdout,
        stderr: unitResult.right.stderr,
        output: (unitResult.right.stdout + unitResult.right.stderr).trim(),
      };
    } catch (e) {
      unit = {
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        output: `BUG-16: test:unit gate timed out after ${UNIT_GATE_TIMEOUT_MS / 1000}s`,
      };
    }

    // tmax-use gate: optional, runs only if playbooks or tests exist.
    let tmaxUse: GateResult | undefined;
    if (hasTmaxUseTargets(cwd)) {
      safePhase(options.onPhase, "gates:tmax-use", "bin/tmax-use test");
      // Spawn bin/tmax-use directly, NOT 'bun run test:tmax-use'. Same grandchild
      // drain-block fix as BUG-18.
      const tuRes = await deps.runRaw("bin/tmax-use", ["test"], { cwd }).run();
      if (Either.isLeft(tuRes)) {
        return Either.left(`runGates: test:tmax-use spawn failed: ${tuRes.left}`);
      }
      tmaxUse = {
        ok: tuRes.right.ok,
        exitCode: tuRes.right.exitCode,
        stdout: tuRes.right.stdout,
        stderr: tuRes.right.stderr,
        output: (tuRes.right.stdout + tuRes.right.stderr).trim(),
      };
    }

    return Either.right<GateResults, string>({ typecheck, unit, tmaxUse });
  });
}

/** True if `tmax-use/playbooks/` or `tmax-use/tests/` contains any targets. */
function hasTmaxUseTargets(cwd: string): boolean {
  try {
    const targets = [
      join(cwd, "tmax-use/playbooks"),
      join(cwd, "tmax-use/tests"),
    ];
    for (const dir of targets) {
      const entries = readdirSync(dir, { withFileTypes: true });
      if (entries.some((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml") || e.name.endsWith(".tmax-use.ts")))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// buildAuditPrompt — pure prompt constructor
// ---------------------------------------------------------------------------

const MAX_DIFF_CHARS = 50_000;

export function buildAuditPrompt(
  specPath: string,
  gather: GatherBundle,
  gates: GateResults,
): string {
  const fullDiff = (gather.diff + "\n" + gather.untrackedDiff).trim();
  const truncatedDiff = fullDiff.length > MAX_DIFF_CHARS
    ? fullDiff.slice(0, MAX_DIFF_CHARS) + `\n\n[... diff truncated at ${MAX_DIFF_CHARS} chars ...]`
    : fullDiff;

  const gatesSummary = [
    `typecheck:src → ${gates.typecheck.ok ? "PASS" : "FAIL"} (exit ${gates.typecheck.exitCode})`,
    `test:unit → ${gates.unit.ok ? "PASS" : "FAIL"} (exit ${gates.unit.exitCode})`,
    gates.tmaxUse
      ? `test:tmax-use → ${gates.tmaxUse.ok ? "PASS" : "FAIL"} (exit ${gates.tmaxUse.exitCode})`
      : `test:tmax-use → SKIPPED (no tmax-use targets)`,
  ].join("\n");

  return `You are auditing a build's implementation against its spec for the tmax terminal editor.

Walk every acceptance criterion in the spec, cite file:line evidence for each, and check that tests cover the described behaviors and edge cases are handled.

## Spec: ${specPath}

"""
${gather.specContent}
"""

## Implementation diff

\`\`\`diff
${truncatedDiff || "(no changes found)"}
\`\`\`

## Gate results

${gatesSummary}

## Rubric

1. For each acceptance criterion in the spec, determine if it is implemented, missing, or partial. Cite file:line evidence.
2. For each described behavior, check if it is covered by tests or uncovered. Cite evidence.
3. For each edge case mentioned in the spec, check if it is handled or missed. Cite evidence.
4. Produce a verdict: "pass" if all criteria are implemented and tests cover the behaviors; "gaps" otherwise.

Respond with a JSON object matching the schema: verdict, summary, criteria[], tests[], edge_cases[].`;
}

// ---------------------------------------------------------------------------
// parseVerdict — validate JSON into AuditVerdict
// ---------------------------------------------------------------------------

export function parseVerdict(raw: string): Either<string, AuditVerdict> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Either.left(`parseVerdict: not valid JSON: ${raw.slice(0, 300)}`);
  }

  const obj = parsed as Record<string, unknown>;

  // verdict
  if (obj.verdict !== "pass" && obj.verdict !== "gaps") {
    return Either.left(`parseVerdict: verdict field must be "pass" or "gaps", got: ${JSON.stringify(obj.verdict)}`);
  }

  // summary
  if (typeof obj.summary !== "string") {
    return Either.left(`parseVerdict: summary must be a string`);
  }

  // criteria
  if (!Array.isArray(obj.criteria)) {
    return Either.left(`parseVerdict: criteria must be an array`);
  }
  const criteria: CriterionAssessment[] = [];
  for (let i = 0; i < obj.criteria.length; i++) {
    const item = obj.criteria[i] as Record<string, unknown>;
    if (typeof item?.criterion !== "string" || typeof item?.evidence !== "string") {
      return Either.left(`parseVerdict: criteria[${i}] missing required string fields`);
    }
    if (item.status !== "implemented" && item.status !== "missing" && item.status !== "partial") {
      return Either.left(`parseVerdict: criteria[${i}].status must be implemented|missing|partial, got: ${JSON.stringify(item.status)}`);
    }
    criteria.push({
      criterion: item.criterion,
      status: item.status,
      evidence: item.evidence,
    });
  }

  // tests
  if (!Array.isArray(obj.tests)) {
    return Either.left(`parseVerdict: tests must be an array`);
  }
  const tests: TestAssessment[] = [];
  for (let i = 0; i < obj.tests.length; i++) {
    const item = obj.tests[i] as Record<string, unknown>;
    if (typeof item?.behavior !== "string" || typeof item?.evidence !== "string") {
      return Either.left(`parseVerdict: tests[${i}] missing required string fields`);
    }
    if (item.status !== "covered" && item.status !== "uncovered") {
      return Either.left(`parseVerdict: tests[${i}].status must be covered|uncovered, got: ${JSON.stringify(item.status)}`);
    }
    tests.push({
      behavior: item.behavior,
      status: item.status,
      evidence: item.evidence,
    });
  }

  // edge_cases
  if (!Array.isArray(obj.edge_cases)) {
    return Either.left(`parseVerdict: edge_cases must be an array`);
  }
  const edgeCases: EdgeCaseAssessment[] = [];
  for (let i = 0; i < obj.edge_cases.length; i++) {
    const item = obj.edge_cases[i] as Record<string, unknown>;
    if (typeof item?.case !== "string" || typeof item?.evidence !== "string") {
      return Either.left(`parseVerdict: edge_cases[${i}] missing required string fields`);
    }
    if (item.status !== "handled" && item.status !== "missed") {
      return Either.left(`parseVerdict: edge_cases[${i}].status must be handled|missed, got: ${JSON.stringify(item.status)}`);
    }
    edgeCases.push({
      case: item.case,
      status: item.status,
      evidence: item.evidence,
    });
  }

  return Either.right({
    verdict: obj.verdict,
    summary: obj.summary,
    criteria,
    tests,
    edge_cases: edgeCases,
  });
}

// ---------------------------------------------------------------------------
// parseClaudeStreamVerdict — extract final result from stream-json
// ---------------------------------------------------------------------------

export function parseClaudeStreamVerdict(streamJson: string): Either<string, AuditVerdict> {
  const lines = streamJson.split("\n").filter((l) => l.trim());

  // Backward-scan for the last { "type": "result", ... } object
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // malformed line — skip
    }
    if (obj?.type !== "result") continue;

    // The result payload is in the `result` field as a string
    const result = obj.result;
    if (typeof result !== "string") {
      return Either.left(`parseClaudeStreamVerdict: result event has non-string result payload`);
    }

    // The result string itself is JSON (forced by --json-schema)
    const parsed = parseVerdict(result);
    if (Either.isRight(parsed)) return parsed;

    // Fallback: when --json-schema is used, claude may wrap the structured
    // output in a StructuredOutput tool_use block rather than putting clean
    // JSON in the result field. Scan the stream for that block.
    const fromToolUse = extractStructuredOutput(lines);
    if (fromToolUse) {
      const toolParsed = parseVerdict(fromToolUse);
      if (Either.isRight(toolParsed)) return toolParsed;
    }

    // Neither path worked — return the original error.
    return parsed;
  }

  // No result event at all — try StructuredOutput as a last resort.
  const fromToolUse = extractStructuredOutput(lines);
  if (fromToolUse) {
    const toolParsed = parseVerdict(fromToolUse);
    if (Either.isRight(toolParsed)) return toolParsed;
  }

  return Either.left(`parseClaudeStreamVerdict: no result event found in stream-json output`);
}

/**
 * Scan stream-json lines for a StructuredOutput tool_use block containing the
 * audit verdict JSON. Claude emits this when using --json-schema and the model
 * calls the StructuredOutput tool instead of returning clean JSON in the result.
 */
function extractStructuredOutput(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(lines[i]!) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj?.type !== "assistant") continue;
    const content = (obj as { message?: { content?: unknown[] } }).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "tool_use" &&
        (block as Record<string, unknown>).name === "StructuredOutput"
      ) {
        const input = (block as Record<string, unknown>).input;
        if (input && typeof input === "object") {
          return JSON.stringify(input);
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// audit — dispatch claude -p with structured-output
// ---------------------------------------------------------------------------

export function audit(
  deps: PatchReviewerDeps,
  cwd: string,
  specPath: string,
  gather: GatherBundle,
  gates: GateResults,
  auditorLog: string,
  verdictFile: string,
  model: string = PATCH_REVIEW_MODEL,
): TaskEither<string, AuditVerdict> {
  const prompt = buildAuditPrompt(specPath, gather, gates);
  const schemaJson = JSON.stringify(AUDIT_SCHEMA);

  // Init auditor log
  const init = TaskEither.tryCatch(
    async () => {
      mkdirSync(dirname(auditorLog), { recursive: true });
      writeFileSync(auditorLog, "");
      mkdirSync(dirname(verdictFile), { recursive: true });
    },
    (e) => `audit: failed to initialize logs: ${(e as Error).message}`,
  );

  return init.flatMap(() =>
    deps.runCapture(
      CLAUDE,
      [
        "-p",
        "--model", model,
        "--dangerously-skip-permissions",
        "--verbose",
        "--output-format", "stream-json",
        "--json-schema", schemaJson,
        prompt,
      ],
      { cwd, teeTo: auditorLog },
    ).flatMap((stdout) => {
      const parsed = parseClaudeStreamVerdict(stdout);
      if (Either.isLeft(parsed)) {
        return TaskEither.left(parsed.left);
      }
      const verdict = parsed.right;

      // Write normalized JSON to verdictFile
      const writeTE = TaskEither.tryCatch(
        async () => {
          writeFileSync(verdictFile, JSON.stringify(verdict, null, 2) + "\n");
        },
        (e) => `audit: failed to write verdict file: ${(e as Error).message}`,
      );

      return writeTE.map(() => verdict);
    }),
  );
}
