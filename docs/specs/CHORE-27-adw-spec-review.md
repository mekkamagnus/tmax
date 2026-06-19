# Chore: `adws/adw-spec-review.ts` — spec → reviewed spec (codex-driven)

## Chore Description

Create a self-contained Bun TypeScript script at `adws/adw-spec-review.ts` that takes a spec (by path or by adw-id) and reviews it, then either **passes** it or **upgrades it in place** as needed, returning the resulting status. This is the review/uplift counterpart to `adw-plan.ts` (which is plan/dispatch) — it uses **codex** instead of claude, but mirrors `adw-plan.ts`'s structure and conventions (argv parsing, adw-id minting, `agents/{adw-id}/adw-state.json` lifecycle log, dependency injection of the subprocess layer, `<adw-id> <result>` stdout contract).

Concretely, for an input like:

```
bun adws/adw-spec-review.ts docs/specs/SPEC-056-browse-url.md
bun adws/adw-spec-review.ts 01KVCMJ0QR          # adw-id → resolve to its spec_path
```

the script will:

1. **Mint an `adw-id`** (first 10 chars of a ULID — same scheme as `adw-plan.ts`) and open `./agents/{adw-id}/adw-state.json`.
2. **Resolve the input** to a concrete spec path:
   - A path arg (`docs/specs/SPEC-056-*.md`) → use directly.
   - An adw-id arg (`01KVCMJ0QR`) → read `agents/{adw-id}/adw-state.json`, extract `spec_path` from its `result` event, use that.
3. **Pass 1 — review (read-only).** Run `codex exec --sandbox read-only --output-schema <review-schema.json>` with a prompt that asks codex to evaluate the spec against a rubric and emit a structured verdict. Capture codex's raw streamed output to `./agents/{adw-id}/reviewer/raw-output.jsonl`.
4. **Branch on the verdict:**
   - `pass` → record `review{status:pass}`, print `<adw-id> pass <spec-path>`, exit 0. No second pass.
   - `fail` (issues found) → **Pass 2 — auto-fix (workspace-write).** Run `codex exec --sandbox workspace-write` instructing it to apply the fixes it identified to the spec file in place. Capture to `./agents/{adw-id}/upgrader/raw-output.jsonl`. Then re-record the outcome.
5. **Print** `<adw-id> <status> <spec-path>` to stdout (status ∈ `pass` | `upgraded` | `unchanged` | `error`).

The script is a thin, deterministic two-pass driver. All review/upgrade intelligence lives in codex (via `codex exec`); the script owns only: argv parsing, adw-id minting, input resolution, the two codex calls, state-log append, and exit-code/error reporting.

### Design decisions (locked from the planning conversation)

- **LLM = codex (NOT claude).** Located at `/Users/mekael/.nvm/versions/node/v24.13.1/bin/codex` (codex-cli 0.137.0). Not on PATH today, so the script resolves it by (a) `command -v codex`, falling back to (b) the known absolute path, then (c) a dependency-guard error if neither works.
- **Model = `gpt-5.5`** (the latest, per OpenAI's codex docs). Pinned via `--model gpt-5.5` on both codex calls so the script never depends on codex's default resolution.
- **Two-pass: review (read-only) → conditional auto-fix (workspace-write).** This matches the "either says passes or it will update it as needed" requirement literally. Pass 1 reviews and emits a structured verdict; if `fail`, Pass 2 applies the fixes codex itself identified. Full autonomy, but two codex calls.
- **Structured verdict via `--output-schema`.** codex's `--output-schema <file>` validates the model's final response against a JSON Schema — this is the mechanism that forces a parseable `{verdict, issues, summary}` shape from Pass 1, far more reliable than parsing free-form prose. (codex's `--json` emits streaming JSONL *events*; `--output-schema` constrains the *final answer* — different things, both useful: we use `--json` to capture the raw stream to the reviewer log, and `--output-schema` to get a machine-readable verdict.)
- **Final-message capture via `-o`/`--output-last-message`.** codex writes its final assistant message to a file we name (`agents/{adw-id}/reviewer/verdict.json` for Pass 1). This is the authoritative artifact for the verdict — more reliable than scraping the streamed JSONL.
- **Mirrors `adw-plan.ts` conventions:** canonical `Either` from `src/utils/task-either.ts`; injected subprocess helpers via a `CodexDeps` interface (so the codex calls are unit-testable with a mock); single-file CLI script + a sibling agent-style module (see Relevant Files); `agents/{adw-id}/adw-state.json` lifecycle log with the same `{adw_id, events:[...]}` shape.

## Relevant Files

Use these files to resolve the chore:

### New Files

- **`adws/adw-spec-review.ts`** — The CLI entry point + state tracker (the deliverable's `adw-plan.ts` analog). Self-contained: no imports beyond Node/Bun built-ins + the canonical `Either`. Shebang `#!/usr/bin/env bun`. Owns: argv parsing, adw-id minting, `logState`, input resolution (path vs adw-id), `main`, the codex dependency guard, stdout/stderr discipline. Does **not** mention `codex exec`, `--sandbox`, `--model`, or the review/upgrade prompts — all of that lives in the module. ~200 lines.

- **`adws/adws-modules/reviewer.ts`** — The codex interface (the deliverable's `agent.ts` analog). Exports `reviewSpec()`, `upgradeSpec()`, `ReviewOutcome`, `ReviewVerdict`, `CodexDeps`. Imports the canonical `Either`. Owns: the `CODEX`/`CODEX_MODEL` constants, the `resolveCodex()` path resolver, the two prompts (REVIEW_PROMPT, UPGRADE_PROMPT), the review JSON Schema (written to a temp file for `--output-schema`), and the two `codex exec` invocations with their flag wiring. No `child_process` import (subprocess execution is injected via `CodexDeps`), no `logState`/`adwId`/`AGENTS_DIR` (state tracking stays in the caller). ~220 lines.

### New runtime artifacts (created per run, gitignored — `agents/` is already in `.gitignore`)

- **`agents/{adw-id}/adw-state.json`** — the run's lifecycle ledger: `{adw_id, events:[...]}` with events `start`, `review{verdict, summary}`, `upgrade{status, ...}` (conditional), `result{kind, spec_path, summary}`, `error{stage, message}`.
- **`agents/{adw-id}/reviewer/raw-output.jsonl`** — codex Pass 1's verbatim `--json` streamed output (one JSONL event per line: `thread.started`/`turn.started`/`item.*`/`turn.completed`/etc.).
- **`agents/{adw-id}/reviewer/verdict.json`** — codex Pass 1's final message, written via `-o`. The authoritative `{verdict, issues, summary}` (validated against `--output-schema`). This is what the script parses to decide pass-vs-fail.
- **`agents/{adw-id}/upgrader/raw-output.jsonl`** — codex Pass 2's verbatim streamed output (only created if Pass 1 verdict was `fail`).

### Existing Files to Read (reference, not modify)

- **`adws/adw-plan.ts`** — The structural template. Mirror its: shebang + header docstring style, `parseArgs` shape, `adwId()` + `logState()` (copy verbatim — these are not "agent logic" specific to claude), `main()` skeleton (guard → mint id → log start → resolve input → call into module → branch on outcome → print `<adw-id> <result>` → exit code), and stdout discipline (only the final result line on stdout; diagnostics to stderr).
- **`adws/adws-modules/agent.ts`** — The module template. Mirror its: `AgentDeps`-style DI interface (rename to `CodexDeps`), canonical `Either` import from `../../src/utils/task-either.ts`, and the discipline of keeping subprocess execution injected + state tracking out of the module. Note the import path is `../../src/utils/task-either.ts` (one level up from `adws-modules/`).
- **`docs/specs/SPEC-056-browse-url.md`** — A representative spec to test against (already exists, real content). The reviewer's rubric should evaluate specs of this shape (Feature/Bug/Chore plan with Description/User Story/Steps/Validation/Notes).
- **`agents/01KVCMJ0QR/adw-state.json`** — Example of the adw-id input format (has a `result` event with `spec_path` and `kind`). This is what "take an adw-id" resolves against.
- **`docs/specs/CHORE-25-adw-plan-dispatcher.md`** — The original `adw-plan.ts` spec. Its state-file format and conventions are the shared contract this script reuses.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Scaffold `adws/adw-spec-review.ts` (argv, adw-id, logState, usage)

Create the file with shebang, header docstring (modeled on `adw-plan.ts`'s), imports (`spawn`, `fs`, `path`, canonical `Either`), `PROJECT_ROOT`/`AGENTS_DIR`/`SPECS_DIR` constants, and the `USAGE` text. Implement:

- `parseArgs(argv)`: accept `<spec-path-or-adw-id>` (required) plus optional `--help`/`-h`. Reject extra args. Return `Either<string, {input: string}>`.
- `adwId()` + `logState()` — copy verbatim from `adw-plan.ts` (ULID timestamp + single-JSON-object rewrite). The `events` for this script are different (review/upgrade/result/error) but the mechanism is identical.
- `resolveInput(input)`: if `input` matches `/^(SPEC|BUG|CHORE)-/` and exists as a file under `docs/specs/`, treat as a spec path. Else if it matches an adw-id (`/^[0-9A-HJKMNP-TV-Z]{10}$/`), read `agents/{input}/adw-state.json`, find the `result` event, return its `spec_path`. Else `Left`. Return `Either<string, {specPath: string, source: "path"|"adw-id"}>`.

```ts
#!/usr/bin/env bun
/**
 * adw-spec-review.ts — spec → reviewed spec (codex-driven).
 *
 * Takes a spec (by path or by adw-id), reviews it via codex, and either passes
 * it or upgrades it in place. Mirrors adw-plan.ts's structure (adw-id minting,
 * agents/{adw-id}/adw-state.json lifecycle, <adw-id> <result> stdout contract).
 *
 *   bun adws/adw-spec-review.ts docs/specs/SPEC-056-browse-url.md
 *   bun adws/adw-spec-review.ts 01KVCMJ0QR
 *
 * The codex interface (review + upgrade) lives in ./adws-modules/reviewer.ts.
 * Single external dependency: the `codex` CLI (v0.137+).
 */
import { spawn } from "child_process";
import { realpathSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { Either } from "../src/utils/task-either.ts";
import { type ReviewOutcome, reviewSpec, upgradeSpec } from "./adws-modules/reviewer.ts";
```

- Verify: `bun adws/adw-spec-review.ts` (no args) → usage to stderr, exit 1. `--help` → usage to stdout, exit 0.

### Task 2 — Create `adws/adws-modules/reviewer.ts` with types + `CodexDeps` + `resolveCodex()`

Create the module. Start with imports (canonical `Either`, `fs`, `path`) and the exported surface:

```ts
import { Either } from "../../src/utils/task-either.ts";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

export type ReviewVerdict = "pass" | "fail";
export interface ReviewVerdictPayload { verdict: ReviewVerdict; summary: string; issues: string[]; }

export type ReviewOutcome =
  | { kind: "pass"; specPath: string; summary: string }
  | { kind: "upgraded"; specPath: string; summary: string }
  | { kind: "unchanged"; specPath: string; summary: string };  // codex tried to fix but made no edits

/** Injected subprocess helpers (shape matches run/runCapture in adw-spec-review.ts). */
export interface CodexDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<Either<string, string>>;
  runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string }) => Promise<Either<string, string>>;
}

export const CODEX = resolveCodex();   // see below
export const CODEX_MODEL = "gpt-5.5";
```

**`resolveCodex()`** — the codex-path resolver. Try `command -v codex` first; if absent, fall back to the known absolute path `/Users/mekael/.nvm/versions/node/v24.13.1/bin/codex`; if that file doesn't exist either, return a sentinel the caller's dependency guard checks. This is run at module load so `CODEX` is a concrete string for the call sites.

- Verify: reading the module — `CODEX` resolves to a string (either `codex` or the absolute path) when the binary exists, else a recognizable empty/error sentinel. No `logState`/`adwId`/`AGENTS_DIR` references.

### Task 3 — Implement `reviewSpec()` (Pass 1, read-only, structured verdict)

The review call uses `--sandbox read-only`, `--output-schema` (forcing the verdict JSON shape), `-o` (writing the verdict to a file we name), and `--json` (streaming events to the reviewer log via the injected `runCapture` tee). It **does not** write the spec.

```ts
const REVIEW_SCHEMA = {
  type: "object",
  required: ["verdict", "summary"],
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    summary: { type: "string", description: "one-paragraph rationale" },
    issues: { type: "array", items: { type: "string" }, description: "specific problems if fail" },
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

Respond with a JSON object matching the schema: {"verdict":"pass"|"fail", "summary":"...", "issues":["...", ...]}.`;
}

export async function reviewSpec(
  deps: CodexDeps,
  cwd: string,
  specPath: string,
  reviewerLog: string,    // agents/{adw-id}/reviewer/raw-output.jsonl
  verdictFile: string,    // agents/{adw-id}/reviewer/verdict.json
): Promise<Either<string, ReviewVerdictPayload>> {
  // 1. Write REVIEW_SCHEMA to a temp file (e.g. verdictFile + ".schema.json") for --output-schema.
  // 2. Read specContent from specPath (Left on read error).
  // 3. deps.runCapture(CODEX, ["exec","--sandbox","read-only","--model",CODEX_MODEL,
  //       "--json","--output-schema",schemaPath,"-o",verdictFile, reviewPrompt(specPath, specContent)],
  //       { cwd, teeTo: reviewerLog })
  // 4. On Left → pass through. On Right → parse verdictFile (the -o output).
  //    Validate .verdict ∈ {pass,fail}; else Left with raw contents.
  //    Return Right<ReviewVerdictPayload>.
}
```

**Note on `--output-schema` + `-o` interaction:** codex validates its final message against the schema AND writes it to the `-o` file. So `verdictFile` should contain valid `{verdict, summary, issues}` JSON when codex succeeds. Parse it defensively (file missing / not JSON → `Left` with the raw `runCapture` stdout as context).

- Verify (manual, once codex is callable): run `reviewSpec` against `SPEC-056-browse-url.md` with a mock `deps`; confirm the verdictFile path is wired and the prompt is well-formed. Full live verification happens in Task 6.

### Task 4 — Implement `upgradeSpec()` (Pass 2, workspace-write, conditional)

Called only when Pass 1 verdict is `fail`. Uses `--sandbox workspace-write` so codex can edit the spec file in place. Returns what changed (via mtime diff on the spec, mirroring `agent.ts`'s `diffSpecsDir` approach but scoped to the single file).

```ts
function upgradePrompt(specPath: string, verdict: ReviewVerdictPayload): string {
  return `You are upgrading an implementation spec for the tmax terminal editor. The spec at ${specPath} was reviewed and found to have these issues:

${verdict.issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}

Reviewer summary: ${verdict.summary}

Apply the fixes directly to the spec file at ${specPath}. Make ONLY the changes needed to address the issues — do not rewrite the spec wholesale, do not change its Feature/Bug/Chore template structure, and preserve all correct sections. Edit the file in place.`;
}

export async function upgradeSpec(
  deps: CodexDeps,
  cwd: string,
  specPath: string,
  verdict: ReviewVerdictPayload,
  upgraderLog: string,    // agents/{adw-id}/upgrader/raw-output.jsonl
): Promise<Either<string, { changed: boolean; summary: string }>> {
  const mtimeBefore = statSync(specPath).mtimeMs;
  const res = await deps.runCapture(CODEX, ["exec","--sandbox","workspace-write","--model",CODEX_MODEL,
    "--json", upgradePrompt(specPath, verdict)], { cwd, teeTo: upgraderLog });
  if (Either.isLeft(res)) return res;
  const mtimeAfter = statSync(specPath).mtimeMs;
  // changed = mtime advanced. (Codex may report success but make no edits → unchanged.)
  return Either.right({ changed: mtimeAfter > mtimeBefore, summary: /* parse from res.right if available */ "" });
}
```

- Verify: `upgradeSpec` has no `logState`/`adwId`; returns canonical `Either`; reads `statSync(specPath)` before and after to detect edits.

### Task 5 — Wire `main()`: guard → mint id → resolve input → review → branch → (upgrade?) → print → exit

- **Dependency guard FIRST** (before minting an id): if `CODEX` is empty/the sentinel, print a clear error naming the binary + the expected absolute path, exit 1. (Mirrors `adw-plan.ts`'s claude guard.)
- Mint adw-id, log `start{input, spec_path, source}`.
- Resolve input via `resolveInput` — on `Left`, log `error{stage:resolve}`, exit 2.
- Compute paths: `reviewerLog`, `verdictFile`, `upgraderLog` under `agents/{id}/`.
- **Pass 1:** `await reviewSpec(deps, PROJECT_ROOT, specPath, reviewerLog, verdictFile)`. On `Left` → log `error{stage:review}`, exit 2. On `Right`:
  - Log `review{verdict, summary, issue_count}`.
  - If `verdict === "pass"` → log `result{kind:pass, spec_path}`, print `<adw-id> pass <spec-path>`, exit 0. **No Pass 2.**
  - If `verdict === "fail"` → **Pass 2:** `await upgradeSpec(deps, PROJECT_ROOT, specPath, verdict, upgraderLog)`. On `Left` → log `error{stage:upgrade}`, exit 2. On `Right`:
    - If `changed` → log `result{kind:upgraded, spec_path}`, print `<adw-id> upgraded <spec-path>`, exit 0.
    - If `!changed` → log `result{kind:unchanged, spec_path}`, print `<adw-id> unchanged <spec-path>`, exit 0. (codex reviewed-fail but made no edit — surface honestly, don't claim `upgraded`.)

stdout discipline: only `<adw-id> <status> <spec-path>` on stdout. All diagnostics to stderr.

- Verify: `rg -n 'codex exec|--sandbox|--model|REVIEW_PROMPT|UPGRADE_PROMPT|output-schema' adws/adw-spec-review.ts` → **zero matches** (all codex specifics in the module). `rg -n 'logState|adwId|AGENTS_DIR' adws/adws-modules/reviewer.ts` → **zero matches**.

### Task 6 — Run `Validation Commands`

All must pass with zero errors. Note: the live codex-invoking validations require codex to be reachable (it's installed at the absolute path; if its API/auth isn't configured, those will fail at runtime — see Notes).

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck` — zero TypeScript errors. **This now includes `adws/`** (per CHORE-26's tsconfig change); confirm `adw-spec-review.ts` and `reviewer.ts` compile clean.
- `bun adws/adw-spec-review.ts` — usage to stderr, exit 1.
- `bun adws/adw-spec-review.ts --help` — usage to stdout, exit 0.
- `bun adws/adw-spec-review.ts nonexistent-spec.md` — resolve error to stderr, exit 2, no `agents/` dir.
- `rg -n 'codex exec|--sandbox|--output-schema|REVIEW_PROMPT|UPGRADE_PROMPT' adws/adw-spec-review.ts` — **zero matches** (codex specifics encapsulated in the module).
- `rg -n 'logState|adwId|AGENTS_DIR|adw-state\.json' adws/adws-modules/reviewer.ts` — **zero matches** (state tracking stays in the caller).
- `rg -n 'child_process|spawn' adws/adws-modules/reviewer.ts` — **zero matches** (subprocess execution is injected via `CodexDeps`, not imported).
- `rg -n 'import.*task-either' adws/adws-modules/reviewer.ts adws/adw-spec-review.ts` — **two matches** (canonical Either).
- **Dependency guard:** temporarily move/rename the codex binary path resolution so it fails — `adws/adw-spec-review.ts <spec>` should print a clear "codex not found" error, exit 1, leave no `agents/` dir.
- **Live review (pass case), creates real state:** `bun adws/adw-spec-review.ts docs/specs/SPEC-056-browse-url.md` — prints `<adw-id> pass|upgraded|unchanged <spec-path>`; `agents/<adw-id>/adw-state.json` has `start`/`review`/`result`; `agents/<adw-id>/reviewer/{raw-output.jsonl,verdict.json}` exist and are non-empty. **Inspect the verdict.json — it must be valid `{verdict, summary, issues}`.** (If verdict is `fail`, also confirm `upgrader/raw-output.jsonl` exists and the spec's mtime advanced if `upgraded`.)

## Notes

**⚠️ Codex auth/config not verified.** codex-cli 0.137.0 is installed at `/Users/mekael/.nvm/versions/node/v24.13.1/bin/codex` and runs (`--version` works), but I did **not** verify codex has valid API auth configured (`~/.codex/config.toml` or `OPENAI_API_KEY`). The live Validation Commands above will fail at runtime if auth is missing — same situation as claude's z.ai gateway dependency for `adw-plan.ts`. Before relying on this, run a one-liner: `codex exec --sandbox read-only "say OK"` — if it returns, auth works; if it errors, configure codex first.

**Why codex's `--output-schema` is the key mechanism.** Unlike claude (where we parsed the model's JSON out of a free-form envelope with `pickTypeFromEnvelope`), codex validates its final response against a JSON Schema at the API level and writes the validated object to the `-o` file. This makes the verdict parse trivially and reliably — no envelope-walking, no stringified-JSON-in-a-text-field heuristics. The schema is small (`{verdict, summary, issues}`) and lives in the module as a const.

**Why two passes (review then upgrade), not one.** Pass 1 is read-only and produces a *structured list of issues*; Pass 2 consumes that list and applies fixes. Keeping them separate means: (a) a `pass` verdict short-circuits with no write call; (b) the review verdict is a durable artifact (`verdict.json`) you can inspect even when upgrade succeeds; (c) if upgrade fails, you still have the review; (d) you could later run review-only mode (`--review-only` flag) by skipping Pass 2. One combined pass would couple diagnosis and treatment and lose the `pass` short-circuit.

**Why `unchanged` is a distinct status from `upgraded`.** codex may review a spec as `fail` (issues found) but then, in workspace-write mode, decide not to edit (e.g. the "issue" was a judgment call, or it couldn't formulate a clean fix). Reporting `upgraded` in that case would be a lie. `unchanged` surfaces the honest outcome: review found issues, upgrade attempted, spec file mtime did not advance. The human should look at the `verdict.json` and `upgrader/raw-output.jsonl` to decide what to do.

**Mirrors adw-plan.ts but diverges where codex differs from claude.** The structural bones (argv, adw-id, logState, `<adw-id> <result>` stdout, DI'd subprocess layer, canonical Either, agents/ state layout) are copied from `adw-plan.ts`/`agent.ts` deliberately — consistency across the adw-* family. The divergences are all codex-specific: `codex exec` (not `claude -p`), `--sandbox read-only|workspace-write` (claude has no sandbox), `--output-schema` + `-o` (claude has no schema-validated output), and the two-pass structure (adw-plan is single-pass classify→dispatch).

**Risk: codex upgrade loops / over-editing.** A `fail`→`upgrade`→`fail` loop is theoretically possible if codex's fixes don't satisfy its own rubric. This plan does **not** implement a review-after-upgrade loop (that would be 3+ passes and risk runaway edits). Pass 2 runs once; its outcome (`upgraded`/`unchanged`) is reported honestly. If `unchanged` recurs in practice, a follow-up could add a single re-review after upgrade with a `--re-review` flag.

**Not in scope (explicit non-goals):**
- Implementing the reviewed spec (that's `/implement`'s job, downstream).
- Multi-spec batch review (one spec per invocation, like adw-plan is one description per invocation).
- A `--review-only` flag (skip Pass 2 even on `fail`). The DI/module structure supports adding it later; not needed for the initial "passes or updates" requirement.
- Sharing subprocess helpers (`run`/`runCapture`) across `adw-plan.ts` and `adw-spec-review.ts` via a common module. They duplicate today; extraction to `adws-modules/run.ts` is a separate follow-up (same as flagged in CHORE-26).
- Unit tests for `reviewer.ts`. The DI design enables them; writing tests is a separate task. Validation here is the live review of a real spec.
