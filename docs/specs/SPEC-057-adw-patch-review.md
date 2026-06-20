# Feature: adw-patch-review.ts — post-build audit dispatcher

## Feature Description

A fourth adw pipeline stage: `adws/adw-patch-review.ts`. After `adw-build.ts` has run `/implement` against a spec, this dispatcher audits the resulting working-tree changes against the spec's acceptance criteria to confirm the implementation actually satisfies the plan. It gathers the diff plus the spec content, runs typecheck and unit tests as gates, then dispatches a `claude` sub-agent that walks each acceptance criterion citing `file:line` evidence and produces a **PASS** or **GAPS** verdict. On GAPS it appends an `## Audit findings` section to the spec. It mirrors the structure of the other three adw dispatchers exactly: shared workspace id (`--id`), `agents/{id}/patch-reviewer/` events, `ADW_ORCHESTRATED` ownership rule, `TaskEither` pipeline, and the `<id> <verdict> <spec-path>` stdout contract.

## User Story

As an adw pipeline orchestrator
I want a dispatcher that verifies a build's changes satisfy the spec's acceptance criteria
So that only implementations that actually meet the plan proceed to commit/merge

## Problem Statement

The adw pipeline currently has three stages (plan → review → build) but no automated post-build verification. `adw-build.ts` runs `/implement` and records the result, but does not check whether the implementation actually satisfies the spec's acceptance criteria. The existing `tmax-patch-review` skill does this audit interactively via a human-driven Claude session, but there is no headless dispatcher that an orchestrator can call as stage 4 of the pipeline. Without it, the pipeline's adw-id traceability chain ends at the build — there is no `agents/{id}/patch-reviewer/` record tying an audit verdict back to the build and spec.

## Solution Statement

Add `adws/adw-patch-review.ts` — the post-build audit dispatcher. It takes a spec path or adw-id (same resolution as `adw-build.ts`/`adw-spec-review.ts`), resolves the spec, selects the review workspace id, then runs a `TaskEither` pipeline:

1. **Dependency guard** — `claude` on PATH (via the shared `patch-reviewer.ts` module).
2. **Gather** — collect the scoped build diff, untracked file contents, and the spec content. Render and write a deterministic gather bundle to `agents/{id}/patch-reviewer/gather.md`.
3. **Gates** — run `bun run typecheck:src` and `bun run test:unit` through a gate runner that distinguishes completed non-zero exits from spawn/setup failures. Gate command failures do NOT abort the pipeline; they are recorded as `gates_failed` in the gather bundle and in events, and the auditor sub-agent is still dispatched (it needs to see gate failures to make an informed verdict). Spawn/setup failures abort.
4. **Audit** — dispatch `claude -p` with a prompt that instructs it to read the spec, the gather bundle, and walk every acceptance criterion citing `file:line` evidence. Use Claude Code's structured-output flag (`--json-schema <schema-json>`) with `--output-format stream-json`; parse the final stream-json `result` payload as schema-constrained JSON, validate it, and then write that normalized JSON to `agents/{id}/patch-reviewer/verdict.json`.
5. **Verdict handling** — on PASS: record `pass` state, print `<id> pass <spec-path>`. On GAPS: append an `## Audit findings (adw-patch-review <timestamp>)` section to the spec, record `gaps` state, print `<id> gaps <spec-path>`.

Plus a new LLM-interface module `adws/adws-modules/patch-reviewer.ts` — the claude-side of the audit (dependency guard, gather, audit dispatch, verdict parsing), extracted for the same reasons `builder.ts`/`agent.ts`/`reviewer.ts` exist (DI of subprocess plumbing, unit-testable, separation of LLM I/O from CLI/state layer).

## Relevant Files

Use these files to implement the feature:

### New Files

- **`adws/adw-patch-review.ts`** — The CLI/state layer. Mirrors `adw-build.ts`'s structure: `parseArgs`, `resolveInput` (reused from the same pattern), subprocess helpers, `appendEvent`/`writeState`, `main` pipeline, stdout/stderr discipline. Owns calling `renderGatherBundle`/`writeGatherBundle` and the spec-edit-on-gaps side effect.
- **`adws/adws-modules/patch-reviewer.ts`** — The LLM interface. Exports `PatchReviewerDeps`, `ensureAvailable`, `gatherContext`, `runGates`, `audit`, `parseVerdict`, `parseClaudeStreamVerdict`, `renderGatherBundle`, and related types. No CLI, no argv, no `appendEvent`/`writeState`. Uses injected subprocess deps for unit testability.
- **`test/unit/adw-patch-review.test.ts`** — Deterministic tests for exported pure/testable helpers: `parseArgs`, `resolveInputFrom` (already covered in adw-build tests but re-exported here if the function is imported), gather-bundle rendering, verdict parsing, and the composed pipeline with mocked deps.

### Existing Files (reference + reuse)

- **`adws/adw-build.ts`** — The closest structural template. Copy `parseArgs` shape, `resolveInput`/`resolveInputFrom`, subprocess helpers/`appendEvent`/`writeState`/`adwId` shapes, and the `ADW_ORCHESTRATED` + `ownsState` + `recordState` pattern. The build `base_sha` defines the patch-review diff base; in standalone runs it may be read from the build state's `base_sha`, and in orchestrated runs it must be supplied by the orchestrator from the build result/event because child build state is intentionally skipped.
- **`adws/adws-modules/builder.ts`** — Template for `ensureAvailable()` (real subprocess probe via `claude --version`), `parseSkillResult()` (backward-scan for stream-json result line), and the `BuilderDeps` injection interface.
- **`adws/adws-modules/reviewer.ts`** — Reference for structured verdict validation and `parseVerdict` shape only. Do **not** copy its `codex exec --output-schema -o <verdictFile>` invocation: Claude Code uses `claude -p --json-schema <schema-json> --output-format stream-json` and does not write a verdict file directly.
- **`adws/adw-spec-review.ts`** — Reference for the two-outcome pipeline (pass → finalize, fail → side-effect + finalize) — the same branching pattern this dispatcher uses for PASS vs GAPS.
- **`src/utils/task-either.ts`** — Canonical `Either`/`TaskEither`. Same API notes apply (flipped static generics, `tryCatch` signature).
- **`.zcode/skills/tmax-patch-review/SKILL.md`** — The interactive skill this dispatcher automates. Its protocol (gather → gates → audit → verdict) and rubric shape the headless audit prompt. The dispatcher does NOT invoke the skill; it reimplements the protocol as a headless pipeline (same as `adw-build.ts` reimplements `/implement` as a headless `claude -p` call).
- **`.zcode/skills/tmax-patch-review/scripts/audit.ts`** — Reference for the gather logic (commits + working-tree diff), gate commands, and the progress-store update. The dispatcher's `gatherContext` and `runGates` are TS-native reimplementations using injected subprocess deps rather than Bun shell templates.

## Implementation Plan

### Phase 1: Foundation — `patch-reviewer.ts` module

Extract the LLM interface into `adws/adws-modules/patch-reviewer.ts`, mirroring `builder.ts`'s shape. This module owns:

- `PATCH_REVIEW_MODEL` constant (default `"glm-5.1"`, same rationale as `BUILD_MODEL` — stability over 5.2's larger window).
- `PatchReviewerDeps` interface (`run`, `runRaw`, `runCapture`) — `run` keeps the existing dependency-guard shape; `runRaw` is for gates/git commands that need exit-code visibility; `runCapture` is for the streaming Claude audit.
- `RawRunResult = { ok: boolean; exitCode: number; stdout: string; stderr: string }`. `runRaw(cmd, args, opts)` returns `TaskEither<string, RawRunResult>` where `Right` means the process spawned and completed (even with a non-zero exit) and `Left` means spawn/setup failed.
- `ensureAvailable(deps, cwd)` — dependency guard probing `claude --version` via `deps.run`.
- `gatherContext(deps, cwd, specPath, diffBase?)` — returns `{ specContent, diff, untrackedDiff, filesChanged, diffBase?, gitWarning? }`. Reads the spec file, runs `git diff <diffBase-or-HEAD> --no-color` and `git diff --name-only <diffBase-or-HEAD>` via `deps.runRaw`, plus `git ls-files --others --exclude-standard -z`. For each untracked text file, append a synthetic new-file diff (`diff --git a/<path> b/<path>`, `new file mode 100644`, `--- /dev/null`, `+++ b/<path>`, then `+`-prefixed content lines) so the auditor sees the implementation content, not just the file name. For binary or unreadable untracked files, include a deterministic marker line instead of raw bytes. Git command non-zero exits are non-fatal warnings; spawn/setup failures are `Left`.
- `renderGatherBundle(specPath, gather, gates?)` — pure deterministic markdown renderer for `agents/{id}/patch-reviewer/gather.md`.
- `writeGatherBundle(gatherFile, markdown)` — CLI-side file write helper; failure aborts before audit.
- `runGates(deps, cwd)` — runs `bun run typecheck:src` and `bun run test:unit` via injected `runRaw`. Returns `{ typecheck: GateResult; unit: GateResult }` where `GateResult = { ok: boolean; exitCode: number; stdout: string; stderr: string; output: string }`. Gate command failures (`ok: false`) do NOT make this a `Left`; spawn/setup failures do.
- `AUDIT_SCHEMA` — JSON schema for the forced verdict: `{verdict: "pass"|"gaps", summary: string, criteria: [{criterion, status: "implemented"|"missing"|"partial", evidence: string}], tests: [{behavior, status: "covered"|"uncovered", evidence: string}], edge_cases: [{case, status: "handled"|"missed", evidence: string}]}`.
- `audit(deps, cwd, specPath, gather, gates, auditorLog, verdictFile, model?)` — the single `claude -p` call. Constructs the audit prompt (spec content + gather path/content + gate results + rubric), runs `claude -p --model <model> --verbose --output-format stream-json --json-schema <JSON.stringify(AUDIT_SCHEMA)> <prompt>`, tees stdout to `auditorLog`, parses the final stream-json `result` payload with `parseClaudeStreamVerdict`, validates it with `parseVerdict`, and writes the normalized JSON to `verdictFile`. Claude does not write `verdictFile` directly.
- `parseClaudeStreamVerdict(streamJson)` — backward-scans newline-delimited JSON for the last `{ "type": "result", ... }` object, extracts its string `result`, and passes that string to `parseVerdict`. Missing result, non-string result, malformed JSON lines with no valid result, or schema-invalid payloads are `Left`.
- `parseVerdict(raw)` — parses the verdict JSON into a typed `AuditVerdict`. Validates the `verdict` field is `"pass"` or `"gaps"`, `summary` is a string, required `criteria`, `tests`, and `edge_cases` fields are arrays, and every item has the required string fields plus a valid status enum (`criteria.status`: `"implemented"|"missing"|"partial"`, `tests.status`: `"covered"|"uncovered"`, `edge_cases.status`: `"handled"|"missed"`). Extra fields may be ignored, but missing or wrongly typed required fields are `Left`.

### Diff scope contract

Patch review is a stage-4 audit of a just-completed ADW build, so its diff scope must be the build output, not every arbitrary dirty file in the developer's checkout.

- Preferred input is the build adw-id. Standalone `adw-patch-review <build-id>` reuses the build id as the review workspace id unless `--id <audit-id>` is explicitly passed; events and artifacts are written to `agents/{build-id}/patch-reviewer/` by default, or `agents/{audit-id}/patch-reviewer/` when `--id` is provided. Spec-path input mints a new audit id unless `--id` is provided.
- For standalone build-id input, `runPatchReview` reads `agents/{build-id}/adw-state.json` and uses its `base_sha` as `diffBase`.
- For orchestrated stage-4 runs, `adw-build.ts` skips child `adw-state.json` writes when `ADW_ORCHESTRATED=1`, so the orchestrator must preserve the build base in its own state. It may do this by reading `runBuild()`'s returned `baseSha`, by reading the builder `result` event's `base_sha`, or by extending the orchestrator state/build stdout contract; patch review must not assume `agents/{build-id}/adw-state.json` exists in orchestrated mode.
- The ADW orchestrator must run `adw-build.ts` in an isolated clean worktree before stage 3 starts. Unrelated dirty changes are excluded by that worktree isolation, not by filename heuristics in patch review.
- The gather diff command is `git diff <base_sha> --no-color` when `base_sha` is available. Standalone spec-path input falls back to `git diff HEAD --no-color` and records `gitWarning: "no build base_sha; diff may include pre-existing dirty changes"`.
- Untracked files are always included through the synthetic new-file diff described above because `git diff <base_sha>` does not show them.

### Phase 2: Core Implementation — `adw-patch-review.ts` dispatcher

The CLI/state layer, mirroring `adw-build.ts`:

- `USAGE`, `parseArgs(argv)` — accepts `<spec-path-or-adw-id>` and optional `--id <id>` and `--model <id>`. Same arg shape as `adw-spec-review.ts` plus the `--model` override from `adw-build.ts`.
- `adwId()`, `appendEvent()`, `writeState()`, `run()`, `runRaw()`, `runCapture()` — copied from `adw-build.ts` and extended with `runRaw()` for completed-process exit-code reporting.
- `resolveInput()` / `resolveInputFrom()` — copied from `adw-build.ts` (already parameterized for testing).
- `PatchReviewOptions` — `{ modelOverride?, id?, deps?, projectRoot?, agentsDir?, specsDir?, clock?, makeId? }` so tests can inject mocked subprocesses, temp dirs, deterministic timestamps, and deterministic ids.
- `runPatchReview(input, modelOverride?, id?)` — thin compatibility wrapper that calls `runPatchReviewWithDeps(input, { modelOverride, id })`. When `input` is a build adw-id and `id` is omitted, it uses `input` as the patch-review workspace id; otherwise it uses `id` or mints a new id.
- `runPatchReviewWithDeps(input, options)` — the composed `TaskEither` pipeline (see Step by Step Tasks). All filesystem roots, subprocess deps, clock, and id generation come from `options` with production defaults.
- `main()` — parses args, calls `runPatchReview`, prints `<id> <pass|gaps> <spec-path>` on success or error to stderr.

### Phase 3: Integration — spec-edit-on-gaps + state recording

- On GAPS: read the spec file, append `\n## Audit findings (adw-patch-review <ISO-timestamp>)\n\n<rendered findings>\n` via `readFileSync` + `writeFileSync` (not `Edit` — this is a CLI script, not an interactive session).
- On PASS: no spec edit. State records `pass`.
- The `recordState` / `ownsState` / `ADW_ORCHESTRATED` pattern is identical to `adw-build.ts`.

## Step by Step Tasks

### 1. Create `adws/adws-modules/patch-reviewer.ts`

- Define `PATCH_REVIEW_MODEL`, `PatchReviewerDeps`, `GateResult`, `GatherBundle`, `AuditVerdict`, and the `AUDIT_SCHEMA` JSON schema.
- Implement `ensureAvailable(deps, cwd)` — probe `claude --version` via `deps.run`, return `TaskEither<string, void>`.
- Implement `gatherContext(deps, cwd, specPath, diffBase?)` — read spec file (via `readFileSync`), run `git diff <diffBase-or-HEAD> --no-color` and `git diff --name-only <diffBase-or-HEAD>` plus `git ls-files --others --exclude-standard -z` via `deps.runRaw`. Return `TaskEither<string, GatherBundle>`. Completed git commands with non-zero exits → warn (via the returned bundle's `gitWarning` field) but do not abort; `runRaw` `Left` spawn/setup failures abort.
- Implement `renderGatherBundle(specPath, gather, gates?)` and `writeGatherBundle(gatherFile, markdown)` — render and write `agents/{id}/patch-reviewer/gather.md`. The pipeline must write this file after gates are known and before audit dispatch.
- Implement `runGates(deps, cwd)` — run `bun run typecheck:src` and `bun run test:unit`. Return `TaskEither<string, { typecheck: GateResult; unit: GateResult }>`. Each gate's stdout+stderr is captured into `GateResult.output`. Gate failures do NOT make this a Left — only a subprocess spawn failure does.
- Implement `buildAuditPrompt(specPath, gather, gates)` — pure function returning the prompt string. Includes the spec content, the diff (truncated to ~50K chars if massive), the gate results, and the rubric (walk every acceptance criterion, cite file:line, check tests and edge cases).
- Implement `audit(deps, cwd, specPath, gather, gates, auditorLog, verdictFile, model?)` — init auditor log, run `claude -p --model <model> --verbose --output-format stream-json --json-schema <JSON.stringify(AUDIT_SCHEMA)> <prompt>`. Tee stdout to `auditorLog`. Parse the final stream-json `result` with `parseClaudeStreamVerdict`, validate it, and write normalized JSON to `verdictFile`.
- Implement `parseClaudeStreamVerdict(streamJson)` — backward-scan stream-json lines for the last result event and parse its string `result` through `parseVerdict`.
- Implement `parseVerdict(raw)` — JSON parse + validate into `AuditVerdict`. Left on invalid shape, including missing required arrays, wrong item types, or invalid item status enums.

### 2. Create `adws/adw-patch-review.ts`

- Copy the boilerplate (`adwId`, `appendEvent`, `writeState`, `run`, `runCapture`, `resolveInput`/`resolveInputFrom`, `ADW_ID_RE`, `CROCKFORD`) from `adw-build.ts`. These are intentionally duplicated across dispatchers (per the established pattern — each dispatcher is self-contained).
- Implement `parseArgs(argv)` — same shape as `adw-spec-review.ts` plus `--model`.
- Implement `appendFindingsToSpec(specPath, verdict)` — read the spec, append the `## Audit findings` section with rendered criteria/tests/edge-cases, write back. Return `TaskEither<string, void>`.
- Implement `runPatchReview(input, modelOverride?, id?)`:
  1. Select id: reuse build-id input by default, use passed `--id` when provided, or mint a new id for spec-path input.
  2. Inject `PatchReviewerDeps`.
  3. `ownsState` / `recordState` — identical pattern to `adw-build.ts`.
  4. Pipeline: `TaskEither.right(seed)` → `ensureAvailable` → `resolveInput` + `diffBase` discovery (set `currentReview`) → write initial state + start event → `gatherContext(deps, cwd, specPath, diffBase)` (tap gather event) → `runGates` (tap gates event) → `renderGatherBundle` + `writeGatherBundle` (tap gather-written event) → `audit` (tap audit event) → branch on verdict: PASS → record `pass` state + result event; GAPS → `appendFindingsToSpec` + record `gaps` state + result event.
  5. Error handler: if `currentReview` is set, append error event + write failed state; else just return Left.
- Implement `main()` — parse args, run pipeline, print stdout/exit code.

### Event and state contract

- `agents/{id}/adw-state.json` is written only when `ADW_ORCHESTRATED !== "1"` and includes `{ "adw_id", "spec_path", "source", "model", "status", "diff_base"?, "verdict"? }`. Status values are `"running"`, `"pass"`, `"gaps"`, and `"failed"`.
- `agents/{id}/patch-reviewer/events.jsonl` is always append-only JSONL. Each event includes `ts` and `event`.
- Start event: `{ "event": "start", "spec_path": "<path>", "source": "path|adw-id", "model": "<model>", "diff_base": "<sha|null>" }`.
- Gather event: `{ "event": "gather", "spec_path": "<path>", "diff_base": "<sha|null>", "files_changed": ["src/a.ts"], "git_warning": "<optional warning>" }`.
- Gates event: `{ "event": "gates", "gates_failed": true|false, "typecheck": { "ok": true|false, "exit_code": 0 }, "unit": { "ok": true|false, "exit_code": 1 } }`.
- Gather-written event: `{ "event": "gather_written", "path": "agents/<id>/patch-reviewer/gather.md" }`.
- Audit event: `{ "event": "audit", "status": "ok", "verdict_file": "agents/<id>/patch-reviewer/verdict.json" }`.
- Result event: `{ "event": "result", "verdict": "pass|gaps", "spec_path": "<path>", "gates_failed": true|false }`.
- Error event: `{ "event": "error", "detail": "<message>" }`; after this, standalone state is written with `status: "failed"`.

### 3. Write tests in `test/unit/adw-patch-review.test.ts`

- `parseArgs`: accepts spec path, accepts `--id`, accepts `--model`, rejects extra args, rejects missing input, `--help`/`--usage` sentinels.
- `resolveInputFrom`: (already tested in adw-build.test.ts — if the function is re-exported, add a smoke test that it's the same function; otherwise copy the test shape).
- `parseVerdict`: valid pass/gaps verdicts parse correctly; invalid `verdict` field → Left; malformed JSON → Left; missing `criteria`/`tests`/`edge_cases`, non-array fields, missing item fields, and invalid item status enums → Left.
- `parseClaudeStreamVerdict`: extracts the final stream-json result, ignores malformed non-result lines, rejects missing/non-string result payloads, and propagates `parseVerdict` failures.
- `renderGatherBundle`: includes spec path/content, diff base or warning, changed files, synthetic untracked diffs, gate outputs, and `gates_failed`; output is deterministic for snapshot/assertion tests.
- `buildAuditPrompt`: pure function — includes spec content, includes gather path/content, includes gate results, includes rubric instructions, truncates massive diffs.
- `runPatchReview` with fully mocked deps: a build-id input without `--id` writes under that same id; a spec-path input mints a new id; an explicit `--id` wins. A green-path mock (gather returns a diff, gates pass, audit returns PASS) → Right with `{id, verdict: "pass", specPath}`. A gaps-path mock (audit returns GAPS) → Right with `{id, verdict: "gaps", specPath}` and the spec file has the findings section appended. A gate-failure mock (gates fail, audit still runs) → pipeline does not abort.

### 4. Run validation commands

- `bun run typecheck:src` — zero type errors in new files.
- `bun run typecheck:test` — zero type errors in test file.
- `bun run typecheck` — full typecheck passes.
- `bun test test/unit/adw-patch-review.test.ts` — all tests pass.

## Testing Strategy

### Unit Tests

- `parseArgs`: all flag combinations, error cases, help/usage sentinels.
- `parseVerdict`: valid/invalid JSON, missing fields, wrong verdict enum values, wrong required array types, and invalid criterion/test/edge-case status enum values.
- `parseClaudeStreamVerdict`: final result extraction from Claude stream-json, malformed trailing lines, missing result, non-string result, invalid verdict payload.
- `renderGatherBundle`: deterministic markdown, includes `gather.md` sections and `gates_failed`.
- `buildAuditPrompt`: includes required sections, truncates large diffs.
- `runPatchReview` (mocked deps): green path (PASS), gaps path (GAPS + spec edit), gate failure (non-aborting), dependency guard failure (Left, no state), resolve failure (Left, no state), audit failure (Left, error event + failed state).

### Integration Tests

- Not in scope for this spec — a live `claude -p` integration test would be slow, flaky, and mutate the working tree. The dispatcher is designed for deterministic unit tests with injected deps, matching the testing strategy of `adw-build.ts`/`adw-spec-review.ts`.

### Edge Cases

- Empty working-tree diff (no changes after build) — gather returns a warning, audit proceeds (will likely report GAPS since no implementation exists).
- Gate subprocess spawn failure (bun not on PATH) — `runGates` returns Left, pipeline aborts with error.
- Massive diff (>50K chars) — truncated in the audit prompt to avoid token explosion.
- Spec with no acceptance criteria section — audit prompt still runs; the sub-agent will report what it can find.
- `ADW_ORCHESTRATED=1` — state writes are skipped, events still written under the shared id.
- Claude stream has no valid result event — `parseClaudeStreamVerdict` returns Left with a clear message and no normalized verdict file is written.

## Acceptance Criteria

1. `adws/adw-patch-review.ts` exists and follows the same structural pattern as `adw-build.ts` (shared `TaskEither` pipeline, `adwId`/`appendEvent`/`writeState`, `resolveInput`/`resolveInputFrom`, `ADW_ORCHESTRATED` + `ownsState`, `run`/`runCapture`).
2. `adws/adws-modules/patch-reviewer.ts` exists and exports `PatchReviewerDeps`, `ensureAvailable`, `gatherContext`, `runGates`, `audit`, `parseVerdict`, `buildAuditPrompt`, and `PATCH_REVIEW_MODEL`. No CLI, no argv, no run-state tracking.
3. `parseArgs` accepts `<spec-path-or-adw-id>` + optional `--id` and `--model`, with the same error/help/usage sentinel convention as the other dispatchers.
4. The pipeline runs `claude -p` with a structured audit prompt, forcing a JSON verdict via `--output-schema`, and parses the result into a typed `AuditVerdict`.
5. On PASS: state is recorded as `pass`, stdout prints `<id> pass <spec-path>`, exit code 0.
6. On GAPS: an `## Audit findings (adw-patch-review <timestamp>)` section is appended to the spec file, state is recorded as `gaps`, stdout prints `<id> gaps <spec-path>`, exit code 0.
7. Gate failures (typecheck or unit tests) do NOT abort the pipeline — they are recorded in the gather bundle and events, and the audit sub-agent is still dispatched.
8. Events stream to `agents/{id}/patch-reviewer/events.jsonl`; raw claude output to `agents/{id}/patch-reviewer/raw-output.jsonl`; verdict to `agents/{id}/patch-reviewer/verdict.json`.
9. `bun run typecheck` passes with zero errors.
10. `bun test test/unit/adw-patch-review.test.ts` passes with all unit tests green.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions:

- `bun run typecheck:src` — zero type errors in new source files.
- `bun run typecheck:test` — zero type errors in the test file.
- `bun run typecheck` — full project typecheck passes.
- `bun test test/unit/adw-patch-review.test.ts` — all unit tests for the new dispatcher pass.
- `bun test test/unit/adw-build.test.ts` — existing adw-build tests still pass (no regression from shared code patterns).

## Notes

- **Why not invoke the `tmax-patch-review` skill via `claude -p`?** The skill is an interactive orchestrator that dispatches its own sub-agent and reads/writes `.spec-loop/progress.json`. The adw pipeline needs a headless, state-tracked dispatcher that writes to `agents/{id}/patch-reviewer/` — the same reason `adw-build.ts` reimplements `/implement` as a direct `claude -p` call rather than invoking the skill. The skill's *protocol* (gather → gates → audit → verdict) is the blueprint; the dispatcher is a TS-native reimplementation.
- **Why `--output-schema` instead of parsing stream-json?** `adw-build.ts` parses the stream-json result line because `/implement` produces unstructured output. The audit's verdict is structured data (pass/gaps + criteria list), so forcing it via `--output-schema` (the same pattern `reviewer.ts` uses for codex) is more robust than parsing prose.
- **Gate failures are non-fatal.** This is a deliberate divergence from the interactive `tmax-patch-review` skill, which treats gate failures as a hard stop. In headless mode, the auditor sub-agent needs to see gate failures to make an informed verdict — a spec might have all criteria implemented but a pre-existing test failure unrelated to the spec. The auditor can distinguish "gates failed because of this spec's code" from "gates failed for unrelated reasons" by inspecting the output.
- **Future: `adw-run-e2e.ts`.** The `adws/adw-run-e2e.ts` file already exists as a stub. This dispatcher is a prerequisite for the full pipeline (`plan → review → build → patch-review`), after which `adw-run-e2e.ts` can chain all four stages.
