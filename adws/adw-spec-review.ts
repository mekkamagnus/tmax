#!/usr/bin/env bun
/**
 * adw-spec-review.ts — spec → reviewed spec (codex-driven).
 *
 * Takes a spec (by path or by adw-id), reviews it via codex, and either passes
 * it or upgrades it in place. Mirrors adw-plan.ts's structure (adw-id minting,
 * agents/{adw-id}/ state + per-agent events, <adw-id> <result> stdout contract).
 *
 *   bun adws/adw-spec-review.ts docs/specs/SPEC-056-browse-url.md
 *   bun adws/adw-spec-review.ts 01KVCMJ0QR
 *
 * The codex interface (review + upgrade) lives in ./adws-modules/reviewer.ts.
 * Single external dependency: the `codex` CLI (v0.137+), resolved by the module.
 *
 * Exit codes: 0 = reviewed (pass | upgraded | unchanged); 1 = usage error /
 * missing dependency; 2 = review/upgrade/resolve failure (message on stderr).
 *
 * File layout per run:
 *   agents/{adw-id}/adw-state.json              — state only (id, spec_path, status)
 *   agents/{adw-id}/reviewer/events.jsonl       — review lifecycle events (streamed)
 *   agents/{adw-id}/reviewer/raw-output.jsonl     — codex review output (streamed)
 *   agents/{adw-id}/reviewer/verdict.json         — codex validated verdict
 *   agents/{adw-id}/upgrader/events.jsonl         — upgrade lifecycle events (if upgrade runs)
 *   agents/{adw-id}/upgrader/raw-output.jsonl     — codex upgrade output (if upgrade runs)
 */
import { spawn } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "path";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import { CODEX, type CodexDeps, type ReviewVerdictPayload, reviewSpec, upgradeSpec } from "./adws-modules/reviewer.ts";
import { findWorkspaceBySpecPath } from "./adws-modules/workspace.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const SPECS_DIR = join(PROJECT_ROOT, "docs", "specs");

// §D1: cap (and per-issue truncation) for the verdict line's issue list. The
// full list is always written to events.jsonl; this cap only governs the
// console rendering to avoid flooding the tmux window on a badly broken spec.
const MAX_VERDICT_ISSUES_ON_CONSOLE = 10;
const MAX_ISSUE_LEN = 200;

/**
 * §D1: pure formatter for the spec-review verdict line.
 *
 * - On `pass`: single line `adw-spec-review: verdict=pass\n` (no bullets).
 * - On `fail`: header `adw-spec-review: verdict=fail — N issues:\n` followed by
 *   one `- <issue>` bullet per issue (capped at MAX_VERDICT_ISSUES_ON_CONSOLE),
 *   with a trailing `... (N more)\n` when the cap truncates the list. Each
 *   issue is truncated to ~MAX_ISSUE_LEN chars and any embedded newlines are
 *   collapsed to spaces so a single issue never breaks the bullet structure.
 *
 * Robust against malformed input: empty issues on a fail verdict renders
 * `verdict=fail — 0 issues:` with no bullets; non-string entries are coerced
 * via String(); long entries are truncated with a trailing `...`.
 */
export function formatVerdictLine(verdict: ReviewVerdictPayload): string {
  if (verdict.verdict === "pass") {
    return `adw-spec-review: verdict=pass\n`;
  }
  const issues = Array.isArray(verdict.issues) ? verdict.issues : [];
  const total = issues.length;
  const header = `adw-spec-review: verdict=fail — ${total} issue${total === 1 ? "" : "s"}:\n`;
  if (total === 0) return header;
  const shown = issues.slice(0, MAX_VERDICT_ISSUES_ON_CONSOLE);
  const bullets = shown.map((raw) => {
    const text = collapseAndTruncateIssue(raw);
    return `  - ${text}\n`;
  });
  const remaining = total - shown.length;
  const tail = remaining > 0 ? `  ... (${remaining} more)\n` : "";
  return header + bullets.join("") + tail;
}

/** Coerce to string, collapse newlines/tabs to single spaces, truncate to MAX_ISSUE_LEN. */
function collapseAndTruncateIssue(raw: unknown): string {
  const s = typeof raw === "string" ? raw : String(raw ?? "");
  const oneLine = s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (oneLine.length <= MAX_ISSUE_LEN) return oneLine;
  return oneLine.slice(0, MAX_ISSUE_LEN - 3) + "...";
}

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-spec-review.ts <spec-path-or-adw-id>

Reviews a spec via codex (read-only), and if issues are found, upgrades it in
place (workspace-write). Prints "<adw-id> <pass|upgraded|unchanged> <spec-path>"
on success.

  <spec-path>   A docs/specs/{SPEC,BUG,CHORE}-*.md path.
  <adw-id>      A 10-char ULID-timestamp id from a prior adw-plan run; resolves
                to the spec that run produced (via agents/<adw-id>/adw-state.json).

State: ./agents/{adw-id}/adw-state.json; review events:
./agents/{adw-id}/reviewer/events.jsonl; codex output:
./agents/{adw-id}/reviewer/raw-output.jsonl; on upgrade:
./agents/{adw-id}/upgrader/events.jsonl.`;

interface ParsedArgs {
  input: string;
  id?: string;
}

function parseArgs(argv: string[]): Either<string, ParsedArgs> {
  let input = "";
  let id: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    else if (a === "--id") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--id requires a value.");
      if (!ADW_ID_RE.test(val)) return Either.left(`--id must be a 10-char ULID-timestamp id (got "${val}").`);
      id = val;
    } else if (input === "") input = a;
    else return Either.left(`Unexpected extra argument: ${a}`);
  }
  if (!input) return Either.left(`__usage__:${USAGE}`);
  return Either.right({ input, id });
}

// ---------------------------------------------------------------------------
// Run-state: adwId() + appendEvent() + writeState()
// ---------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID timestamp portion: 48-bit ms-since-epoch → 10 chars Crockford Base32. */
function adwId(): string {
  let ms = Date.now();
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[ms & 31] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

/**
 * Append a single lifecycle event as one JSON line to the agent's events file.
 * Sync, append-only — survives crashes. Each event is on disk immediately.
 */
function appendEvent(id: string, agent: string, event: Record<string, unknown>): void {
  const dir = join(AGENTS_DIR, id, agent);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  appendFileSync(join(dir, "events.jsonl"), line);
}

/**
 * Write the run-state file (id, spec_path, status — no events).
 * Called at most twice: after start and after result/error.
 */
function writeState(id: string, state: Record<string, unknown>): TaskEither<string, void> {
  return TaskEither.tryCatch(async () => {
    const dir = join(AGENTS_DIR, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "adw-state.json"), JSON.stringify(state, null, 2) + "\n");
  }, (e) => `writeState: ${(e as Error).message}`);
}

// ---------------------------------------------------------------------------
// Subprocess plumbing: run() + runCapture() as TaskEither
// ---------------------------------------------------------------------------

interface RunOpts {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Spawn, capture stdout/stderr. Returns TaskEither (lazy, composable).
 * Left = non-zero exit (error = stderr||stdout); Right = trimmed stdout.
 */
function run(cmd: string, args: string[], opts: RunOpts = {}): TaskEither<string, string> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, string>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.on("error", (e) => resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve(Either.right(stdout.trim()));
        else resolve(Either.left((stderr || stdout).trim() || `${cmd} exited with code ${code}`));
      });
    });
  });
}

/**
 * runCapture: like run, but tees stdout to `teeTo` path line-by-line as it
 * arrives (via sync appendFileSync — acceptable for line-at-a-time small writes
 * that must survive a crash). Returns TaskEither (lazy).
 */
function runCapture(cmd: string, args: string[], opts: RunOpts & { teeTo: string }): TaskEither<string, string> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, string>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let teeBuf = "";
      child.stdout.on("data", (chunk: Buffer | string) => {
        const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stdout += s;
        // Tee line-by-line: flush complete lines as they arrive.
        teeBuf += s;
        let nl: number;
        while ((nl = teeBuf.indexOf("\n")) >= 0) {
          const line = teeBuf.slice(0, nl + 1);
          try { appendFileSync(opts.teeTo, line); } catch { /* ignore */ }
          teeBuf = teeBuf.slice(nl + 1);
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.on("error", (e) => resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)));
      child.on("close", (code) => {
        // Flush trailing partial line
        if (teeBuf.length > 0) {
          try { appendFileSync(opts.teeTo, teeBuf); } catch { /* ignore */ }
        }
        if (code === 0) resolve(Either.right(stdout.trim()));
        else resolve(Either.left((stderr || stdout).trim() || `${cmd} exited with code ${code}`));
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Input resolution: spec path OR adw-id → {specPath, source}
// ---------------------------------------------------------------------------

const ADW_ID_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

interface ResolvedInput {
  specPath: string;
  source: "path" | "adw-id";
}

function resolveInput(input: string): Either<string, ResolvedInput> {
  // Case 1: a path under docs/specs/ naming a SPEC/BUG/CHORE file.
  const base = input.split("/").pop() ?? input;
  if (/^(SPEC|BUG|CHORE)-/.test(base)) {
    const direct = input.startsWith("/") ? input : join(PROJECT_ROOT, input);
    if (existsSync(direct)) return Either.right({ specPath: direct, source: "path" });
    // Maybe it's just a bare filename living in SPECS_DIR.
    const inSpecs = join(SPECS_DIR, base);
    if (existsSync(inSpecs)) return Either.right({ specPath: inSpecs, source: "path" });
    return Either.left(`resolve: spec file not found: ${input}`);
  }
  // Case 2: an adw-id → read state, find spec_path.
  if (ADW_ID_RE.test(input)) {
    const stateFile = join(AGENTS_DIR, input, "adw-state.json");
    if (!existsSync(stateFile)) return Either.left(`resolve: no agents/${input}/adw-state.json for adw-id ${input}`);
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
      const specPath = state.spec_path as string | undefined;
      if (!specPath) return Either.left(`resolve: adw-id ${input} has no spec_path in its state`);
      return Either.right({ specPath, source: "adw-id" as const });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Either.left(`resolve: failed to parse agents/${input}/adw-state.json: ${msg}`);
    }
  }
  return Either.left(`resolve: "${input}" is neither a spec path (SPEC|BUG|CHORE-*.md) nor a 10-char adw-id`);
}

// ---------------------------------------------------------------------------
// Dependency guard
// ---------------------------------------------------------------------------

function ensureCodex(): TaskEither<string, void> {
  return run(CODEX, ["--version"])
    .map(() => undefined)
    .mapLeft(() =>
      `The \`codex\` CLI was not runnable at "${CODEX}". Install OpenAI Codex CLI (v0.137+) and retry ` +
      `(it is resolved by scanning ~/.nvm/versions/node/*/bin/codex, newest first, then PATH).`,
    );
}

// ---------------------------------------------------------------------------
// main() — composed pipeline
// ---------------------------------------------------------------------------

// -- Pipeline context (the value threaded through each step) --

interface PipelineInput {
  id: string;
  specPath: string;
  source: "path" | "adw-id";
}

/** Result of a successful spec-review run. */
export type ReviewKind = "pass" | "upgraded" | "unchanged";
export interface SpecReviewResult {
  id: string;
  specPath: string;
  kind: ReviewKind;
  summary: string;
}

/**
 * The spec-review pipeline as a callable function. Resolves the input (spec path
 * or adw-id), reviews the spec via codex, and either passes it or upgrades it in
 * place. Returns Either<string, SpecReviewResult> — Left on failure, Right with
 * the id + kind on success. Progress messages go to stderr; the caller (main()
 * or an orchestrator) is responsible for any final stdout line.
 */
export function runSpecReview(
  input: string,
  id?: string,
): Promise<Either<string, SpecReviewResult>> {
  // Resolve input BEFORE minting an id so a bad input leaves no agents/ dir.
  const resolved = resolveInput(input);
  if (Either.isLeft(resolved)) {
    return Promise.resolve(Either.left(resolved.left));
  }

  // Inject the subprocess plumbing into the reviewer module.
  const deps: CodexDeps = { run, runCapture };

  // ownsState = true when running standalone (no orchestrator driving this
  // process). The orchestrator sets ADW_ORCHESTRATED=1 when spawning children;
  // when set, this stage writes events under the shared id but skips writing
  // adw-state.json — the orchestrator owns the single workspace state.
  // Keyed off the env var (not the presence of --id) so a human running
  // `adw-spec-review.ts --id X <spec>` standalone still gets their own state file.
  const ownsState = process.env.ADW_ORCHESTRATED !== "1";

  // Resolve the workspace id: explicit --id > discovered workspace > fresh mint.
  // Discovery reuses the most recent existing workspace for this spec so logs
  // collect in one place. Skipped when orchestrated (orchestrator passes --id).
  let runId: string;
  if (id) {
    runId = id;
  } else if (ownsState) {
    const discovered = findWorkspaceBySpecPath(AGENTS_DIR, resolved.right.specPath);
    runId = discovered ?? adwId();
    if (discovered) {
      process.stderr.write(`adw-spec-review: reusing workspace ${discovered} for ${resolved.right.specPath}\n`);
    }
  } else {
    runId = adwId();
  }

  // Mutable ref so the error handler can access the id after short-circuit.
  let currentId: string | null = null;

  // When orchestrated, skip state writes — the orchestrator owns the workspace
  // adw-state.json. Return a no-op Right<undefined>.
  const recordState = (stateId: string, state: Record<string, unknown>): TaskEither<string, void> =>
    ownsState ? writeState(stateId, state) : TaskEither.right<void, string>(undefined);

  // SPEC-065: ADW_WORKTREE is the orchestrator's per-run sibling worktree path.
  // Fresh orchestrator setup intentionally does NOT set ADW_WORKTREE for the
  // spec-review stage (so review edits land on main), so this hoist is a
  // no-op there. The fallback preserves standalone behavior and supports any
  // future reviewed-in-worktree resume path.
  const cwd = process.env.ADW_WORKTREE ?? PROJECT_ROOT;

  const program = TaskEither
    .right<PipelineInput, string>({
      id: runId,
      specPath: resolved.right.specPath,
      source: resolved.right.source,
    })
    .tap((ctx) => { currentId = ctx.id; })
    // Step 0: dependency guard (runs BEFORE minting any state)
    .flatMap((ctx: PipelineInput) => ensureCodex().map(() => ctx))
    // Step 1: write initial state + start event
    .flatMap((ctx: PipelineInput) => recordState(ctx.id, {
      adw_id: ctx.id,
      spec_path: ctx.specPath,
      source: ctx.source,
      status: "running",
    })
      .tap(() => appendEvent(ctx.id, "reviewer", {
        event: "start",
        input,
        spec_path: ctx.specPath,
        source: ctx.source,
      }))
      .map(() => ctx)
    )
    // Step 2: review (Pass 1 — read-only)
    .flatMap((ctx: PipelineInput) => {
      const reviewerLog = join(AGENTS_DIR, ctx.id, "reviewer", "raw-output.jsonl");
      const verdictFile = join(AGENTS_DIR, ctx.id, "reviewer", "verdict.json");
      return reviewSpec(deps, cwd, ctx.specPath, reviewerLog, verdictFile)
        .tap((verdict: ReviewVerdictPayload) => {
          appendEvent(ctx.id, "reviewer", {
            event: "review",
            verdict: verdict.verdict,
            summary: verdict.summary,
            issue_count: verdict.issues.length,
            issues: verdict.issues,
          });
          process.stderr.write(formatVerdictLine(verdict));
        })
        .map((verdict: ReviewVerdictPayload) => ({ ...ctx, verdict }));
    })
    // Step 3: if verdict is "pass", record result and exit. If "fail", upgrade.
    .flatMap((ctx: PipelineInput & { verdict: ReviewVerdictPayload }): TaskEither<string, SpecReviewResult> => {
      if (ctx.verdict.verdict === "pass") {
        appendEvent(ctx.id, "reviewer", {
          event: "result",
          kind: "pass",
          spec_path: ctx.specPath,
          summary: ctx.verdict.summary,
        });
        return recordState(ctx.id, {
          adw_id: ctx.id,
          spec_path: ctx.specPath,
          source: ctx.source,
          status: "pass",
        }).map(() => ({
          id: ctx.id,
          specPath: ctx.specPath,
          kind: "pass" as const,
          summary: ctx.verdict.summary,
        }));
      }

      // Verdict is "fail" — proceed to upgrade (Pass 2).
      const upgraderLog = join(AGENTS_DIR, ctx.id, "upgrader", "raw-output.jsonl");
      appendEvent(ctx.id, "upgrader", { event: "start", spec_path: ctx.specPath });
      return upgradeSpec(deps, cwd, ctx.specPath, ctx.verdict, upgraderLog)
        .tap((result) => {
          const status = result.changed ? "upgraded" : "unchanged";
          appendEvent(ctx.id, "upgrader", {
            event: "upgrade",
            status,
            spec_path: ctx.specPath,
            summary: result.summary || ctx.verdict.summary,
          });
          appendEvent(ctx.id, "reviewer", {
            event: "result",
            kind: status,
            spec_path: ctx.specPath,
            summary: ctx.verdict.summary,
          });
        })
        .map((result) => ({
          id: ctx.id,
          specPath: ctx.specPath,
          kind: (result.changed ? "upgraded" : "unchanged") as "upgraded" | "unchanged",
          summary: ctx.verdict.summary,
        }));
    })
    // Step 4: finalize state
    .flatMap((result: SpecReviewResult) => {
      return recordState(result.id, {
        adw_id: result.id,
        spec_path: result.specPath,
        status: result.kind,
      }).map(() => result);
    });

  // Run the pipeline. On error, stream an error event + update state.
  return program.run().then((result) => {
    if (Either.isLeft(result)) {
      if (currentId) {
        appendEvent(currentId, "reviewer", { event: "error", detail: result.left });
        return recordState(currentId, { adw_id: currentId, status: "failed" }).run().then(() =>
          Either.left(result.left),
        );
      }
      return Either.left(result.left);
    }
    return Either.right(result.right);
  });
}

function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  // Handle help/usage/parse errors synchronously (before any deps or ids).
  if (Either.isLeft(parsed)) {
    if (parsed.left.startsWith("__help__:")) {
      process.stdout.write(parsed.left.slice("__help__:".length) + "\n");
      return Promise.resolve(0);
    }
    if (parsed.left.startsWith("__usage__:")) {
      process.stderr.write(parsed.left.slice("__usage__:".length) + "\n");
      return Promise.resolve(1);
    }
    process.stderr.write(`Error: ${parsed.left}\n`);
    return Promise.resolve(1);
  }

  return runSpecReview(parsed.right.input, parsed.right.id).then((result) => {
    if (Either.isLeft(result)) {
      process.stderr.write(`Error: ${result.left}\n`);
      return 2;
    }
    process.stdout.write(`${result.right.id} ${result.right.kind} ${result.right.specPath}\n`);
    return 0;
  });
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
