#!/usr/bin/env bun
/**
 * adw-patch-review.ts — post-build audit dispatcher (claude-driven).
 *
 * After `adw-build.ts` has run `/implement` against a spec, this dispatcher
 * audits the resulting working-tree changes against the spec's acceptance
 * criteria to confirm the implementation actually satisfies the plan. It gathers
 * the diff plus the spec content, runs typecheck and unit tests as gates, then
 * dispatches a `claude` sub-agent that walks each acceptance criterion citing
 * `file:line` evidence and produces a PASS or GAPS verdict.
 *
 *   bun adws/adw-patch-review.ts docs/specs/SPEC-056-browse-url.md
 *   bun adws/adw-patch-review.ts 01KVCMJ0QR
 *   bun adws/adw-patch-review.ts --model glm-5.2 docs/specs/SPEC-056-browse-url.md
 *
 * The claude interface (dependency guard + gather + gates + audit) lives in
 * ./adws-modules/patch-reviewer.ts. Single external dependency: the `claude` CLI.
 *
 * Exit codes: 0 = audited (pass | gaps); 1 = usage error / missing dependency /
 * unresolvable input (no agents/ dir created); 2 = audit failure after state
 * was written (error event + failed state recorded).
 *
 * File layout per run:
 *   agents/{id}/adw-state.json                 — state only
 *   agents/{id}/patch-reviewer/events.jsonl    — lifecycle events (streamed)
 *   agents/{id}/patch-reviewer/raw-output.jsonl — claude audit output (streamed)
 *   agents/{id}/patch-reviewer/gather.md       — deterministic gather bundle
 *   agents/{id}/patch-reviewer/verdict.json    — normalized audit verdict
 */
import { spawn } from "child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { join } from "path";
import { Either, TaskEither } from "../src/utils/task-either.ts";
import {
  PATCH_REVIEW_MODEL,
  type PatchReviewerDeps,
  type RawRunResult,
  type GatherBundle,
  type GateResults,
  type AuditVerdict,
  ensureAvailable,
  gatherContext,
  runGates,
  renderGatherBundle,
  writeGatherBundle,
  audit,
} from "./adws-modules/patch-reviewer.ts";
import {
  ADW_ID_RE,
  adwId,
  appendEvent as appendEventRaw,
  writeState as writeStateRaw,
  run,
  type RunOpts,
} from "./adws-modules/dispatcher-runtime.ts";
import { findWorkspaceBySpecPath } from "./adws-modules/dispatcher-runtime.ts";
import { withClaude529Retry } from "./claude-529-retry.ts";

const PROJECT_ROOT = realpathSync(join(import.meta.dir, ".."));
const AGENTS_DIR = join(PROJECT_ROOT, "agents");
const SPECS_DIR = join(PROJECT_ROOT, "docs", "specs");

// ---------------------------------------------------------------------------
// Usage / arg parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: bun adws/adw-patch-review.ts [--model <id>] [--id <id>] <spec-path-or-adw-id>

Audits a build's working-tree changes against a spec's acceptance criteria via
\`claude -p\`. Prints "<id> <pass|gaps> <spec-path>" on success.

  --model <id>   Override the default audit model (${PATCH_REVIEW_MODEL}).
  --id <id>      Use a specific workspace id (default: reuse build-id, or mint new).
  <spec-path>    A docs/specs/{SPEC,BUG,CHORE}-*.md path.
  <adw-id>       A 10-char ULID-timestamp id from a prior adw-build run; resolves
                 to that run's spec_path and base_sha.

State: ./agents/{id}/adw-state.json; audit events:
./agents/{id}/patch-reviewer/events.jsonl; claude output:
./agents/{id}/patch-reviewer/raw-output.jsonl; verdict:
./agents/{id}/patch-reviewer/verdict.json.`;

export interface ParsedArgs {
  input: string;
  model?: string;
  id?: string;
}

export function parseArgs(argv: string[]): Either<string, ParsedArgs> {
  let input = "";
  let model: string | undefined;
  let id: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    else if (a === "--model") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--model requires a value.");
      model = val;
    } else if (a === "--id") {
      const val = argv[++i];
      if (val === undefined) return Either.left("--id requires a value.");
      if (!ADW_ID_RE.test(val)) return Either.left(`--id must be a 10-char ULID-timestamp id (got "${val}").`);
      id = val;
    } else if (input === "") input = a;
    else return Either.left(`Unexpected extra argument: ${a}`);
  }
  if (!input) return Either.left(`__usage__:${USAGE}`);
  return Either.right({ input, model, id });
}

// ---------------------------------------------------------------------------
// Run-state: thin wrappers around dispatcher-runtime (CHORE-44 Change 8).
// The implementation lives in dispatcher-runtime.ts; these const arrows curry
// AGENTS_DIR.
// ---------------------------------------------------------------------------

const appendEvent = (id: string, agent: string, event: Record<string, unknown>): void =>
  appendEventRaw(AGENTS_DIR, id, agent, event);

const writeState = (id: string, state: Record<string, unknown>): TaskEither<string, void> =>
  writeStateRaw(AGENTS_DIR, id, state).map(() => undefined);

// ---------------------------------------------------------------------------
// Subprocess plumbing: run() comes from dispatcher-runtime; runRaw() and
// runCapture() are SPECIALIZED for this stage — they add detached
// process-group + stdout/stderr drain-on-end semantics. BUG-18: the gates
// spawn `bun run test:unit` whose grandchild keeps pipes open, so the
// drain-safe pattern is load-bearing here. The shared `runCapture` in
// dispatcher-runtime does NOT have these — they remain local to patch-review.
// ---------------------------------------------------------------------------

// Re-export RunOpts for backwards compatibility with tests/external callers
// that imported it from this module pre-refactor.
export type { RunOpts };

function runRaw(cmd: string, args: string[], opts: RunOpts = {}): TaskEither<string, RawRunResult> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, RawRunResult>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let procClosed = false;
      let stdoutEnded = false;
      let stderrEnded = false;
      let exitCode = -1;

      // Drain-safe: resolve only after process closes AND both streams end.
      // BUG-18: without this, 'bun run test:unit' grandchild keeps pipes open
      // and the close event fires before stream data is fully drained.
      const trySettle = () => {
        if (settled) return;
        if (!procClosed || !stdoutEnded || !stderrEnded) return;
        settled = true;
        clearTimeout(timer);
        resolve(Either.right({ ok: exitCode === 0, exitCode, stdout, stderr }));
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { process.kill(-child.pid!, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
        resolve(Either.right({ ok: false, exitCode: -1, stdout, stderr }));
      }, 1_200_000);

      child.stdout.on("data", (chunk: Buffer | string) => { stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8"); });
      child.stdout.on("end", () => { stdoutEnded = true; trySettle(); });
      child.stderr.on("data", (chunk: Buffer | string) => { stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8"); });
      child.stderr.on("end", () => { stderrEnded = true; trySettle(); });
      child.on("error", (e) => { if (!settled) { settled = true; resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)); } });
      child.on("close", (code) => { if (!settled) { procClosed = true; exitCode = code ?? -1; trySettle(); } });
    });
  });
}

function runCapture(cmd: string, args: string[], opts: RunOpts & { teeTo: string }): TaskEither<string, string> {
  return TaskEither.from(async () => {
    return await new Promise<Either<string, string>>((resolve) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      let stdout = "";
      let stderr = "";
      let teeBuf = "";
      let settled = false;
      let procClosed = false;
      let stdoutEnded = false;
      let stderrEnded = false;
      let exitCode = -1;

      // No wall-clock timeout on runCapture — the audit call (claude -p)
      // legitimately runs 20-40 min on a large spec + diff. The timeout
      // was killing it mid-audit. Protection against hangs comes from:
      // 1. claude -p's own internal timeout + retries
      // 2. The 529 retry wrapper (withClaude529Retry)
      // 3. The drain-safe pattern (process must close + streams must end)
      const trySettle = () => {
        if (settled) return;
        if (!procClosed || !stdoutEnded || !stderrEnded) return;
        settled = true;
        if (teeBuf.length > 0) { try { appendFileSync(opts.teeTo, teeBuf); } catch { /* ignore */ } }
        if (exitCode === 0) resolve(Either.right(stdout.trim()));
        else resolve(Either.left((stderr || stdout).trim() || `${cmd} exited with code ${exitCode}`));
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        stdout += s;
        teeBuf += s;
        let nl: number;
        while ((nl = teeBuf.indexOf("\n")) >= 0) {
          const line = teeBuf.slice(0, nl + 1);
          try { appendFileSync(opts.teeTo, line); } catch { /* ignore */ }
          teeBuf = teeBuf.slice(nl + 1);
        }
      });
      child.stdout.on("end", () => { stdoutEnded = true; trySettle(); });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      });
      child.stderr.on("end", () => { stderrEnded = true; trySettle(); });
      child.on("error", (e) => { if (!settled) { settled = true; resolve(Either.left(`failed to spawn ${cmd}: ${e.message}`)); } });
      child.on("close", (code) => { if (!settled) { procClosed = true; exitCode = code ?? -1; trySettle(); } });
    });
  });
}

// ---------------------------------------------------------------------------
// Input resolution: spec path OR adw-id → {specPath, source}
// ---------------------------------------------------------------------------

export interface ResolvedInput {
  specPath: string;
  source: "path" | "adw-id";
  diffBase?: string;
}

interface WorkspaceHints {
  baseSha?: string;
  worktreePath?: string;
  orchestratorEventsFile?: string;
}

function readWorkspaceHints(id: string): WorkspaceHints {
  const stateFile = join(AGENTS_DIR, id, "adw-state.json");
  const orchestratorEventsFile = join(AGENTS_DIR, id, "orchestrator", "events.jsonl");
  if (!existsSync(stateFile)) return { orchestratorEventsFile };
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
    return {
      baseSha: typeof state.base_sha === "string" ? state.base_sha : undefined,
      worktreePath: typeof state.worktree_path === "string" ? state.worktree_path : undefined,
      orchestratorEventsFile,
    };
  } catch {
    return { orchestratorEventsFile };
  }
}

export function resolveInputFrom(input: string, agentsDir: string, specsDir: string): Either<string, ResolvedInput> {
  const base = input.split("/").pop() ?? input;
  if (/^(SPEC|BUG|CHORE)-/.test(base)) {
    const direct = input.startsWith("/") ? input : join(PROJECT_ROOT, input);
    if (existsSync(direct)) return Either.right({ specPath: direct, source: "path" });
    const inSpecs = join(specsDir, base);
    if (existsSync(inSpecs)) return Either.right({ specPath: inSpecs, source: "path" });
    return Either.left(`resolve: spec file not found: ${input}`);
  }
  if (ADW_ID_RE.test(input)) {
    const stateFile = join(agentsDir, input, "adw-state.json");
    if (!existsSync(stateFile)) return Either.left(`resolve: no agents/${input}/adw-state.json for adw-id ${input}`);
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
      const specPath = state.spec_path as string | undefined;
      if (!specPath) {
        return Either.left(
          `resolve: adw-id ${input} has no spec_path in its state`,
        );
      }
      const diffBase = typeof state.base_sha === "string" ? state.base_sha : undefined;
      return Either.right({ specPath, source: "adw-id" as const, diffBase });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return Either.left(`resolve: failed to parse agents/${input}/adw-state.json: ${msg}`);
    }
  }
  return Either.left(`resolve: "${input}" is neither a spec path (SPEC|BUG|CHORE-*.md) nor a 10-char adw-id`);
}

function resolveInput(input: string): Either<string, ResolvedInput> {
  return resolveInputFrom(input, AGENTS_DIR, SPECS_DIR);
}

// ---------------------------------------------------------------------------
// appendFindingsToSpec — side effect on GAPS
// ---------------------------------------------------------------------------

function appendFindingsToSpec(specPath: string, verdict: AuditVerdict, clock: () => Date = () => new Date()): TaskEither<string, void> {
  return TaskEither.tryCatch(async () => {
    const content = readFileSync(specPath, "utf8");
    const timestamp = clock().toISOString();
    const lines: string[] = [];
    lines.push(``);
    lines.push(`## Audit findings (adw-patch-review ${timestamp})`);
    lines.push(``);
    lines.push(`**Verdict:** ${verdict.verdict}`);
    lines.push(``);
    lines.push(`${verdict.summary}`);
    lines.push(``);

    if (verdict.criteria.length > 0) {
      lines.push(`### Criteria`);
      for (const c of verdict.criteria) {
        lines.push(`- **${c.criterion}** — ${c.status}: ${c.evidence}`);
      }
      lines.push(``);
    }
    if (verdict.tests.length > 0) {
      lines.push(`### Tests`);
      for (const t of verdict.tests) {
        lines.push(`- **${t.behavior}** — ${t.status}: ${t.evidence}`);
      }
      lines.push(``);
    }
    if (verdict.edge_cases.length > 0) {
      lines.push(`### Edge cases`);
      for (const e of verdict.edge_cases) {
        lines.push(`- **${e.case}** — ${e.status}: ${e.evidence}`);
      }
      lines.push(``);
    }

    writeFileSync(specPath, content + lines.join("\n") + "\n");
  }, (e) => `appendFindingsToSpec: ${(e as Error).message}`);
}

// ---------------------------------------------------------------------------
// Pipeline types
// ---------------------------------------------------------------------------

interface Seed {
  id: string;
  model: string;
  input: string;
  idOverride?: string;
}

interface Resolved extends Seed {
  specPath: string;
  source: "path" | "adw-id";
  diffBase?: string;
  worktreePath?: string;
  orchestratorEventsFile?: string;
}

/** Result of a successful patch-review run. */
export interface PatchReviewOutcome {
  id: string;
  verdict: "pass" | "gaps";
  specPath: string;
}

// ---------------------------------------------------------------------------
// runPatchReview — composed pipeline
// ---------------------------------------------------------------------------

export function runPatchReview(
  input: string,
  modelOverride?: string,
  id?: string,
): Promise<Either<string, PatchReviewOutcome>> {
  const deps: PatchReviewerDeps = { run, runRaw, runCapture };
  return runPatchReviewWithDeps(input, { modelOverride, id, deps });
}

interface PatchReviewOptions {
  modelOverride?: string;
  id?: string;
  deps?: PatchReviewerDeps;
}

export function runPatchReviewWithDeps(
  input: string,
  options: PatchReviewOptions,
): Promise<Either<string, PatchReviewOutcome>> {
  const writePhase = (line: string): void => {
    try { process.stderr.write(line); } catch { /* best-effort */ }
  };
  const baseDeps: PatchReviewerDeps = options.deps ?? { run, runRaw, runCapture };
  const deps: PatchReviewerDeps = {
    ...baseDeps,
    runCapture: withClaude529Retry(baseDeps.runCapture, {
      onRetry: ({ attempt, maxRetries, delayMs }) => {
        writePhase(`[patch-review] claude 529 rate_limit; retry ${attempt}/${maxRetries} in ${Math.round(delayMs / 1000)}s\n`);
      },
    }),
  };

  const ownsState = process.env.ADW_ORCHESTRATED !== "1";

  // ── Hoisted: resolve input BEFORE minting the id ────────────────────────
  // (Was Step 0b inside the pipeline; now runs first so spec-anchored discovery
  //  can use the resolved specPath. Failures here exit before any agents/ dir
  //  is created.)
  const resolvedInput = resolveInput(input);
  if (Either.isLeft(resolvedInput)) return Promise.resolve(resolvedInput);

  // Select id: explicit --id > adw-id input > discovered workspace > fresh mint.
  // Discovery reuses the most recent existing workspace for this spec so logs
  // collect in one place. Skipped when orchestrated (orchestrator passes --id).
  const isAdwId = ADW_ID_RE.test(input);
  const hints = options.id ? readWorkspaceHints(options.id) : isAdwId ? readWorkspaceHints(input) : {};
  let runId: string;
  if (options.id) {
    runId = options.id;
  } else if (isAdwId) {
    runId = input;
  } else if (ownsState) {
    const discovered = findWorkspaceBySpecPath(AGENTS_DIR, resolvedInput.right.specPath);
    runId = discovered ?? adwId();
    if (discovered) {
      process.stderr.write(`adw-patch-review: reusing workspace ${discovered} for ${resolvedInput.right.specPath}\n`);
    }
  } else {
    runId = adwId();
  }

  const recordState = (stateId: string, state: Record<string, unknown>): TaskEither<string, void> =>
    ownsState ? writeState(stateId, state) : TaskEither.right<void, string>(undefined);

  // §C2: best-effort stderr writer for patch-review phase markers. Wraps
  // process.stderr.write in try/catch so a closed stderr never crashes the
  // iteration. The orchestrator inherits the child's stderr, so these lines
  // appear in the tmux window the operator is watching without any orchestrator
  // change.

  // currentReview is set immediately since resolution already happened above.
  const currentReview: Resolved = {
    id: runId,
    model: options.modelOverride ?? PATCH_REVIEW_MODEL,
    input,
    idOverride: options.id,
    specPath: resolvedInput.right.specPath,
    source: resolvedInput.right.source,
    diffBase: resolvedInput.right.diffBase ?? hints.baseSha,
    worktreePath: hints.worktreePath,
    orchestratorEventsFile: hints.orchestratorEventsFile,
  };

  // SPEC-065: ADW_WORKTREE is the orchestrator's per-run sibling worktree path.
  // Gather/audit/gates run inside the worktree when orchestrated; standalone
  // falls back to PROJECT_ROOT and behaves exactly as before.
  const cwd = process.env.ADW_WORKTREE ?? currentReview.worktreePath ?? PROJECT_ROOT;

  const program = TaskEither
    .right<Resolved, string>(currentReview)
    // Step 0: dependency guard — claude on PATH.
    .flatMap((s) => ensureAvailable(deps, cwd).map(() => s))
    // Step 1: write initial state + start event.
    .flatMap((ctx) => recordState(ctx.id, {
      adw_id: ctx.id,
      spec_path: ctx.specPath,
      source: ctx.source,
      model: ctx.model,
      status: "running",
      ...(ctx.diffBase ? { diff_base: ctx.diffBase } : {}),
    })
      .tap(() => appendEvent(ctx.id, "patch-reviewer", {
        event: "start",
        spec_path: ctx.specPath,
        source: ctx.source,
        model: ctx.model,
        diff_base: ctx.diffBase ?? null,
      }))
      .map(() => ctx))
    // Step 2: gather context (spec + diff + untracked).
    .flatMap((ctx) => {
      writePhase(`[patch-review] gather (git diff + ls-files)\n`);
      const gatherFile = join(AGENTS_DIR, ctx.id, "patch-reviewer", "gather.md");
      return gatherContext(deps, cwd, ctx.specPath, ctx.diffBase, {
        worktreePath: ctx.worktreePath,
        orchestratorEventsFile: ctx.orchestratorEventsFile,
      })
        .tap((gather: GatherBundle) => appendEvent(ctx.id, "patch-reviewer", {
          event: "gather",
          spec_path: ctx.specPath,
          diff_base: gather.diffBase ?? ctx.diffBase ?? null,
          files_changed: gather.filesChanged,
          ...(gather.gitWarning ? { git_warning: gather.gitWarning } : {}),
        }))
        .flatMap((gather: GatherBundle) => writeGatherBundle(gatherFile, renderGatherBundle(ctx.specPath, gather))
          .tap(() => appendEvent(ctx.id, "patch-reviewer", {
            event: "gather_written",
            path: `agents/${ctx.id}/patch-reviewer/gather.md`,
          }))
          .map(() => ({ ...ctx, gather, gatherFile })));
    })
    // Step 3: run gates (typecheck + tests). §C2: phase callback emits one
    // stderr line per gate transition so the operator can see the iteration
    // progressing through typecheck → unit → (optional) tmax-use, which are
    // the longest silent stretches (each gate emits no stream-json).
    .flatMap((ctx: Resolved & { gather: GatherBundle; gatherFile: string }) => runGates(deps, cwd, {
      onPhase: (phase, command) => writePhase(`[patch-review] ${phase} (${command})\n`),
    })
      .tap((gates: GateResults) => appendEvent(ctx.id, "patch-reviewer", {
        event: "gates",
        gates_failed: !gates.typecheck.ok || !gates.unit.ok,
        typecheck: { ok: gates.typecheck.ok, exit_code: gates.typecheck.exitCode },
        unit: { ok: gates.unit.ok, exit_code: gates.unit.exitCode },
      }))
      .map((gates: GateResults) => ({ ...ctx, gates })))
    // Step 4: update gather bundle with gate output.
    .flatMap((ctx: Resolved & { gather: GatherBundle; gatherFile: string; gates: GateResults }) => {
      const markdown = renderGatherBundle(ctx.specPath, ctx.gather, ctx.gates);
      return writeGatherBundle(ctx.gatherFile, markdown)
        .tap(() => appendEvent(ctx.id, "patch-reviewer", {
          event: "gather_updated",
          path: `agents/${ctx.id}/patch-reviewer/gather.md`,
        }))
        .map(() => ctx);
    })
    // Step 5: audit — dispatch claude -p.
    .flatMap((ctx: Resolved & { gather: GatherBundle; gates: GateResults; gatherFile: string }) => {
      const auditorLog = join(AGENTS_DIR, ctx.id, "patch-reviewer", "raw-output.jsonl");
      const verdictFile = join(AGENTS_DIR, ctx.id, "patch-reviewer", "verdict.json");
      writePhase(`[patch-review] audit (claude /audit against spec + diff)\n`);
      return audit(deps, cwd, ctx.specPath, ctx.gather, ctx.gates, auditorLog, verdictFile, ctx.model)
        .tap(() => appendEvent(ctx.id, "patch-reviewer", {
          event: "audit",
          status: "ok",
          verdict_file: `agents/${ctx.id}/patch-reviewer/verdict.json`,
        }))
        .map((verdict: AuditVerdict) => ({ ...ctx, verdict }));
    })
    // Step 6: branch on verdict — PASS or GAPS.
    .flatMap((ctx: Resolved & { gather: GatherBundle; gates: GateResults; verdict: AuditVerdict }): TaskEither<string, PatchReviewOutcome> => {
      const gatesFailed = !ctx.gates.typecheck.ok || !ctx.gates.unit.ok;
      if (ctx.verdict.verdict === "pass") {
        appendEvent(ctx.id, "patch-reviewer", {
          event: "result",
          verdict: "pass",
          spec_path: ctx.specPath,
          gates_failed: gatesFailed,
        });
        return recordState(ctx.id, {
          adw_id: ctx.id,
          spec_path: ctx.specPath,
          source: ctx.source,
          model: ctx.model,
          status: "pass",
          ...(ctx.diffBase ? { diff_base: ctx.diffBase } : {}),
          verdict: "pass",
        }).map(() => ({
          id: ctx.id,
          verdict: "pass" as const,
          specPath: ctx.specPath,
        }));
      }

      // GAPS — append findings to spec, record gaps state.
      return appendFindingsToSpec(ctx.specPath, ctx.verdict)
        .tap(() => appendEvent(ctx.id, "patch-reviewer", {
          event: "result",
          verdict: "gaps",
          spec_path: ctx.specPath,
          gates_failed: gatesFailed,
        }))
        .flatMap(() => recordState(ctx.id, {
          adw_id: ctx.id,
          spec_path: ctx.specPath,
          source: ctx.source,
          model: ctx.model,
          status: "gaps",
          ...(ctx.diffBase ? { diff_base: ctx.diffBase } : {}),
          verdict: "gaps",
        }).map(() => ({
          id: ctx.id,
          verdict: "gaps" as const,
          specPath: ctx.specPath,
        })));
    });

  // Run the pipeline.
  return program.run().then((result) => {
    if (Either.isLeft(result)) {
      if (currentReview) {
        appendEvent(currentReview.id, "patch-reviewer", { event: "error", detail: result.left });
        return recordState(currentReview.id, {
          adw_id: currentReview.id,
          spec_path: currentReview.specPath,
          source: currentReview.source,
          model: currentReview.model,
          status: "failed",
        }).run().then(() => Either.left(result.left));
      }
      return Either.left(result.left);
    }
    return Either.right(result.right);
  });
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

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

  return runPatchReview(parsed.right.input, parsed.right.model, parsed.right.id).then((result) => {
    if (Either.isLeft(result)) {
      process.stderr.write(`Error: ${result.left}\n`);
      return 2;
    }
    process.stdout.write(`${result.right.id} ${result.right.verdict} ${result.right.specPath}\n`);
    return 0;
  });
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
