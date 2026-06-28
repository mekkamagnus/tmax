---
goal: "bun run typecheck && bun run test:unit && bun run test:integration && bun run build pass, and bun adws/adw-build.ts --help shows --goal flag, and bun test test/unit/builder.test.ts passes"
---

# Chore: adw build stage `/goal` mode — continuous implementation loop

## Chore Description

The adw build stage currently dispatches a single `claude -p /implement <spec>` session per build attempt. The orchestrator's retry loop (build → test → patch-review → rebuild) spawns a **fresh claude session** for each retry, losing accumulated context each time. For large specs (7 phases, 44 files, 2600+ lines), this means each claude session can only complete a fraction of the work before exhausting its context window — then the next retry starts from scratch.

Claude Code's `/goal` command ([docs](https://code.claude.com/docs/en/goal)) provides an **internal loop mechanism**: claude keeps working autonomously, running validation commands, fixing failures, and retrying — all within a single session, retaining the context accumulated during that session. This works in non-interactive `-p` mode with `--dangerously-skip-permissions`. **Verified by smoke test on Claude Code v2.1.195** (see Smoke Test Evidence below): `/goal` dispatches, loops internally across multiple assistant turns, exits 0 on both goal-met and goal-exhausted, and emits a parseable stream-json `result` event carrying `total_cost_usd`.

This chore adds `/goal` support to the build stage so claude can iterate on large specs within one session, while keeping the orchestrator's external retry loop as a fallback for smaller specs or cases where `/goal` isn't appropriate.

**Scope of the context-retention claim.** A single Claude session still has a finite context window. `/goal` does not make the window larger — it avoids the *re-discovery overhead* that the orchestrator's external retry loop pays on every fresh session (re-reading the spec, re-exploring the codebase, re-establishing plan state). For a spec large enough to fill the window even once (e.g. CHORE-39 at ~336 lines / 44 files), `/goal` will deliver more work per session than a single `/implement`, but it will eventually fill the window. When it does, `/goal` exits and the orchestrator's external retry loop remains the safety net — see the two-layer iteration model in Notes.

### The problem, concretely

1. **Context loss between retries** — the orchestrator's build→patch-review loop spawns a fresh claude for each build attempt. For CHORE-39 (7-phase functional editor rewrite), 3 build retries delivered only Phases 1–2 of 7 (~30%). Each retry re-read the spec, re-explored the codebase, and re-started work from where the previous session left off — wasting context and API budget on re-discovery.
2. **Spec size exceeds single-session capacity** — a 336-line spec with 44 api files to migrate cannot be completed in one claude session. The retry loop should let claude loop *internally* rather than killing and restarting it.
3. **No way for spec authors to express "keep going until done"** — specs define validation commands but not a termination condition for the build session. The only signal is claude exiting, which it does when its context fills up — not when the spec is satisfied.

### The target

- Specs can optionally declare a `goal` field in YAML frontmatter expressing the completion condition
- When a spec has a `goal`, the build stage passes a tested `/goal` prompt whose condition explicitly instructs Claude to invoke `/implement <spec>` and then continue until the goal condition is satisfied
- Claude loops internally, running validation commands, fixing failures, and retrying within one session
- The orchestrator's external retry loop is preserved as a fallback (for specs without goals, or when `/goal` exits without meeting the condition)
- No change to the test, patch-review, or other pipeline stages

## Relevant Files

### Build module

- `adws/adws-modules/builder.ts` — owns `build()`, constructs the `claude -p` prompt. Line 125: `` `/implement ${specPath}` `` — this is where the prompt is assembled. The `build()` function (returning `TaskEither<string, BuildResult>`, **not** `Promise<Either>`) needs a new `goalCondition?: string` parameter that switches to a safe `/goal` prompt whose condition tells Claude to run `/implement <specPath>`. Note: `BuildResult` (builder.ts) and `BuildOutcome` (adw-build.ts) are **two different types in two different files** — do not conflate them. The goal-status field belongs on `BuildResult` in builder.ts.

### Build dispatcher

- `adws/adw-build.ts` — calls `builder.build()` at line 568, passes spec path and model. Needs to read the `goal` field from the spec's YAML frontmatter (or from a `--goal` CLI flag) and pass it to `builder.build()`. The frontmatter parser must handle specs that currently have no frontmatter (like CHORE-39). On exit, `runBuild()` (returning `Promise<Either<string, BuildOutcome>>`) must classify the outcome as `goal-met`, `goal-exhausted`, or `goal-error` so the orchestrator can distinguish "claude gave up" from "claude succeeded" from "claude crashed." The `goalStatus` field is added to **`BuildOutcome` in adw-build.ts:455** (the subprocess-facing struct with `id`/`specPath`/`baseSha`). The orchestrator has its own `BuildOutcome` at `adw-plan-review-build-patch.ts:456` (only `id`/`specPath`) — that struct must also gain the `goalStatus` field so the value crosses the orchestrator boundary. The existing machine-readable stdout contract must remain unchanged: stdout is still exactly `<id> <specPath>` for successful dispatch. The richer `goalStatus` crosses the subprocess boundary through a JSON sidecar at `agents/<id>/build-outcome.json`, written before stdout is emitted.
- `adws/adw-build.ts` Step 2.5 (ADR-0108 (a) typecheck gate) — **BUG-23:** the gate's fail/skip decision must check the goal status. Add a pure helper `shouldSkipTypecheckGate(gateOk, goalStatus)` that returns `true` only when the gate failed AND `goalStatus === "goal-exhausted"`. On skip, emit a `typecheck_gate_skipped` event and proceed to Step 3 (git capture + patch-review) so the two-layer retry loop can engage. On hard-fail (gate failed + non-exhausted), behavior is unchanged from ADR-0108 (a).

### Orchestrator

- `adws/adw-plan-review-build-patch.ts` — calls `deps.runBuild()` at lines 1131 and 1352. The `PipelineDeps.runBuild` interface (line 531) and `makeRealDeps.runBuild` implementation (line 596) need to thread the goal condition through. The `adw-build.ts` subprocess is spawned at line 601 via `spawnStage("adw-build.ts", args, ...)` — the goal is passed as a new `--goal` flag in the args. The orchestrator must react to the `goal-exhausted` outcome (see Step 5) by recording a `goal-exhausted` event and, on subsequent retries, narrowing the goal scope rather than spawning an identical `/goal` session that will exhaust again.

### Shared frontmatter helper

- `adws/adws-modules/spec-frontmatter.ts` — new small shared helper for extracting the optional `goal` field from spec frontmatter. Both `adw-build.ts` and `adw-plan-review-build-patch.ts` must import this helper rather than duplicating parser logic. **Concern #4 guardrail:** the helper is intentionally dependency-free and only parses the single `goal` field — but it must reject malformed input by throwing a typed `SpecFrontmatterError` rather than silently disabling goal mode. See Step 3 for the exact quoting/escaping rules (this is the same class of `: ` bug that broke 7 skill files in June 2026).

### Heartbeat (deferred)

- `adws/adws-modules/heartbeat.ts` — out of scope for CHORE-40. Goal-mode heartbeat fields are useful, but RFC-023 is not required to implement `/goal` mode and this chore must not modify heartbeat behavior. File a follow-up after RFC-023 lands if goal-turn heartbeat observability is still needed.

### Tests

- `test/unit/adw-build.test.ts` — existing build stage tests for CLI parsing, input resolution, and git trace. Add `--goal` CLI parsing coverage here, but do not assert spawned Claude args in this file unless `runBuild()` first gains a real dependency-injected builder seam.
- `test/unit/builder.test.ts` — existing deterministic tests for injected subprocess args. Add all `claude` argument assertions here, including `/goal`, `/implement`, and the absence of `--max-turns`.
- `test/unit/spec-frontmatter.test.ts` — focused tests for the shared `parseGoalFromSpec()` helper, if those parser cases are not placed in `adw-build.test.ts`.
- `test/unit/adw-pipeline-loop.test.ts` — orchestrator tests. Verify goal is threaded from spec frontmatter through `runBuild`.

### New Files

- `adws/adws-modules/spec-frontmatter.ts` — shared dependency-free parser for the spec `goal` frontmatter field.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `goalCondition` parameter to `builder.build()`

- In `adws/adws-modules/builder.ts`, add `goalCondition?: string` as the last parameter to `build()` (line 100–107).
- Add a small exported helper, e.g. `buildImplementPrompt(specPath: string, goalCondition?: string): string`, so tests can verify prompt construction without spawning Claude.
- At line 125, construct the prompt conditionally. Do NOT use `/goal "${goalCondition}" /implement ${specPath}`. Claude Code's `/goal` docs say `/goal <condition>` sets the condition and uses the condition itself as the directive; therefore the goal condition must include the instruction to invoke `/implement`:
  ```typescript
  export const GOAL_TURN_LIMIT = 50;
  export const GOAL_EXHAUSTED_MARKER = "ADW_GOAL_EXHAUSTED";

  export function buildImplementPrompt(specPath: string, goalCondition?: string): string {
    if (!goalCondition) return `/implement ${specPath}`;

    const condition = [
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
  ```
  Use the constructed `prompt` in the claude args array (line 125) instead of the current inline template literal.
- Quoting/escaping requirement: pass the prompt as a single argv element to `runCapture`; never build a shell command string. Use the multiline prompt shape above so `goalCondition` can contain quotes, newlines, or slash-command-looking text without breaking the prompt. Use `JSON.stringify(specPath)` inside the prose directive so paths with spaces/quotes are represented unambiguously.
- Do NOT add Claude's CLI `--max-turns` for goal mode. The current `builder.build()` treats a nonzero `runCapture` result as a build-stage failure, and Claude Code's CLI docs say `--max-turns` exits with an error when the limit is reached. That would stop the orchestrator before test/patch-review can identify gaps. The goal turn limit belongs in the `/goal` condition text as shown above, so Claude exits normally with a summary and the existing outer test/patch-review loop remains the fallback. **Smoke-test verified:** `/goal` exits 0 on both goal-met and goal-exhausted outcomes.
- Add an environment/version guard to `ensureAvailable()` or build startup:
  - Run `claude --version` only when `goalCondition` is set.
  - Parse the first semantic version matching `(\d+)\.(\d+)\.(\d+)` from stdout or stderr. Accept examples such as `2.1.139`, `Claude Code v2.1.139`, and `claude version 2.1.139`; reject any parsed version lower than `2.1.139`.
  - If no semantic version is present, allow the run but write `adw-build: warning: could not parse claude --version output for /goal support` to stderr and record a `goal-version-warning` event containing the raw output.
  - Do not run a separate live `/goal` probe command; probes can mutate files or depend on workspace trust. Detect `/goal` unavailability from the actual build subprocess result.
  - Recognize these stderr/raw-output substrings as goal availability/configuration failures: `Unknown command: /goal`, `No command named goal`, `/goal is not available`, `hooks are disabled`, `disableAllHooks`, `managed hooks`, `workspace trust`, `not trusted`, and `trust this workspace`. Surface them as `goal-error` with a `goal-unavailable` event `{ "type": "goal-unavailable", "reason": "<matched-string>", "raw": "<truncated raw stderr/output>" }`.
- **Concern #3 (goal-exhaustion detection):** add `goalStatus: "goal-met" | "goal-exhausted" | "goal-error" | undefined` to **`BuildResult` in builder.ts** (the `TaskEither` return type). The same field is also added to **`BuildOutcome` in adw-build.ts:455** and **`BuildOutcome` in adw-plan-review-build-patch.ts:456** so the value threads through all three layers (builder → adw-build subprocess → orchestrator). The field is present/defined only when goal mode was active. Classification rules:
  - **Parse the marker from the stream-json `result` event ONLY, never from the whole raw-output log.** Smoke-test finding: the marker text appears in the prompt echo and in Claude's reasoning, producing false positives if you grep the whole file. The `result` event (the final `{"type":"result",...}` line) carries Claude's final summary in its `.result` string — that is the only place to check for `GOAL_EXHAUSTED_MARKER`.
  - `goal-met` — Claude exits 0, the final `result` event has `subtype: "success"` and `is_error: false`, **and** its `.result` string does NOT contain `GOAL_EXHAUSTED_MARKER`.
  - `goal-exhausted` — Claude exits 0 but the `result` event's `.result` string contains `GOAL_EXHAUSTED_MARKER`. Also set when Claude exits nonzero with a recognized exhaustion message (see substrings below).
  - `goal-error` — Claude exits nonzero for any other reason (crash, permission failure, hooks disabled).
  - When classification is ambiguous, prefer `goal-exhausted` over `goal-met` so the orchestrator never silently accepts an incomplete build.
  - **Exhaustion substrings (nonzero exit):** `context window`, `context length`, `maximum context`, `token limit`, `maximum number of turns`, `turn limit reached`, `max_turns`, `rate limit`, `overloaded`, and `529`. (The `529` and `rate limit` substrings align with the existing `withClaude529Retry` wrapper in adw-build.ts — if the 529 retry budget is exhausted, classify as `goal-exhausted` so the orchestrator can retry, not `goal-error`.)
- **Outcome side-channel contract:** when goal mode is active, `adw-build.ts` must write `agents/<id>/build-outcome.json` before printing the existing success stdout line. Shape:
  ```json
  {
    "id": "<workspace id>",
    "specPath": "<absolute spec path>",
    "goalStatus": "goal-met | goal-exhausted | goal-error",
    "goalCondition": "<effective goal condition>",
    "goalExhaustedMarker": "ADW_GOAL_EXHAUSTED",
    "goalCostUsd": 0,
    "goalTurns": 0,
    "errorReason": "optional short reason"
  }
  ```
  `goalCostUsd` and `goalTurns` are parsed from the stream-json `result` event (`.total_cost_usd` and the count of `{"type":"assistant"}` events respectively — see Smoke Test Evidence). For non-goal builds, either omit the sidecar or write `"goalStatus": null`; the orchestrator must continue to parse stdout as `<id> <specPath>` for backward compatibility and read the sidecar only when present.
- **Concern #9 (cost guardrails):** add `MAX_GOAL_COST_USD` env var (default: unset = no cap). Noninteractive `claude -p` has no defined graceful early-stop control channel, so CHORE-40 must not claim to stop a running Claude process "normally" after the cap is crossed. Implement the cap as a between-attempt guard: parse `.total_cost_usd` from the final streamed `result` JSON, write a `goal-cost-observed` event, and if the observed cost exceeds the cap mark the outcome `goal-exhausted` with `errorReason: "goal-cost-exceeded"` so the orchestrator does not start another goal-mode retry for that spec. Always log the observed cost to stderr at exit: `adw-build: goal run cost $X.XX (turn limit ${GOAL_TURN_LIMIT})`.
- Validation: `bun run typecheck:src` — no new files, just parameter additions.

### Step 2: Add `--goal` CLI flag to `adw-build.ts`

- In `adws/adw-build.ts`, extend `ParsedArgs` (line 62–66) with `goal?: string`.
- In `parseArgs()` (line 68–89), handle `--goal <condition>` — requires a value.
- Update `runBuild()` precisely from:
  ```typescript
  export function runBuild(
    input: string,
    modelOverride?: string,
    id?: string,
  ): Promise<Either<string, BuildOutcome>>
  ```
  to:
  ```typescript
  export function runBuild(
    input: string,
    modelOverride?: string,
    id?: string,
    goalOverride?: string,
  ): Promise<Either<string, BuildOutcome>>
  ```
- In `main()`, pass `parsed.right.goal` into `runBuild(parsed.right.input, parsed.right.model, parsed.right.id, parsed.right.goal)`. `runBuild()` does not receive `ParsedArgs`, so do not write instructions that assume it can read `parsedArgs.goal` directly.
- In `runBuild()`, after resolving `specPath`, choose the goal as `goalOverride ?? parseGoalFromSpec(specPath)`, then pass that value to `builder.build()` at line 568. If `parseGoalFromSpec()` throws `SpecFrontmatterError`, fail the build with `Either.left`, write a `goal-frontmatter-error` event, and do not fall back to plain `/implement`; malformed `goal:` frontmatter is a spec-authoring error, not an instruction to silently disable goal mode.
- When `--goal` is provided, log it to stderr for observability:
  ```typescript
  if (goal) process.stderr.write(`adw-build: goal mode enabled — "${goal.slice(0, 100)}"\n`);
  ```
- Validation: `bun run typecheck:src`. Help validation is split because `--help` may short-circuit before full argument validation: add unit coverage that `parseArgs()` accepts `--goal <value>` and rejects `--goal` without a value, then run `bun adws/adw-build.ts --help` only to confirm the help text shows the new flag.

### Step 3: Read `goal` from spec YAML frontmatter

- Add `adws/adws-modules/spec-frontmatter.ts` with a dependency-free helper:
  ```typescript
  export function parseGoalFromSpec(specPath: string): string | undefined;
  export class SpecFrontmatterError extends Error { ... }
  ```
- Parser rules:
  1. Read the file as UTF-8.
  2. Return `undefined` unless the file starts with an opening standalone `---` line.
  3. Parse frontmatter from that opening `---` through the next standalone `---` line. Do not stop at the first blank line or first `# ` header; valid YAML frontmatter may contain blank lines and comments.
  4. Extract only a simple string `goal` field. Support `goal: plain text`, `goal: "quoted text"`, and `goal: 'quoted text'`.
  5. Throw `SpecFrontmatterError` if the file starts with an opening `---` but has no closing `---`.
  6. Return `undefined` if the frontmatter is well-formed but has no `goal`, or has an empty `goal`.
  7. Frontmatter goals are single-line only. Multiline goals are supported only through the `--goal` CLI flag, where the shell/user can pass embedded newlines. YAML block scalars (`goal: |`, `goal: >`) are out of scope for CHORE-40.
- **Concern #4 — quoting/escaping guardrails (same `: ` bug class that broke 7 skill files in June 2026):**
  - **Require quotes when the value contains `: ` or `#`.** If a `goal:` line is found and the value portion contains a colon-followed-by-space (`: `) or a `#` not inside quotes, the parser must throw `SpecFrontmatterError` with message `spec-frontmatter: goal value at <specPath>:<line> contains unquoted ': ' or '#' — double-quote the value (see CHORE-40 Step 3)`. Do NOT attempt to extract a partial value; the deferred template updates will emit double-quoted goals, so an unquoted complex value is a spec-authoring mistake worth surfacing.
  - **Prefer double quotes in future templates** so that single quotes (common in shell commands like `bun run typecheck && bun run test:unit pass`) survive unescaped.
  - **Strip only the outermost matching quote pair.** If the value starts and ends with the same quote char (`"` or `'`), strip exactly that pair and leave inner quotes intact. Do not unescape inner content — the goal is opaque prose passed to Claude, not data we re-serialize.
  - **Validate balanced quotes.** If the value starts with a quote but does not end with the same quote, throw `SpecFrontmatterError` rather than returning a truncated value.
  - Add focused unit tests `goal value with unquoted ': ' throws SpecFrontmatterError` and `goal value with balanced outer quotes strips only the outer pair`.
- Do NOT import `yaml` or `js-yaml` — the frontmatter is simple key-value, not complex YAML, and the quoting rules above are sufficient for the single `goal` field. (If a future spec needs nested frontmatter, revisit this decision then — YAGNI for now.)
- In `runBuild()`, after resolving the spec path, call `parseGoalFromSpec(specPath)`. If a goal is found and no `--goal` CLI flag was provided, use the spec's goal. If `--goal` is provided explicitly, it overrides the spec's goal.
- **Concern #5 (single source of truth):** `adws/adws-modules/spec-frontmatter.ts` is the ONLY parser for the `goal` field. `adw-build.ts` imports it directly; `adw-plan-review-build-patch.ts` imports the same helper. There is no duplicate parser anywhere — the orchestrator reading frontmatter and adw-build reading frontmatter are two callers of the same function, not two parsers.
- Validation: `bun run typecheck:src`.

### Step 4: Thread goal through the orchestrator

- In `adws/adw-plan-review-build-patch.ts`, update `PipelineDeps.runBuild` (line 531) signature to accept an optional goal: `runBuild: (specPath: string, modelOverride: string | undefined, id: string, goalCondition?: string) => Promise<Either<string, BuildOutcome>>`
- Update `makeRealDeps.runBuild` (line 596) to pass `--goal <condition>` to `spawnStage("adw-build.ts", args, ...)` when goal is provided.
- At the orchestrator level, import `parseGoalFromSpec` from `adws/adws-modules/spec-frontmatter.ts`, extract the goal from the spec before the first build dispatch (around line 1124), and pass it to `deps.runBuild()`. Also pass it on retry builds (line 1352). If parsing throws `SpecFrontmatterError`, record a `goal-frontmatter-error` event and fail the pipeline rather than dispatching a non-goal build.
- `makeRealDeps.runBuild` must preserve the existing stdout parser for `adw-build.ts`: it still reads `<id> <specPath>` from stdout. After `spawnStage` completes, it reads `agents/<id>/build-outcome.json` if present and merges `goalStatus`, `goalCondition`, `goalCostUsd`, `goalTurns`, and `errorReason` into the returned `BuildOutcome` (the orchestrator's `BuildOutcome` at adw-plan-review-build-patch.ts:456 must be extended with these optional fields). If the sidecar is missing for a goal-mode run, return `goalStatus: "goal-error"` and record `goal-outcome-missing`.
- **Concern #3 — react to `goal-exhausted`:** when `runBuild()` returns a `goalStatus === "goal-exhausted"` outcome:
  1. Record a `goal-exhausted` event in the orchestrator events log with the iteration number and the goal condition.
  2. Do NOT immediately spawn an identical `/goal` session on the next retry — that may exhaust again at the same point. Instead, on the retry after a `goal-exhausted`, narrow the goal by prepending: `Continue from the current repository state. Inspect the existing diff and validation output first; do not redo completed edits. ` to the original goal condition.
  3. Define "progress" deterministically. Capture a `RetryProgressSnapshot` after each build/test/patch-review cycle containing: `(a)` a worktree diff fingerprint from `git -C <worktree> diff --stat --summary`, `(b)` the ordered list of failing validation command names, and `(c)` the patch-review unresolved finding count if patch-review ran. A retry made progress if any of those values improves or changes in the expected direction: diff fingerprint changed, failing validation command count decreased, or unresolved patch-review finding count decreased. Do not infer progress from prose such as "Phases 1-N are done."
  4. If two consecutive retries both return `goal-exhausted` and the `RetryProgressSnapshot` shows no progress between them, fall back to plain `/implement` (no `/goal`) for the third retry so the pipeline does not loop forever on a spec that is too large even for `/goal`.
- Validation: `bun run typecheck:src`.

### Step 5: Add unit tests

- In `test/unit/builder.test.ts`, add deterministic subprocess/prompt tests using the existing injected `runCapture` seam:
  - `build with goal uses /goal prompt containing /implement directive` — verify the spawned args contain one prompt argv element that starts with `/goal `, includes `Run the /implement skill`, and includes the JSON-stringified spec path.
  - `build without goal uses plain /implement` — verify no `/goal` in args and the prompt remains `/implement <spec>`.
  - `goal prompt preserves quotes and multiline goals` — pass a goal containing `"quotes"`, newlines, and slash-command-looking text, then assert those bytes are preserved in the single prompt argv element.
  - `goal mode does not pass --max-turns` — assert the args do not contain `--max-turns`.
  - `goal mode raw output still parses normal skill success` — use mocked `runCapture` returning the normal stream-json result line so the smoke fixture proves the skill command path still reports success without invoking live Claude.
- In `test/unit/adw-build.test.ts`, keep this file focused on CLI parsing, input resolution, git trace, and `runBuild()` wiring:
  - `parseArgs accepts --goal with a value`
  - `parseArgs rejects --goal without a value`
  - `spec YAML frontmatter goal is read when no --goal flag` — create a temp spec with `goal: "..."` frontmatter and verify `runBuild()` wiring chooses it through an injected builder seam if such a seam is added; otherwise test `parseGoalFromSpec` directly in a shared-helper test.
  - `--goal flag overrides spec frontmatter goal` — verify at the wiring/helper level, not by mocking spawned Claude args in this file unless a real dependency-injected seam for `runBuild()` is added.
  - **BUG-23 gate-skip tests** — `shouldSkipTypecheckGate(gateOk, goalStatus)` returns `false` when the gate passed; `true` only when the gate failed AND `goalStatus === "goal-exhausted"`; `false` on gate-failed + `goal-met` (Claude claimed success but doesn't compile); `false` on gate-failed + `goal-error`; `false` on gate-failed + no goal (classic `/implement`, ADR-0108 (a) holds).
- Add shared-helper parser tests (either in `test/unit/adw-build.test.ts` or a focused `test/unit/spec-frontmatter.test.ts`):
  - no frontmatter returns `undefined`
  - normal `--- ... ---` frontmatter extracts `goal`
  - frontmatter with a blank line before the closing delimiter still parses
  - missing closing delimiter throws `SpecFrontmatterError`
  - **`goal value with unquoted ': ' throws SpecFrontmatterError` (Concern #4)** — write a spec whose `goal: bun run typecheck && foo: bar` line has an unquoted `: ` and assert `parseGoalFromSpec()` throws the typed error with the documented message.
  - **`goal value with balanced outer quotes strips only the outer pair` (Concern #4)** — `goal: "bun run typecheck && echo 'hi'"` returns `bun run typecheck && echo 'hi'` (inner single quotes preserved).
  - **`YAML block scalar goal is rejected`** — `goal: |` throws `SpecFrontmatterError` explaining that frontmatter goals must be single-line and multiline goals are CLI-only.
- **Concern #3 tests (`test/unit/builder.test.ts`):**
  - `goal-met classification when result event has no exhausted marker` — mocked `runCapture` returns a stream-json log whose final `{"type":"result","subtype":"success"}` line's `.result` string does NOT contain `GOAL_EXHAUSTED_MARKER`; assert `goalStatus === "goal-met"`.
  - `goal-exhausted classification when result event contains exhausted marker` — mocked final `result` event's `.result` string contains `GOAL_EXHAUSTED_MARKER`; assert `goalStatus === "goal-exhausted"`.
  - `marker in prompt echo does NOT cause false goal-exhausted` — mock a log where the prompt text (early user message) contains the marker but the final `result` event does NOT; assert `goalStatus === "goal-met"`. (This is the smoke-test-proven false-positive guard.)
  - `goal-error classification on nonzero exit with no recognized exhaustion signal` — assert `goalStatus === "goal-error"`.
  - `goal-exhausted on nonzero exit with context-window substring` — nonzero exit + stderr containing `"context window"` → `goalStatus === "goal-exhausted"`.
- **Concern #3 tests (`test/unit/adw-pipeline-loop.test.ts`):**
  - `orchestrator records goal-exhausted event on exhausted outcome` — inject a `runBuild` that returns `goal-exhausted` and assert the orchestrator emits a `goal-exhausted` event.
  - `orchestrator reads goalStatus from build-outcome sidecar without changing stdout parser` — mock `spawnStage` stdout as `<id> <specPath>` and provide a sidecar with `goalStatus: "goal-exhausted"`.
  - `orchestrator narrows goal scope after goal-exhausted` — assert the retry's `runBuild` receives a goal condition that starts with `Continue from the current repository state`.
  - `orchestrator falls back to plain /implement after two consecutive goal-exhausted with no progress` — hold the diff fingerprint, failing validation list, and unresolved patch-review count constant, then assert the third retry's `runBuild` receives no goal.
- Validation: `bun run test:unit`.

### Step 6: Leave heartbeat integration out of scope

- Do not modify `adws/adws-modules/heartbeat.ts` in CHORE-40.
- Do not add `goal_turn`, `goal_turn_limit`, or `goal_cost_usd` heartbeat fields in this chore. Those fields require RFC-023 heartbeat semantics and streamed event turn counting that are not part of the minimum `/goal` build contract.
- Add a short note in `Notes` that goal-mode runs make heartbeat observability more important, and that heartbeat integration should be handled by a separate follow-up after RFC-023 lands.

### Step 7: Defer template rollout to a separate chore

Currently, all three spec templates (chore, feature, bug) produce specs with no YAML frontmatter. Template rollout is intentionally out of scope for CHORE-40 so this chore can focus on the build-stage contract, CLI/frontmatter parser, outcome side-channel, and orchestrator retry behavior.

**Concern #6 — scope guardrail:** Do not touch project-scoped templates or global templates in CHORE-40. A separate chore can roll out template frontmatter once the runtime behavior is implemented and verified.

**Deferred project-scoped templates** (not edited in CHORE-40):
- `.zcode/skills/chore/SKILL.md`
- `.zcode/skills/feature/SKILL.md`
- `.zcode/skills/bug/SKILL.md`

**Future change to each template:** Add YAML frontmatter to the Plan Format's opening. The `goal` field is optional — leave the value as a placeholder that the LLM fills in from the Validation Commands section:

```md
## Plan Format

\`\`\`md
---
goal: "<condensed goal derived from the Validation Commands section — e.g. 'bun run typecheck && bun run test:unit pass'>"
---
# Chore: <chore name>
```

For bug specs:
```md
## Plan Format

\`\`\`md
---
goal: "<condensed goal — e.g. 'the bug is fixed and bun run test:unit passes'>"
---
# Bug: <bug name>
```

For feature specs:
```md
## Plan Format

\`\`\`md
---
goal: "<condensed goal — e.g. 'all acceptance criteria pass and bun run test:unit && bun run test:integration pass'>"
---
# Feature: <feature name>
```

**Future Instructions section update** in each template should tell the LLM to derive the `goal` from the Validation Commands:
> IMPORTANT: After writing the Validation Commands section, derive a concise `goal` condition from those commands and place it in the YAML frontmatter at the top of the spec. The goal should be a single string that claude can verify by running commands (e.g., `"bun run typecheck && bun run test:unit pass"`). Do NOT include commands that require interactive input or curl. **Always double-quote the goal value** so that shell single quotes (e.g. in `echo 'hi'`) and any `: ` patterns survive the parser (see CHORE-40 Step 3 quoting rules).

- Future skill documentation updates (`.zcode/skills/adw-implement/SKILL.md` and `.zcode/skills/adw-plan/SKILL.md`) should mention the `goal` field as an optional spec frontmatter field.
- A future `AGENTS.md` update can add an example under the adw Pipeline section showing a spec with a `goal`:
  ```yaml
  ---
  goal: "bun run typecheck && bun run test:unit pass and rg '(editor as any)' src/editor/ returns 0"
  ---
  # CHORE-41: eliminate as any casts
  ```
- Do not file CHORE-42 as part of CHORE-40 implementation; that administrative follow-up is separate from the runtime behavior and can be created after CHORE-40 lands.

## Validation Commands

- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:src` — production source compiles
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck:test` — test source compiles
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run typecheck` — full project typecheck
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:unit` — all unit tests pass (including new goal-mode tests)
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run test:integration` — integration tests pass
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun run build` — project builds
- `cd /Users/mekael/Documents/programming/typescript/tmax && bun adws/adw-build.ts --help` — help text shows `--goal` flag
- Deterministic smoke validation: `cd /Users/mekael/Documents/programming/typescript/tmax && bun test test/unit/builder.test.ts` — mocked `runCapture` proves the exact `claude -p` argv contains the `/goal` prompt, the embedded `/implement` directive, quotes/multiline goal preservation, no `--max-turns`, and a normal stream-json success result parses.
- Optional/manual only: a live Claude syntax check may be run in a disposable temp worktree, with a harmless throwaway spec and expected evidence captured from `raw-output.jsonl`. **Already performed once on v2.1.195 (see Smoke Test Evidence); re-running is optional but useful when the goal-prompt construction logic changes.** Do not make live Claude invocation a *blocking* validation command for this chore; it depends on account state, workspace trust, and hooks policy.

## Smoke Test Evidence

The `/goal` mechanism was verified against Claude Code **v2.1.195** on 2026-06-27 in an isolated temp git repo. Raw stream-json captures preserved at `agents/goal-smoke-2026-06-27/`. Three runs:

| Run | Goal | Exit | Result `subtype` | `total_cost_usd` | Assistant turns | Marker in `.result` | Classification |
|-----|------|------|------------------|------------------|-----------------|---------------------|----------------|
| goal-met | achievable (append line) | **0** | `success` | $0.285 | 7 | no | `goal-met` |
| goal-exhausted | impossible (create `/nonexistent/foo.txt`) | **0** | `success` | $0.375 | 20 | **yes** | `goal-exhausted` |
| goal-met-directive | achievable, spec's prompt shape | **0** | `success` | $0.243 | — | no | `goal-met` |

**Findings that shaped this spec:**

1. **`/goal` works headless.** Dispatches with `-p --dangerously-skip-permissions --verbose --output-format stream-json`, loops internally, exits 0. Resolves the core mechanism risk.
2. **Exit 0 on both outcomes.** Goal-met and goal-exhausted both exit 0. Confirms `--max-turns` (nonzero exit) is the wrong tool; the marker is the only exhaustion signal.
3. **`result` event shape.** Final line is `{"type":"result","subtype":"success","is_error":false,"total_cost_usd":<num>,"result":"<summary>"}`. `total_cost_usd` is parseable. `subtype:"success"` appears even on exhaustion — so `subtype` alone is NOT a goal-met signal.
4. **Marker false-positive risk.** The marker text appears in the prompt echo and Claude's reasoning earlier in the log. A naive whole-file grep produces false positives. **Parse the marker from the `result` event's `.result` string ONLY** — proven: goal-met runs show marker=0 in `.result`, goal-exhausted shows marker=1.
5. **No Stop hook events in stream-json.** Only `SessionStart` hooks appear (`hook_event:"SessionStart"`). The `/goal` Stop hook fires internally but is not surfaced. Therefore `goal_turn` must be derived from the count of `{"type":"assistant"}` events, not from hook events.
6. **Cost scales with turns.** $0.285 (7 turns, met) vs $0.375 (20 turns, exhausted). A 50-turn run on a complex spec will cost materially more than a single `/implement` — justifies the `MAX_GOAL_COST_USD` guardrail.

## Notes

- **Backward compatible** — specs without a `goal` field and no `--goal` flag behave exactly as before. The `/goal` prefix is only added when a condition is explicitly provided.
- **Goal turn limit is part of the condition, not `--max-turns`** — do not pass Claude's CLI `--max-turns` in goal mode. It exits nonzero when exhausted, and the current build stage treats nonzero `runCapture` as a fatal build failure. Instead, include a "stop after 50 goal turns and emit `ADW_GOAL_EXHAUSTED`" clause in the `/goal` condition so the outer adw test/patch-review loop remains the fallback.
- **Goal condition language** — the condition is passed as a natural-language string to claude. It is NOT executed by our pipeline. Claude interprets it and decides which terminal commands to run to verify it. This means goals should be expressed in terms claude can verify (e.g., "bun run test:unit exits 0" not "the code is good").
- **Two-layer iteration model (Concerns #2 & #3)** — the orchestrator's external retry loop (build → test → patch-review → rebuild) still runs when `/goal` mode is active. This is intentional: a single Claude session has a finite context window, and `/goal` does not enlarge it. The two layers have distinct roles:
  - **Inner layer (Claude's `/goal` loop):** fast, context-retaining *within one session*. Avoids re-discovery overhead. Bounded by `GOAL_TURN_LIMIT` (50) and the context window. When either bound is hit, Claude exits with a `goal-exhausted` status (detected via the exact `ADW_GOAL_EXHAUSTED` marker or recognized context-window/turn-limit errors) and the outer layer takes over.
  - **Outer layer (orchestrator retry loop):** slow, context-losing but carries the patch-review audit between iterations. On `goal-exhausted`, the outer layer narrows the next goal (`Continue from the current repository state...`) so the next `/goal` session re-orients cheaply rather than re-discovering. After two consecutive `goal-exhausted` outcomes with no deterministic progress snapshot improvement, the outer layer falls back to plain `/implement` (no `/goal`).
  - The risk this design eliminates: silently spawning an identical `/goal` session on every retry, which would exhaust at the same point and loop forever. The `goal-exhausted` classification + narrowing rule makes the handoff between layers explicit and observable.
- **BUG-23: typecheck gate skips on `goal-exhausted` (ADR-0108 (a) interaction)** — ADR-0108 (a) added a hard `typecheck:src` gate to the build stage: a non-compiling implementation fails the build directly (Left) rather than deferring to test. This is correct for classic `/implement` (a compile error means the LLM did something fundamentally wrong — duplicate import, missing export — and patch-review can't usefully audit non-compiling code). **But it breaks the two-layer model for `goal-exhausted` builds.** When `/goal` exits exhausted, the tree is *expected* to be partially-refactored — Claude ran out of turns mid-iteration on a large spec. A typecheck failure here doesn't mean "structurally broken, retrying is pointless"; it means "Claude didn't finish." If the gate hard-fails, patch-review never runs, the outer loop never gets a `gaps` verdict, and the two-layer retry that CHORE-40 was built to enable is dead.
  - **Fix (implemented):** the gate's fail/skip decision is now `shouldSkipTypecheckGate(gateOk, goalStatus)`. On `goal-exhausted`, the gate records a `typecheck_gate_skipped` event with the reason and proceeds to Step 3 (git capture + patch-review). On `goal-met`, `goal-error`, and classic (non-goal) builds, the gate hard-fails as before (ADR-0108 (a) holds).
  - **Why `goal-met` still hard-fails:** if Claude's `/goal` claims success but the tree doesn't compile, that's a real defect — Claude's self-reported "green" is unreliable (proven in the CHORE-39 run: the exhausted summary claimed "tree is green" but the gate found failures). Hard-failing forces the orchestrator to retry rather than accepting an unverified success.
  - **Proven by the CHORE-39 run:** the pre-BUG-23 gate killed workspace `01KW4T4HZ6` with exit code 2 after Claude's 83-minute `/goal` session delivered 3 commits. With BUG-23, that run would have proceeded to patch-review, which would audit the partial Phases 2–4 work and drive the retry loop.
- **Cost guardrails (Concern #9)** — a 50-turn `/goal` run can cost 5–10× a single `/implement`. Noninteractive `claude -p` does not define a graceful early-stop control channel, so `MAX_GOAL_COST_USD` is enforced after the process emits its final cost, not by killing a running Claude process. Mitigations: (1) observed cost above the cap marks the outcome `goal-exhausted` with `goal-cost-exceeded` so the orchestrator does not start another goal-mode retry; (2) cost is always logged to stderr at exit (`adw-build: goal run cost $X.XX`); (3) the outer loop's two-strike fallback to plain `/implement` bounds repeated goal attempts. Operators who enable `--goal` on expensive models should set `MAX_GOAL_COST_USD`.
- **Observability (Concern #10)** — heartbeat integration is intentionally out of scope for CHORE-40. Goal-mode runs make heartbeat liveness more important. **Smoke-test finding:** Stop hook events (which implement `/goal`) are NOT emitted to stream-json — only `SessionStart` hooks appear. Therefore `goal_turn` cannot be counted from hook events; the only reliable in-session turn signal is the count of `{"type":"assistant"}` events in the raw-output log (smoke test: goal-met = 7 assistant messages, goal-exhausted = 20). `goalTurns` in the sidecar is derived from that count. `goal_turn`, `goal_turn_limit`, and `goal_cost_usd` heartbeat fields should be implemented only in a follow-up after RFC-023 defines the heartbeat contract, and they must source `goal_turn` from the assistant-message count, not from hook events.
- **Claude Code requirements** — `/goal` requires Claude Code v2.1.139+ and depends on the hooks system. **Smoke-tested on v2.1.195** where `/goal` works in `-p` mode with `--dangerously-skip-permissions`. Parse the first semantic version from `claude --version`; versions below 2.1.139 fail goal mode, unparseable versions warn and continue. `/goal` can be unavailable when workspace trust has not been accepted, `disableAllHooks` is set, or managed settings restrict hooks. Goal-mode builds must detect the documented raw error substrings and record `goal-unavailable` with the matched reason. `/goal` uses Stop hooks, which are separate from permission hooks, so it composes with `--dangerously-skip-permissions` (used by the build stage for sibling worktrees) — this composition is **smoke-test-verified**, not assumed.
- **Frontmatter goal syntax** — spec frontmatter supports only one-line string goals (`goal: plain`, `goal: "quoted"`, `goal: 'quoted'`). Multiline goals are CLI-only via `--goal`; YAML block scalar goals are rejected with `SpecFrontmatterError`.
- **No change to test or patch-review stages** — this is purely a build-stage change. Test and patch-review stages are unaware of `/goal` mode. The build stage's own typecheck gate (ADR-0108 (a)) is modified per BUG-23 to skip on `goal-exhausted` (see BUG-23 note above), but test and patch-review dispatch are unchanged.
- **CHORE-39 lesson** — this chore is motivated by the CHORE-39 build where 3 claude sessions delivered only ~30% of the spec. With `/goal` mode, a single session could have iterated through more phases, running typecheck and tests between each phase, within one context window — and the orchestrator's narrowed-goal retry would have picked up where it left off instead of re-discovering.
- **Spec eats its own dog food (Concern #7)** — this spec itself carries YAML frontmatter with a `goal` field derived from the Validation Commands section. When CHORE-40 is implemented, `parseGoalFromSpec()` on this very file must return the goal string above.

## Out of Scope

- **Spec template rollout (Concern #10)** — updating project-scoped or global spec templates is deferred to a separate chore after CHORE-40 verifies the runtime design.
- **Live Claude invocation as a required validation command** — depends on account state, workspace trust, and hooks policy. Optional/manual smoke only.
- **Complex YAML frontmatter** (nested maps, lists, anchors) — the `spec-frontmatter.ts` parser handles only the single `goal` string field by design. If a future spec needs more, revisit the dependency-free decision then.
- **Heartbeat integration** — goal-mode heartbeat fields are deferred until RFC-023 heartbeat behavior is available.
