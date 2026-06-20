# CHORE-30: adw-build.ts — spec → implementation dispatcher (claude-driven)

**Status:** pending
**Date:** 2026-06-18
**Depends on:** CHORE-26 (agent module pattern), CHORE-29 (state/events split)

## Problem

The adw pipeline has two stages wired up:

1. **Plan** (`adw-plan.ts`) — description → spec (via `claude -p /feature|bug|chore`)
2. **Review** (`adw-spec-review.ts`) — spec → reviewed spec (via `codex`)

The third stage — **implement** — is missing. There is no dispatcher that takes a spec (by path or adw-id) and drives `claude -p /implement` against it, tracking state and streaming events the same way plan and review do. Today, running the implement stage is a manual step (a human invokes the `/implement` skill by hand in an interactive claude session), which breaks the adw-id traceability chain: there is no `agents/{adw-id}/builder/` record tying an implementation back to the spec that produced it.

## Solution

Add `adws/adw-build.ts` — the implement dispatcher. It mirrors the structure of `adw-plan.ts` and `adw-spec-review.ts` exactly:

- Takes `<adw-id>` or `<spec-path>` as input (same resolution rule as `adw-spec-review.ts`).
- Mints its own adw-id (the build run, not the spec's original id).
- Invokes `claude -p --model glm-5.1 --verbose --output-format stream-json "/implement <spec-path>"`.
- Streams lifecycle events to `agents/{build-id}/builder/events.jsonl`.
- Writes state to `agents/{build-id}/adw-state.json` (state only — no events, per CHORE-29).
- Prints `<build-id> <spec-path>` to stdout on success (the same `<id> <path>` contract as the other two dispatchers).
- Captures `git rev-parse HEAD` after the run and records it as `base_sha` — the completion-time HEAD. This is the base on top of which `/implement` made its edits, **not** a record of those edits (the `/implement` skill does not commit; see D6).

Plus a new LLM-interface module `adws/adws-modules/builder.ts` — the claude-side of the build, extracted for the same reasons `agent.ts` and `reviewer.ts` exist (DI of subprocess plumbing, unit-testable, separation of LLM I/O from CLI/state layer).

### Scope boundary (locked)

**`adw-build.ts` owns** (the CLI/state layer — NOT LLM logic):
- `USAGE`, `parseArgs()`, exit codes, stdout/stderr discipline.
- `adwId()`, `appendEvent()`, `writeState()` — start from `adw-spec-review.ts`'s implementation, but keep filesystem roots/helper functions injectable so tests can write to fixture `agentsDir` paths instead of real `agents/` state.
- `run()` / `runCapture()` — generic subprocess plumbing, copied verbatim.
- `resolveInput()` — adw-id → spec-path resolution (reads `agents/{id}/adw-state.json`'s `spec_path`), copied from `adw-spec-review.ts`.
- `main()` — the composed `TaskEither` pipeline.
- Post-build: best-effort `git rev-parse HEAD` capture for `base_sha`.
- It imports `BUILD_MODEL` from `adws/adws-modules/builder.ts`; it does not define a second default.

**`adws/adws-modules/builder.ts` owns** (the LLM interface — no CLI, no state):
- `CLAUDE`, `BUILD_MODEL` constants.
- `ensureAvailable()` — dependency guard for the `claude` binary, implemented as a real subprocess probe (`claude --version`) through injected deps.
- `build()` — the single `claude -p /implement` invocation. Takes injected `runCapture` deps, the cwd, the spec path, and the builder-log tee target. Returns `TaskEither<string, BuildResult>`.
- `BuildResult` type — `{ rawOutputPath: string; summary: string }` (the path to the streamed output plus the final `/implement` result text). Success is determined by scanning backward for the final parseable `stream-json` `result` event, not by process exit alone: `subtype` must be `"success"` and `is_error` must be `false`. No spec-file diffing is needed (unlike `dispatch` in agent.ts, which looks for a new file in `docs/specs/`).

**Stays in `adw-build.ts`** (NOT extracted):
- Everything from the "adw-build.ts owns" list above.
- The git SHA capture — it's run-state/traceability, not LLM I/O.

### Design decisions (locked)

#### D1: Default model is `glm-5.1`, NOT `glm-5.2[1m]`

This is a deliberate divergence from `adw-plan.ts` (which pins `glm-5.2[1m]`). Rationale:

| Factor | `glm-5.2[1m]` | `glm-5.1` |
|---|---|---|
| Context window | 1M tokens | 200K tokens |
| API price (in/out per M) | $1.40 / $4.40 | $1.40 / $4.40 (same) |
| Model health on api.z.ai | ❌ hangs silently (per `agent.ts` comment, 2026-06-17) | ⚠️ intended lower-risk default; general-API default, but not re-verified since 2026-06-17 |
| Coding Plan rate-limit burn | fast (1M window → bigger calls) | slow (200K window → smaller calls) |

The builder is the **worst-case workload for 5.2**, for two compounding reasons:

1. **Stability is paramount.** A planner run is one shot — if 5.2 hangs you lose ~30s. A builder run is 10–30+ minutes of cumulative edits, test runs, and fixes. A hang mid-implementation is catastrophic: partial edits, no clean resume point, corrupted working tree. 5.1 is still the intended default because it is the general-API default and avoids the known 5.2 gateway failure, but do not describe it as confirmed stable unless a bounded live check re-verifies it during implementation.

2. **Rate limits punish large-context calls.** Coding Plan limits are enforced as prompts per 5-hour rolling cycle (Lite: 120, Pro: 600, Max: higher). A builder run easily consumes 50–150 prompts. With 5.2's 1M window each prompt carries more tokens and the metering burns faster in practice. 200K is enough for ~95% of single-spec implementations (bounded file set, not the whole repo), so 5.1 stretches the cycle further.

**Reserve 5.2 for the rare case** where a single spec genuinely needs >200K of accumulated context (huge cross-cutting feature). Make it an explicit `--model` override, not the default.

#### D2: `--model` override flag

`adw-build.ts` accepts `--model <id>` to override `BUILD_MODEL`. The single default lives in `adws/adws-modules/builder.ts` as `BUILD_MODEL = "glm-5.1"`, and `adw-build.ts` imports that value when no override is provided. This lets the rare huge-spec case opt into 5.2 (or anything else) without changing code.

#### D3: Extract `builder.ts` even though it's a single LLM call

The implement invocation is simpler than `agent.ts` (which has classify + dispatch) or `reviewer.ts` (which has review + upgrade). It is one `claude -p` call. Extracting it to a module could look like over-engineering.

The justification is **consistency + testability**, not present-tense complexity:
- Every other `adw-*` CLI has an `adws-modules/*` peer (`adw-plan` → `agent.ts`, `adw-spec-review` → `reviewer.ts`). Inverting the pattern for `adw-build` would be the surprising choice.
- DI of subprocess deps means `ensureAvailable()` and `build()` are unit-testable with mocks that return canned probe/build output — important since a real `/implement` run takes 10–30+ minutes and mutates the working tree.
- If the builder grows a second stage later (e.g. "verify" — run typecheck/tests after implement), it has a natural home.

If, during implementation, `builder.ts` ends up as just a 5-line wrapper around `runCapture`, **flag it in the PR** — at that point inlining into `adw-build.ts` becomes defensible and the extraction can be reverted. The default is to extract; the override is to inline if it's trivially thin.

#### D4: Parse `/implement` result, but do not spec-diff (unlike `dispatch`)

`agent.ts`'s `dispatch()` snapshots `docs/specs/` before and after to detect the new spec file — because planning's file-change outcome matters. The builder's file-change outcome is different: `/implement` edits code across the repo, so there is no single "appeared file" to look for.

The builder's success signal is the skill's final `stream-json` result event, not just the `claude` process exit code. `build()` must parse `raw-output.jsonl` after `runCapture()` by scanning backward for the last parseable JSON line whose `type` is `"result"`; malformed trailing lines and unrelated parseable non-result lines are ignored while scanning. It only returns success when that final parseable result event reports `subtype === "success"` and `is_error === false`. If no parseable result event exists, or the final parseable result event has another subtype or reports `is_error !== false`, return `TaskEither.left(...)`. This matches the guard already added in `adws/adws-modules/agent.ts`; relying only on process exit can incorrectly record a failed `/implement` skill run as `completed`.

#### D5: No automatic typecheck/test verification post-build

Considered and rejected. Different specs need different verification (some touch T-Lisp, some touch the renderer, some touch the daemon). Hard-coding `bun run typecheck` into the builder would be wrong for some specs and insufficient for others. The `/implement` skill already self-verifies as part of its workflow. The builder's job is to drive the skill and record what happened, not to second-guess it. A separate `adw-verify.ts` stage (out of scope here) could do post-build verification if wanted later.

#### D6: `base_sha`, not `commit_sha` — `/implement` does not commit

The original draft of this spec called the git field `commit_sha` and implied the full diff was recoverable via `git show <commit_sha>`. That was wrong. The `/implement` skill (`.zcode/skills/implement/SKILL.md`) edits the working tree but does **not** run `git commit`. So `git rev-parse HEAD` after a build returns the *pre-existing* HEAD — the base on top of which `/implement` made its uncommitted edits — not a commit containing the implementation. `git show <sha>` would therefore show the wrong thing (the base commit, not the work just done).

The field is therefore `base_sha`: **the repository HEAD at completion time — the base on top of which `/implement` made its (uncommitted) edits.** The actual record of what `/implement` changed is the truncated `diff_stat` in the `result` event plus the full `git diff` that exists in the working tree immediately after the run (recoverable only until the next `git checkout`/`git stash`), plus the raw `/implement` stream-json in `raw-output.jsonl`. If a future spec wants the implementation diff durably stored, that's a separate concern (commit-on-success in an `adw-verify.ts`, or `git diff > agents/{id}/builder/working.diff`).

## Relevant Files

### New Files

- **`adws/adw-build.ts`** — The CLI/state layer. Mirrors `adw-spec-review.ts`'s structure (parseArgs, resolveInput, run/runCapture, appendEvent/writeState, main pipeline). New surface: `--model` flag, imported `BUILD_MODEL` default from `builder.ts`, git SHA capture in the result step.
- **`adws/adws-modules/builder.ts`** — The LLM interface. Exports `BUILD_MODEL`, `BuildResult`, `build`, `ensureAvailable`, `BuilderDeps`. Imports canonical `TaskEither` from `../../src/utils/task-either.ts`. No `main()`, no argv, no `appendEvent`/`writeState` — purely the `claude` dependency guard, clean raw-output log initialization, `claude -p /implement` call, and final stream-json result parsing.
- **`test/unit/adws-builder.test.ts`** — Deterministic tests for the builder module using fake subprocess deps. Must validate command construction, raw-output initialization, dependency-guard behavior, and final result parsing without invoking live `/implement`.
- **`test/unit/adw-build.test.ts`** — Deterministic tests for exported pure/testable helpers and the composed successful pipeline from `adw-build.ts`, including CLI parsing, input resolution, best-effort git capture failure, completed-state writing, lifecycle events, and stdout. Must not invoke live `claude`, live `git`, or mutate real `agents/` state.

### Existing Files to Read (reference, not modify)

- **`adws/adw-spec-review.ts`** — The closest structural template. Copy `parseArgs` shape (single `<input>` arg), `resolveInput` (adw-id → spec_path via `adw-state.json`), and the `run`/`runCapture`/`appendEvent`/`writeState`/`adwId` shapes, while parameterizing roots/helpers where needed for deterministic tests.
- **`adws/adws-modules/agent.ts`** — The `AgentDeps` interface and the `dispatch()` function are the template for `BuilderDeps` and `build()`. Note `dispatch` does spec-dir diffing that `build` does NOT need (see D4).
- **`adws/adws-modules/reviewer.ts`** — Confirms the `TaskEither`-returning, DI-of-deps convention established by CHORE-28/29.
- **`.zcode/skills/implement/SKILL.md`** — The skill being invoked. Note it already produces a report (`git diff --stat` + bullet summary) as part of its output — the builder doesn't need to synthesize this.
- **`src/utils/task-either.ts`** — Canonical `Either`/`TaskEither`. **Critical API notes** (from CHORE-28 learnings):
  - Static methods have FLIPPED generics: `TaskEither.right<R, L>` (R first) vs the class `TaskEither<L, R>` (L first).
  - `TaskEither.tryCatch(f, onError)` takes 2 args (try fn + error mapper), and `f` must return `Promise<R>`.
  - Use `TaskEither.fromSync(f, onError)` for synchronous filesystem setup such as creating/truncating `raw-output.jsonl`.
  - `Either.tryCatch(f)` takes 1 arg (just the try fn).

### Existing Files to Modify

- **`docs/specs/index.md`** — Add CHORE-30 to the spec index (if the index is manually maintained; check first).
- **`tsconfig.json`** — `adws/**/*` is already in `include` (added in CHORE-26), so the new files will be typechecked automatically. No change expected; verify.

## File layout per run

```
agents/{build-id}/
  adw-state.json              # { adw_id, spec_path, source, model, status, base_sha? }
  builder/
    events.jsonl              # start, dispatch, result (or error) — streamed
    raw-output.jsonl          # claude /implement stream-json output — streamed
```

Note: `{build-id}` is a NEW adw-id minted by this run. It is NOT the spec's original plan-id. The link between them is `spec_path` (the build resolves the spec, then records its own id). This matches how `adw-spec-review.ts` mints its own id even when reviewing a spec produced by a prior plan run.

## State shape

### `adw-build.ts` `adw-state.json`

| Field | Type | Description |
|-------|------|-------------|
| `adw_id` | string | This build run's 10-char ULID timestamp |
| `spec_path` | string | Absolute path to the spec being implemented |
| `source` | `"path"\|"adw-id"` | How the spec was resolved (direct path vs adw-id lookup) |
| `model` | string | The model used (e.g. `"glm-5.1"`) — records the actual model, not just the default |
| `status` | `"running"\|"completed"\|"failed"` | Final status |
| `base_sha`? | string | `git rev-parse HEAD` at completion time when git capture succeeds (omitted while running, on failure, or when the best-effort git capture fails). This is the base on top of which `/implement` made its uncommitted edits — **not** a commit containing the work (the `/implement` skill does not commit; see D6). |

## Event schema

### `builder/events.jsonl`

Each line is `{ ts: ISO, event: string, ...eventFields }`.

| event | Fields |
|-------|--------|
| `start` | `spec_path`, `source`, `model` |
| `dispatch` | `skill: "implement"`, `status: "ok"`, `exit_code` |
| `result` | `base_sha?`, `diff_stat?` (truncated to ~400 chars when present), `summary` (the `/implement` result text from `BuildResult.summary`, truncated to a bounded size such as 1000 chars) |
| `error` | `detail` |

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Create `adws/adws-modules/builder.ts`

Model it on the `dispatch()` function in `agent.ts`, but simpler (no spec-dir diffing — see D4). Start with the module header comment, imports, and the exported surface.

```ts
/**
 * builder.ts — the LLM interface for the adw implement dispatcher.
 *
 * Owns the single `claude -p /implement` call. No CLI, no argv, no run-state
 * tracking — those live in the caller (adw-build.ts).
 *
 * Subprocess execution is injected (the runCapture callback) so this module
 * has no direct dependency on child_process and is unit-testable with a mock.
 */
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const CLAUDE = "claude";
// Default implement model. Deliberately NOT glm-5.2[1m] (which adw-plan.ts uses):
// 5.2 hangs silently on api.z.ai as of 2026-06-17, and implementation runs are
// long (10–30+ min) where a hang is catastrophic (partial edits, no resume).
// 5.1 is the intended 200K-context default — enough for ~95% of single-spec
// implementations, and burns the Coding Plan rate limit slower than 5.2.
// It is not currently re-verified as stable; see the model-risk note below.
// Override per-run with `adw-build.ts --model <id>` for the rare huge-spec case.
export const BUILD_MODEL = "glm-5.1";

export interface BuildResult {
  rawOutputPath: string;  // agents/{id}/builder/raw-output.jsonl
  summary: string;
}

export interface BuilderDeps {
  run: (cmd: string, args: string[], opts: { cwd?: string }) => TaskEither<string, string>;
  runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string }) => TaskEither<string, string>;
}

export function ensureAvailable(deps: BuilderDeps, cwd: string): TaskEither<string, void> {
  return deps.run(CLAUDE, ["--version"], { cwd }).map(() => undefined);
}

interface SkillResult {
  ok: boolean;
  summary: string;
}

const MISSING_RESULT = Symbol("__missing__");

function parseSkillResult(builderLog: string): Either<string, SkillResult> {
  const raw = Either.tryCatch(() => {
    const content = readFileSync(builderLog, "utf8");
    const lines = content.split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(lines[i]) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (obj?.type !== "result") continue;
      return {
        ok: obj.subtype === "success" && obj.is_error === false,
        summary: typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result ?? ""),
      } as SkillResult;
    }
    return MISSING_RESULT;
  });

  if (Either.isLeft(raw)) {
    return Either.left(`build: failed to read builder log: ${(raw.left as Error).message}`);
  }
  if (raw.right === MISSING_RESULT) {
    return Either.left("build: skill produced no parseable result line in the builder log");
  }
  return Either.right(raw.right);
}

export function build(
  deps: BuilderDeps,
  cwd: string,
  specPath: string,
  builderLog: string,  // full path: agents/{id}/builder/raw-output.jsonl
  model: string = BUILD_MODEL,
): TaskEither<string, BuildResult> {
  // Ensure the raw-output log's dir exists and start every run with a clean file.
  return TaskEither.fromSync(
    () => {
      mkdirSync(dirname(builderLog), { recursive: true });
      writeFileSync(builderLog, "");
    },
    (error) => `build: failed to initialize builder log: ${error instanceof Error ? error.message : String(error)}`,
  ).flatMap(() =>
    deps.runCapture(
      CLAUDE,
      ["-p", "--model", model, "--verbose", "--output-format", "stream-json", `/implement ${specPath}`],
      { cwd, teeTo: builderLog },
    ).flatMap(() => {
      const skillRes = parseSkillResult(builderLog);
      if (Either.isLeft(skillRes)) return TaskEither.left(skillRes.left);
      if (!skillRes.right.ok) {
        return TaskEither.left(`build: skill reported failure: ${skillRes.right.summary.slice(0, 300)}`);
      }
      return TaskEither.right({ rawOutputPath: builderLog, summary: skillRes.right.summary });
    })
  );
}
```

- Verify: `bun -e 'import "./adws/adws-modules/builder.ts"'` resolves without error.
- Verify: `rg -n 'appendEvent|writeState|AGENTS_DIR|adw-state\.json' adws/adws-modules/builder.ts` returns **zero matches** — no state tracking in the builder module (same rule as agent.ts/reviewer.ts).
- Verify with a fake `BuilderDeps`: `ensureAvailable()` calls `claude --version`, and `build()` creates `dirname(builderLog)`, truncates `raw-output.jsonl`, calls `claude -p --model <model> --verbose --output-format stream-json "/implement <spec-path>"`, parses the final result line, and returns `{ rawOutputPath, summary }` without a live LLM run. Also verify raw-output initialization failures return `TaskEither.left(...)` and do not call `runCapture()`.

### Task 2 — Create `adws/adw-build.ts` (CLI layer)

Copy the structural skeleton from `adw-spec-review.ts`. Copy or adapt these pieces as follows:
- `run()`, `runCapture()` — these are identical across plan/spec-review; copy from spec-review.
- `adwId()`, `appendEvent()`, `writeState()` — copy the behavior and data shapes from spec-review, but make the roots/helper calls injectable (for example by accepting `roots.agentsDir` or wrapping them in pipeline deps) so tests can use fixture `agentsDir` paths and never mutate real `agents/`.
- `resolveInput()` — same adw-id-vs-path logic, returns `{ specPath, source }`. Export it and allow tests to pass fixture roots (for example `resolveInput(input, { projectRoot, agentsDir })`) so path and adw-id behavior can be validated without touching real `agents/` state.

New/changed pieces:

**`parseArgs`** — accept an optional `--model <id>` flag in addition to the positional `<input>`:

```ts
interface ParsedArgs {
  input: string;
  model?: string;
}

export function parseArgs(argv: string[]): Either<string, ParsedArgs> {
  let input = "";
  let model: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return Either.left(`__help__:${USAGE}`);
    else if (a === "--model") {
      if (++i >= argv.length) return Either.left("--model requires a value.");
      model = argv[i];
    }
    else if (input === "") input = a;
    else return Either.left(`Unexpected extra argument: ${a}`);
  }
  if (!input) return Either.left(`__usage__:${USAGE}`);
  return Either.right({ input, model });
}
```

**`USAGE`** — document the `<spec-path-or-adw-id>` input, the `--model` flag, and the file layout.

**Injectable pipeline for deterministic tests** — `main()` may remain the real CLI entrypoint, but the composed implementation path must be exported as `runPipeline(parsed, deps, roots, io)`. The test harness must be able to fake `ensureAvailable`, `build`, `runGit`, `adwId`, `agentsDir`, stdout, and stderr without invoking live `claude`, live `git`, or mutating real `agents/` state. Use this shape consistently:

```ts
export interface RunPipelineDeps {
  ensureAvailable: (builderDeps: BuilderDeps, cwd: string) => TaskEither<string, void>;
  build: (
    builderDeps: BuilderDeps,
    cwd: string,
    specPath: string,
    builderLog: string,
    model: string,
  ) => TaskEither<string, BuildResult>;
  builderDeps: BuilderDeps;
  runGit: (cmd: string, args: string[], opts: { cwd: string }) => TaskEither<string, string>;
  adwId: () => string;
}

export interface RunPipelineRoots {
  projectRoot: string;
  agentsDir: string;
}

export interface RunPipelineIO {
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}

const realPipelineDeps: RunPipelineDeps = {
  ensureAvailable,
  build,
  builderDeps: { run, runCapture },
  runGit: run,
  adwId,
};

const realPipelineIO: RunPipelineIO = {
  stdout: process.stdout,
  stderr: process.stderr,
};
```

**`main()` pipeline** — the composed `TaskEither` chain. Shape (mirroring spec-review's `main`):

```ts
interface BuildRunContext {
  id: string;
  specPath: string;
  source: "path" | "adw-id";
  model: string;
}

interface CompletedBuildContext extends BuildRunContext {
  buildResult: BuildResult;
}

function appendEventTask(
  agentsDir: string,
  id: string,
  phase: string,
  event: Record<string, unknown>,
): TaskEither<string, void> {
  return TaskEither.fromSync(
    () => appendEvent(agentsDir, id, phase, event),
    (error) => `adw-build: failed to append event: ${error instanceof Error ? error.message : String(error)}`,
  );
}

export function runPipeline(
  parsed: ParsedArgs,
  deps: RunPipelineDeps,
  roots: RunPipelineRoots,
  io: RunPipelineIO,
): Promise<number> {
  let currentBuild: BuildRunContext | null = null;

  const program = TaskEither.from<string, { specPath: string; source: "path" | "adw-id"; model: string }>(async () => {
  // Step 0: resolve input before any live dependency guard so bad ids are
  // deterministic and testable even on machines without claude installed.
    const resolved = resolveInput(parsed.input, roots);
    if (Either.isLeft(resolved)) return Either.left(resolved.left);
    return Either.right({ specPath: resolved.right.specPath, source: resolved.right.source, model: parsed.model ?? BUILD_MODEL });
  })
  // Step 1: dependency guard — still before any state/failure context is written.
  .flatMap((ctx) => deps.ensureAvailable(deps.builderDeps, roots.projectRoot).map(() => ctx))
  // Step 2: mint the build id only after input resolution and dependency
  // checking have succeeded. Bad ids and dependency-guard failures therefore
  // create no build agents/{id}/ directory; the pure string id mint itself has
  // no filesystem side effect.
  .map((ctx) => ({ id: deps.adwId(), ...ctx } as BuildRunContext))
  // Boundary: once input resolution and dependency checking have both succeeded,
  // this build has enough context to record
  // all later failures (state writes, /implement failures, git capture bugs, etc.)
  // as a failed build with spec_path/source/model.
  .tap((ctx: BuildRunContext) => { currentBuild = ctx; })
  .flatMap((ctx) => writeState(roots.agentsDir, ctx.id, { adw_id: ctx.id, spec_path: ctx.specPath, source: ctx.source, model: ctx.model, status: "running" })
    .flatMap(() => appendEventTask(roots.agentsDir, ctx.id, "builder", { event: "start", spec_path: ctx.specPath, source: ctx.source, model: ctx.model }))
    .map(() => ctx as BuildRunContext)
  )
  // Step 3: dispatch to /implement
  .flatMap((ctx) => {
    const builderLog = join(roots.agentsDir, ctx.id, "builder", "raw-output.jsonl");
    return deps.build(deps.builderDeps, roots.projectRoot, ctx.specPath, builderLog, ctx.model)
      .flatMap((buildResult) => appendEventTask(roots.agentsDir, ctx.id, "builder", { event: "dispatch", skill: "implement", status: "ok", exit_code: 0 })
        .map(() => ({ ...ctx, buildResult } as CompletedBuildContext)));
  })
  // Step 4: capture git SHA + diff-stat, record result, finalize state
  .flatMap((ctx) => {
    // Use the best-effort git capture from Task 4 here. Retain
    // ctx.buildResult.summary from Step 3 and git.stat from captureGitTrace().
    // Write completed state with base_sha when git is non-null and without it
    // when git is null. Append the result event with:
    //   - base_sha when available
    //   - diff_stat: git.stat.slice(0, 400) when available
    //   - summary: ctx.buildResult.summary.slice(0, 1000)
    // Then print `<build-id> <spec-path>\n` and return success.
  });
```

Plus the error handler at the bottom. Track `currentBuild` immediately after input resolution and dependency checking have both succeeded, before the initial state write. This is the exact failure-recording boundary:
- Argument errors, unresolved inputs, and dependency-guard failures are setup/input failures: exit 1 and do not create a build `agents/{id}/` directory.
- Failures after dependency checking succeeds are build/runtime failures: exit 2, append an `error` event when possible, and write failed state with `adw_id`, `spec_path`, `source`, and `model` when state writing is available.

```ts
  return program.run().then((result) => {
    if (Either.isLeft(result)) {
      if (currentBuild) {
        const failedState = {
          adw_id: currentBuild.id,
          spec_path: currentBuild.specPath,
          source: currentBuild.source,
          model: currentBuild.model,
          status: "failed" as const,
        };
        return appendEventTask(roots.agentsDir, currentBuild.id, "builder", { event: "error", detail: result.left })
          .run()
          .then(() => writeState(roots.agentsDir, currentBuild.id, failedState).run())
          .then(() => {
            io.stderr.write(`Error: ${result.left}\n`);
            return 2;
          });
      }
      io.stderr.write(`Error: ${result.left}\n`);
      return Promise.resolve(1);
    }
    return 0;
  });
}
```

Exit-code contract:
- `--help` exits 0 and prints usage to stdout.
- Argument errors, unresolved inputs, and dependency-guard failures exit 1 and do not create a build `agents/{id}/` directory.
- Build/runtime failures after dependency checking succeeds exit 2, append an `error` event when possible, and write `adw-state.json` with `status: "failed"` plus `adw_id`, `spec_path`, `source`, and `model` when state writing is available.

Side-effect rule: do not call synchronous `appendEvent()` directly from `TaskEither.tap()`. Wrap event writes with `TaskEither.fromSync(...)` (as `appendEventTask()` above) or an equivalent try/catch boundary so thrown filesystem errors become `TaskEither.left(...)` values and the pipeline still follows the exit-2/error-state path. The only acceptable exception is explicitly documented best-effort cleanup after the process has already decided the final exit code.

- Verify: `bun adws/adw-build.ts --help` prints usage to stdout, exit 0.
- Verify: `bun adws/adw-build.ts` prints usage to stderr, exit 1.
- Verify: `rg -n 'claude|CLAUDE|stream-json|/implement' adws/adw-build.ts` returns **zero matches** — all LLM specifics live in builder.ts (same rule as CHORE-26 Task 4).

### Task 3 — Resolve-input consistency check

`resolveInput(input, roots?)` in `adw-build.ts` must accept the same inputs as `adw-spec-review.ts`'s `resolveInput(input)` — a 10-char adw-id OR a `docs/specs/{SPEC,BUG,CHORE}-*.md` path. Copy the resolution behavior from spec-review, but export this helper and allow optional injected roots for tests:

```ts
export interface ResolveRoots {
  projectRoot: string;
  agentsDir: string;
}

export function resolveInput(
  input: string,
  roots: ResolveRoots = { projectRoot: PROJECT_ROOT, agentsDir: AGENTS_DIR },
): Either<string, { specPath: string; source: "path" | "adw-id" }> {
  // same behavior as adw-spec-review.ts, using roots.projectRoot/roots.agentsDir
}
```

The adw-id branch reads `{roots.agentsDir}/{input}/adw-state.json` and pulls `state.spec_path`.

**Edge case to handle:** if the input is an adw-id whose `adw-state.json` has no `spec_path` field (e.g. it's a plan-run state file that only has `description`/`type`), return a clear error: `adw-id ${input} has no spec_path in its state (was it a plan run? pass the spec path directly)`.

- Verify deterministically in `test/unit/adw-build.test.ts` with a temporary fixture directory, not real `agents/`:
  - direct spec path resolves to an absolute path with `source: "path"`;
  - adw-id state with `spec_path` resolves to that path with `source: "adw-id"`;
  - adw-id state without `spec_path` returns the clear plan-run error above.

### Task 4 — Wire the git SHA capture

The Step 4 `flatMap` runs `git rev-parse HEAD` and `git diff --stat` via the injected `deps.runGit` helper. The real CLI wires `deps.runGit` to the real `run()` helper, while tests must inject a fake. Git capture is best-effort: if git fails, the build should still be recorded as `completed` because `/implement` succeeded, but with `base_sha` omitted and a warning on stderr.

Implement the git capture as a small exported helper in `adw-build.ts` so failure behavior is deterministic under test without invoking live `git`:

```ts
export interface GitTrace {
  sha: string;
  stat: string;
}

export function captureGitTrace(
  runGit: (cmd: string, args: string[], opts: { cwd: string }) => TaskEither<string, string>,
  cwd: string,
  warn: (message: string) => void,
): TaskEither<string, GitTrace | null> {
  return TaskEither.from<string, GitTrace | null>(async () => {
    const gitResult = await runGit("git", ["rev-parse", "HEAD"], { cwd })
      .flatMap((sha) => runGit("git", ["diff", "--stat"], { cwd })
        .map((stat) => ({ sha: sha.trim(), stat })))
      .run();

    if (Either.isLeft(gitResult)) {
      warn(`adw-build: git capture failed (${gitResult.left}); recording build without base_sha.\n`);
      return Either.right(null);
    }

    return Either.right(gitResult.right);
  });
}
```

Because `TaskEither.fold()` returns `Task<T>` in this codebase, do not chain `.fold()` as though it returned `TaskEither`. Use the helper above from this task and continue the pipeline with the returned `TaskEither<string, GitTrace | null>`:

```ts
.flatMap((ctx) => captureGitTrace(deps.runGit, roots.projectRoot, (message) => io.stderr.write(message))
  .flatMap((git) => {
    const completedState = git
      ? { adw_id: ctx.id, spec_path: ctx.specPath, source: ctx.source, model: ctx.model, status: "completed" as const, base_sha: git.sha }
      : { adw_id: ctx.id, spec_path: ctx.specPath, source: ctx.source, model: ctx.model, status: "completed" as const };
    const resultEvent = {
      event: "result",
      ...(git ? { base_sha: git.sha, diff_stat: git.stat.slice(0, 400) } : {}),
      summary: ctx.buildResult.summary.slice(0, 1000),
    };
    return writeState(roots.agentsDir, ctx.id, completedState)
      .flatMap(() => appendEventTask(roots.agentsDir, ctx.id, "builder", resultEvent))
      .map(() => {
        io.stdout.write(`${ctx.id} ${ctx.specPath}\n`);
        return ctx;
      });
  }))
```

The important constraints are that a git-capture failure does not turn a successful `/implement` run into a failed build, and that Step 3's `BuildResult` is carried into Step 4 so the result event records both the truncated `diff_stat` (when git capture succeeds) and the truncated build `summary`.

- Verify deterministically in `test/unit/adw-build.test.ts`: inject a fake `runGit()` where `git rev-parse HEAD` returns `TaskEither.left("git unavailable")`, assert `captureGitTrace()` returns `Right(null)`, and assert the warning text is emitted. Do not rely on running from a non-git directory, because `PROJECT_ROOT` is derived from the script location.
- Verify success path in `test/unit/adw-build.test.ts`: fake `rev-parse` returns `"abc123\n"` and fake `diff --stat` returns `" file.ts | 1 +"`; assert `captureGitTrace()` returns `Right({ sha: "abc123", stat: " file.ts | 1 +" })`.

### Task 5 — Update `docs/specs/index.md` (if maintained)

Check whether `docs/specs/index.md` is a manually-curated list. If it is, add an entry for CHORE-30. If it's auto-generated, skip.

- Verify: `rg -n 'CHORE-30' docs/specs/index.md` (only if the file is manually maintained).

### Task 6 — Add deterministic builder tests

Add focused unit tests for `adws/adws-modules/builder.ts` using fake `BuilderDeps`. These tests must not invoke a live `claude` binary, must not run `/implement`, and must not mutate the working tree.

Required coverage:
- `ensureAvailable(deps, cwd)` calls `deps.run("claude", ["--version"], { cwd })` and returns success when the fake dep succeeds.
- `ensureAvailable(deps, cwd)` returns the fake dep's error when the dependency probe fails.
- `build(deps, cwd, specPath, rawOutputPath, model)` creates the raw-output directory, truncates `rawOutputPath`, calls `deps.runCapture()` with the expected command, args, cwd, and tee target, then returns `{ rawOutputPath, summary }` when the fixture log's final result line is successful.
- `build()` returns `Left` when raw-output initialization fails, and the fake `runCapture()` is not called.
- `build()` uses `BUILD_MODEL` when the caller does not pass `--model`.
- `build()` returns `Left` when the final result line has `subtype !== "success"`.
- `build()` returns `Left` when the final result line has `is_error !== false`.
- `build()` returns `Left` when no parseable `type: "result"` line exists.

- Verify: `bun test test/unit/adws-builder.test.ts` passes without requiring `claude` on PATH.

### Task 7 — Add deterministic `adw-build.ts` helper and pipeline tests

Add focused unit tests for exported pure/testable helpers and the exported composed pipeline from `adws/adw-build.ts`. These tests must not invoke live `claude`, must not invoke live `git`, and must not mutate real `agents/` state.

Required coverage:
- `parseArgs(["--model", "glm-4.7", "docs/specs/CHORE-30-adw-build.md"])` returns the input and model.
- `parseArgs(["--model"])` returns `Left("--model requires a value.")`.
- `resolveInput()` resolves a direct spec path using a temporary `projectRoot`.
- `resolveInput()` resolves a fixture adw-id whose state includes `spec_path`.
- `resolveInput()` returns the required missing-`spec_path` error for a fixture adw-id state without `spec_path`.
- `captureGitTrace()` returns `Right(null)` and emits a warning when fake `git rev-parse HEAD` fails.
- `captureGitTrace()` returns trimmed `sha` plus `diff --stat` text when fake git calls succeed.
- Successful pipeline path with fixture `agentsDir` and fake deps:
  - fake `ensureAvailable()` succeeds;
  - fake `build()` returns a successful `BuildResult`;
  - fake `runGit()` returns a SHA and diff stat;
  - asserted output is exactly `<build-id> <spec-path>\n`;
  - `agents/<build-id>/adw-state.json` has `status: "completed"`, the resolved `spec_path`, `model`, and `base_sha`;
  - `agents/<build-id>/builder/events.jsonl` contains `start`, `dispatch`, and `result` events in order, and the `result` event includes the fake git `diff_stat` truncated to the schema limit plus the fake `BuildResult.summary`.

- Verify: `bun test test/unit/adw-build.test.ts` passes without requiring `claude`, live `git`, or real `agents/` state, and covers the successful composed CLI/pipeline path.

### Task 8 — Run `Validation Commands`

Run every required command in the Static checks section. The live smoke checks are optional because they invoke a mutating `/implement` run.

## Validation Commands

Execute every required static command to validate the chore is complete with zero regressions.

### Static checks (pass regardless of model health)

- `bun run typecheck` — zero TypeScript errors. Critically this **includes** `adws/` (per CHORE-26); confirm `adw-build.ts` and `builder.ts` compile clean.
- `rg -n 'claude|CLAUDE|stream-json|/implement' adws/adw-build.ts` — **zero matches** (all LLM specifics extracted to builder.ts).
- `rg -n 'appendEvent|writeState|AGENTS_DIR|adw-state\.json' adws/adws-modules/builder.ts` — **zero matches** (no state tracking in the builder module).
- `rg -n 'import.*task-either' adws/adw-build.ts adws/adws-modules/builder.ts` — **two matches** (both files use the canonical TaskEither).
- `rg -n 'BUILD_MODEL' adws/adws-modules/builder.ts` — at least one match (the constant is exported).
- `bun test test/unit/adws-builder.test.ts` — deterministic builder-module coverage passes with fake subprocess deps and fixture `raw-output.jsonl`; no live `/implement` run.
- `bun test test/unit/adw-build.test.ts` — deterministic CLI parsing, input-resolution, git-capture, and successful composed pipeline coverage passes with fixture roots/fake subprocess deps; asserts completed state, `base_sha`, result-event `diff_stat`/`summary`, `start`/`dispatch`/`result` events, and `<build-id> <spec-path>` stdout; no live `claude`, live `git`, or real `agents/` mutation.
- `bun adws/adw-build.ts --help` — prints usage to stdout, exit 0.
- `bun adws/adw-build.ts` — prints usage to stderr, exit 1.
- `bun adws/adw-build.ts --model` — error ("--model requires a value."), exit 1.
- `before=$(find agents -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '); BUN="$(command -v bun)" && env PATH="/usr/bin:/bin" "$BUN" adws/adw-build.ts docs/specs/CHORE-30-adw-build.md; status=$?; after=$(find agents -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '); test "$status" -eq 1 && test "$before" = "$after"` — dependency-guard error, exit 1, no new `agents/{id}/` directory. Use the absolute Bun path so the reduced child PATH only hides `claude`, not `bun`.

### Live checks (optional manual smoke; require claude on PATH + healthy model)

⚠️ See the Model availability risk note below before running these.

These are useful end-to-end smoke checks, but they are not required to complete this chore because they invoke a live mutating `/implement` run. The required deterministic validation path is the static checks plus `test/unit/adws-builder.test.ts` and `test/unit/adw-build.test.ts`; the latter must prove the successful composed pipeline writes completed state, appends lifecycle events, captures `base_sha` when fake git succeeds, and prints the success contract.

- `bun adws/adw-build.ts docs/specs/CHORE-29-adw-logging-refactor.md` (or any small already-implemented spec — should be a near-noop / small diff) — prints `<build-id> <spec-path>` to stdout; `agents/<build-id>/adw-state.json` has `status: "completed"` and a `base_sha` equal to the repository HEAD after the run; `agents/<build-id>/builder/events.jsonl` has `start`/`dispatch`/`result` events; `agents/<build-id>/builder/raw-output.jsonl` is non-empty. **Then revert any working-tree changes the run made and delete the `agents/<build-id>/` dir.**
- `bun adws/adw-build.ts --model glm-4.7 docs/specs/CHORE-29-adw-logging-refactor.md` — same as above but the `model` field in state is `"glm-4.7"` (confirms the override flag flows through). Clean up as above.

## Notes

**⚠️ Model availability risk (read before running live smoke checks).** This plan defaults `BUILD_MODEL = "glm-5.1"`. As of the troubleshooting session on 2026-06-17 (documented in `adws/adws-modules/agent.ts`), `glm-5.2[1m]` hangs silently on api.z.ai — `claude -p` exits 124 (timeout) with zero output. `glm-4.7` and `glm-4.5-air` were confirmed working. **The stability of `glm-5.1` specifically has not been re-verified since 2026-06-17** — it may work (it's the general-API default per z.ai docs) or it may share the gateway issue. Consequence: the optional live smoke checks may stall. When implementing:
- Run the static checks first — they validate the refactor is correct regardless of model health.
- For the live smoke test, if `glm-5.1` hangs, use the `--model glm-4.7` override (which was confirmed working) to verify the wiring end-to-end. **Do not change the `BUILD_MODEL` default to `glm-4.7`** — that was a confirmed-working fallback at one point in time, not the desired end-state. The default stays `glm-5.1`; the override exists exactly for this situation.
- If `glm-5.1` is broadly unstable at implementation time, flag it: the right fix is to update `BUILD_MODEL` once 5.1 is confirmed healthy, not to ship 4.7 as the default.

**Why a new adw-id per build run (not reusing the spec's plan-id).** The spec already has an adw-id from its plan run. Why mint a new one for the build? Because each *invocation* of a stage is a distinct tracked run — you might plan once, review twice (after revisions), build three times (after each review cycle). Reusing the plan-id would overwrite `agents/{plan-id}/adw-state.json` and conflate the stages. A fresh id per run keeps each stage's state and events isolated under its own dir, and `spec_path` is the join key between them. This is the same convention `adw-spec-review.ts` already follows.

**Why no automatic typecheck/test verification post-build (D5).** Considered: after `/implement` finishes, run `bun run typecheck` and `bun run test` and record pass/fail in state. Rejected because different specs need different verification — some touch T-Lisp, some the renderer, some the daemon — and a one-size test command would be wrong for some specs and insufficient for others. The `/implement` skill self-verifies as part of its workflow (it runs tests/typecheck as it goes). A separate `adw-verify.ts` stage could do rigorous post-build verification later, as a distinct concern. This chore is "drive the implement skill and record what happened," not "ratify the implementation."

**Why `base_sha` not `commit_sha` — `/implement` does not commit (D6).** The original draft called the git field `commit_sha` and implied the implementation was recoverable via `git show`. That was wrong: the `/implement` skill (`.zcode/skills/implement/SKILL.md`) edits the working tree but does **not** run `git commit`. So `git rev-parse HEAD` after a build returns the pre-existing HEAD — the base on top of which `/implement` made uncommitted edits — not a commit containing the work. `git show <sha>` would show the wrong thing (the base commit, not the work just done). The field is therefore `base_sha`: the repository HEAD at completion time. The honest record of what `/implement` changed is the truncated `diff_stat` in the `result` event plus the full `git diff` that exists in the working tree immediately after the run (recoverable only until the next `git checkout`/`git stash`), plus the raw `/implement` stream-json in `raw-output.jsonl`. If a future spec wants the implementation diff durably stored, that's a separate concern (commit-on-success in an `adw-verify.ts`, or `git diff > agents/{id}/builder/working.diff`).

**Why `git diff --stat` and not full diff in the result event.** The full diff can be large (thousands of lines for a real implementation). The result event stores a 400-char truncation of `--stat` (the file-level summary) — enough to see at a glance what changed. The full diff is intentionally not stored: it's transient (uncommitted — see D6), potentially huge, and the file-level summary plus the on-disk `raw-output.jsonl` are the durable artifacts.

**Builder skill choice: `/implement` not `/feature` or `/bug`.** `adw-plan.ts` dispatches to `/feature`/`/bug`/`/chore` because those are *planning* skills (they write specs). The build stage is past planning — the spec exists — so it dispatches to `/implement`, the skill whose job is "take a plan/spec and execute it." The skill is identified in `.zcode/skills/implement/SKILL.md`.

**Not in scope (explicit non-goals):**
- A verification stage (`adw-verify.ts`) that runs typecheck/tests post-build. Separate chore.
- Chaining the stages into one command (`adw-all` that runs plan → review → build). Separate chore; the adw-id-per-stage convention makes this a composition problem, not a refactoring one.
- Streaming claude's `/implement` output to the terminal in real time (today it's teed to `raw-output.jsonl` only). The `runCapture` helper captures stdout; a future enhancement could mirror it to stdout for interactive use. Out of scope here.
- Parsing the `/implement` report beyond `BuildResult.summary` and the result-event `diff_stat`/`summary` fields into richer structured state. The raw output is preserved on disk; deeper structured parsing is a separate concern.
