# Feature: adw Pipeline Observability — Live Console Visibility (RFC-020 §C + §B + §C2 + §D1)

## Feature Description

**Add live console visibility to adw pipeline runs so the operator can answer three questions at a glance, without attaching or interrupting tmux:**

1. **"What is it doing right now?"** — one filtered line per `claude` tool call, action-only (file path / command / pattern), no thinking/narration.
2. **"Is it still alive or hung?"** — one heartbeat line every 30s per stage, with elapsed time and byte-growth proof of life from the stage's `raw-output.jsonl`.
3. **"Which phase is the patch-review iteration in?" / "What did the spec-review actually find?"** — phase markers for patch-review's internal gather/gates/audit phases, and the concrete issue text (not just the count) for a failing spec-review.

This SPEC implements the **C + B + §C2 + §D1** pieces of [RFC-020](../rfcs/RFC-020-adw-observability.md). C and B are the original two (filtered tool_use tee + orchestrator heartbeat). §C2 (patch-review phase markers) and §D1 (spec-review issue surfacing) were added after the operator reported two specific gaps in real runs: patch-review stays on its opening line for the whole iteration, and spec-review's `fail` verdict shows only an issue count. Both additions are small, surgical, and grounded in data the dispatchers already compute — no new helper modules.

Today the orchestrator (`adw-plan-review-build-patch.ts`) prints one line per stage start and one per stage complete, then goes silent for the entire duration of each child stage — which can be 10–30 minutes for a build. The child stage's `runCapture` helper (`adw-build.ts:172-209`) tees stream-json to `agents/{id}/builder/raw-output.jsonl` (good — survives crashes) but buffers `claude`'s stderr entirely and never surfaces any live action to the console. A busy-silent run and a hung run are indistinguishable. This SPEC removes that ambiguity with two surgical, additive changes.

**Operator-visible result after this SPEC lands.** A `bun adws/adw-launch.ts "..."` run in tmux shows, during the build stage:

```
adw-plan-review-build-patch: stage 3/4 — build
[build] Edit src/editor/editor.ts
[build] Bash: bun run typecheck:src
[build] Grep "gapBuffer"
[adw] build running — 0m30s elapsed, raw-output.jsonl +42KB since last beat
[build] Edit src/core/buffer.ts
[adw] build running — 1m00s elapsed, raw-output.jsonl +18KB since last beat
...
```

During the spec-review stage, a `fail` verdict now shows what was wrong (not just the count):

```
adw-plan-review-build-patch: stage 2/4 — spec-review
adw-spec-review: verdict=fail — 3 issues:
  - Validation Commands list `bun run build` but the spec adds no build script
  - AC#2 references a file path that does not exist in the repo
  - Edge case for stderr-closed is missing
adw-spec-review: upgrading spec in place
...
```

During the patch-review stage, each iteration now shows which internal phase it's in:

```
adw-plan-review-build-patch: stage 4/4 — patch-review (iteration 1/3)
[patch-review] gather (diff: 14 files changed)
[patch-review] gates:typecheck (bun run typecheck:src)
[adw] patch-review running — 0m30s elapsed, raw-output.jsonl +0KB since last beat
[patch-review] gates:unit (bun run test:unit)
[adw] patch-review running — 1m00s elapsed, raw-output.jsonl +0KB since last beat
[patch-review] audit (claude /audit against spec + diff)
[patch-review] Bash: git diff HEAD --no-color
[adw] patch-review running — 1m30s elapsed, raw-output.jsonl +8KB since last beat
...
```

No thinking deltas, no token counts, no `tool_result` bodies — just what the model is doing, which phase the stage is in, and whether the pipe is still flowing. Density: ~5–30 short action lines/min depending on activity, plus one heartbeat every 30s, plus one phase line per patch-review phase transition.

## User Story

As a **developer running adw pipelines in tmux**
I want to **see, at a glance, what stage each claude subprocess is doing right now, which internal phase each stage is in, whether it's still producing output, and what concrete issues a failing spec-review found**
So that **I can tell a healthy long run from a hung one without attaching, interrupting, or guessing — and so I can decide whether to wait or to kill and resume, and so a failed spec-review tells me what to fix instead of just how many.**

## Problem Statement

Two independent root causes make adw runs opaque (traced in [RFC-020 §Motivation](../rfcs/RFC-020-adw-observability.md#motivation)):

1. **`runCapture` swallows `claude`'s stderr entirely** (`adw-build.ts:195-197`). On the success path the buffered `stderr` is discarded; it's only consulted in the failure branch. But `claude` runs with `--verbose --output-format stream-json`, so the live action stream goes to stderr (per the comment at `adws-modules/builder.ts:127-130`) and is never shown. The teed `raw-output.jsonl` is stream-json, unreadable as a live tail. Every claude-driven stage (plan, build, review, patch-review) is equally silent for the same reason.

2. **No time-awareness in the orchestrator.** `spawnStage` (`adw-plan-review-build-patch.ts:347-361`) is a bare `spawn` + `await close`. No timer, no proof-of-life signal. The orchestrator cannot report "still running, 4m elapsed, output grew 128KB" because it never looks at the clock or the tee file. A stage hung on a dead gateway (a real risk — `adws-modules/agent.ts:28-31` documents `glm-5.2[1m]` hanging silently) is indistinguishable from a busy stage for the entire duration.

3. **Patch-review's internal phases are invisible.** `adw-patch-review.ts` runs three distinct phases per iteration — `gatherContext` (git diff/ls-files), `runGates` (typecheck:src + test:unit, **sequentially**, each can take minutes), then `audit` (the claude call). The orchestrator prints one line for the whole iteration (`stage 4/4 — patch-review (iteration N/M)`) and shows nothing more for the entire multi-minute run, even though the iteration is progressing through phases. §B's heartbeat alone fixes the "is it alive" question but not "which phase is it in"; §C only fires during the claude `audit` (gates produce no stream-json), so the longest silent stretches — the typecheck and test:unit runs — get no narration.

4. **Spec-review reports issue count, not issue text.** `adw-spec-review.ts:364` prints `adw-spec-review: verdict=fail (N issues)` — just the count. The actual issue strings (`ReviewVerdictPayload.issues`) are already in the payload and already written to `events.jsonl`, but never reach the console. On a fail verdict the operator learns *that* there are N problems without learning *what* they are, forcing a `cat events.jsonl` to see them.

## Solution Statement

Two surgical, additive changes, each scoped to answer one of the two questions:

- **§C — Filtered tool-use tee in `runCapture`.** Add an optional `liveLabel` to `runCapture` in `adw-build.ts`; when set, parse each stdout JSON line as it's teed and print one filtered line per Claude assistant event containing a nested `message.content[]` block with `type: "tool_use"` (name + key input) to stderr. This matches the current structured-output fallback in `adws/adws-modules/patch-reviewer.ts`, where tool calls are not top-level `type: "tool_use"` JSON lines. Mirror the same option into the equivalent capture paths in `adw-plan.ts`. Keep buffering for the failure-message path unchanged. Default behavior (no `liveLabel`) is identical to today — purely opt-in per call site.

- **§B — Orchestrator heartbeat around each stage.** In `adw-plan-review-build-patch.ts`, wrap each `deps.runX(...)` call with a heartbeat helper: a `setInterval` (default 30s) that prints one line to stderr with elapsed time and the byte-size delta of the current stage's `raw-output.jsonl`, cleared on resolve. Proof of life = the tee file grew. Degrades gracefully (omits the byte delta) when no tee file is known for a stage.

- **§C2 — Patch-review phase markers.** Emit one stderr line per internal phase transition (`gather`, `gates:typecheck`, `gates:unit`, `gates:tmax-use?`, `audit`) so the operator can see the iteration moving through its phases. `gather` and `audit` markers live in `adw-patch-review.ts`; the individual gate markers must be emitted from `adws/adws-modules/patch-reviewer.ts` because `runGates()` is a single dispatcher call and the typecheck/unit/tmax-use commands run sequentially inside that function. Add an optional phase callback to `runGates()` (or split the gate functions) and have the dispatcher pass a best-effort stderr writer. The heartbeat (§B) continues to fire during each phase as proof of life; §C2 answers "which phase."

- **§D1 — Spec-review verdict surfaces issue text.** In `adw-spec-review.ts:364`, replace the count-only line with one that lists the issues: `adw-spec-review: verdict=fail — N issues:\n  - <issue>\n  - <issue>...` (capped at a readable number, e.g. 10, with a `... (N more)` tail). The data is already in `ReviewVerdictPayload.issues`; this is a one-call-site change with no new helper.

All four changes are **console-only**. The on-disk event/state contract (`events.jsonl`, `adw-state.json`) and the stage subprocess protocol (`<id> <spec-path>` stdout, `--id`/`ADW_ORCHESTRATED` env) are unchanged. §C2 and §D1 reuse data the dispatchers already compute for `events.jsonl`; they just additionally route it to stderr.

## Relevant Files

Use these files to implement the feature:

### Primary targets — make the two changes here

- **`adws/adw-build.ts`** — the canonical `runCapture` (`:172-209`). Add the `liveLabel` option + the JSON-line filter. The existing `runCapture` is also the one called for the build stage, so the build call site (via `adws-modules/builder.ts:124-141`) is where the label flows in.
- **`adws/adw-plan.ts`** — has its own `runCapture` (the planner capture path feeding `adws-modules/agent.ts:222-227`). Mirror the same `liveLabel` option here so the plan stage gets the same live action output. (Read it first to confirm the exact shape — it parallels `adw-build.ts`'s per CHORE-25/26/28.)
- **`adws/adw-plan-review-build-patch.ts`** — the orchestrator. Wrap each `deps.runPlan` / `deps.runSpecReview` / `deps.runBuild` / `deps.runPatchReview` call (`:577`, `:614`, `:638`, `:673`, `:712`) with the heartbeat helper. The byte-growth source for build/plan is `agents/{id}/{builder,planner}/raw-output.jsonl`; confirm the tee target for review/patch-review and degrade gracefully when unknown.
- **`adws/adw-patch-review.ts`** — the patch-review dispatcher (§C2). Add best-effort stderr phase lines before `gatherContext` and before `audit`, and pass a phase callback into `runGates()` for the individual gate markers. Do not try to emit `gates:typecheck`, `gates:unit`, or `gates:tmax-use` with caller-only one-line writes around `runGates()`; that cannot represent the separate sequential gate transitions because `runGates()` is one call.
- **`adws/adw-spec-review.ts`** — the spec-review dispatcher (§D1). At `:364`, replace `adw-spec-review: verdict=${verdict.verdict} (${verdict.issues.length} issues)\n` with a multi-line format that lists the issues.

### Existing modules to read (reference, understand the contract)

- **`adws/adws-modules/builder.ts`** — `build()` (`:107-142`) calls `deps.runCapture(...)` with `{ cwd, teeTo: builderLog }`. The `liveLabel` needs to thread from the orchestrator → `adw-build.ts` `runBuild` → `builder.ts` `build()` → `deps.runCapture`. Decide whether to plumb it as a new optional `BuilderDeps.runCapture` arg, a new `build()` parameter, or an env var read inside `runCapture`. The cleanest path is a new optional parameter on `build()` defaulting to off, threaded from `runBuild` based on `ADW_ORCHESTRATED` (live output only when driven by the orchestrator; standalone `adw-build.ts` keeps current behavior unless a `--live` flag is passed).
- **`adws/adws-modules/agent.ts`** — `dispatch()` (`:207-242`) and `classify()` (`:106-123`) call `deps.runCapture` / `deps.run`. Same threading decision as builder.ts.
- **`adws/adws-modules/reviewer.ts`** and **`adws/adws-modules/patch-reviewer.ts`** — read to confirm whether their capture paths tee a `raw-output.jsonl` that §B's heartbeat can read for byte growth. If they do, §B can cover those stages too; if not, §B degrades to elapsed-only for those stages (acceptable — §C is the primary visibility for them).
- **`adws/adws-modules/patch-reviewer.ts`** — owns `gatherContext`, `runGates` (typecheck + unit + optional tmax-use), and `audit`. §C2's individual gate markers must be emitted from inside `runGates()` via an optional callback such as `runGates(deps, cwd, { onPhase })`, or by splitting `runGates()` into separately callable gate functions. Prefer the callback because it preserves the existing public return shape while making the phase transitions observable.
- **`adws/adws-modules/reviewer.ts:19-23`** — `ReviewVerdictPayload { verdict, summary, issues: string[] }`. §D1 surfaces `issues` to the console; the payload already carries it and `adw-spec-review.ts:355-366` already destructures it. No schema change.

### Existing tests — must still pass unchanged

- **`test/unit/builder.test.ts`** — exercises `BuilderDeps` injection (mock `run`/`runCapture`, see lines 1–60). The new `liveLabel` option must default to off so this test's `fakeDeps` (which returns canned `runCaptureResult`) keeps passing verbatim. Do **not** change `BuilderDeps`'s method signatures in a way that breaks `fakeDeps`.
- **`test/unit/adw-build.test.ts`** — exercises `runBuild` end-to-end with mocked subprocesses. Must still pass unchanged.
- **`test/unit/adw-patch-review.test.ts`** — exercises the patch-review dispatcher's `runPatchReview` with mocked `PatchReviewerDeps`. §C2 only adds `process.stderr.write` calls between phases; it must not change `runPatchReview`'s return shape, event shape, or control flow. Confirm by re-reading the test for any stderr assertions (if it asserts on stderr, the new phase lines will break it — handle explicitly, do not weaken).
- **`test/unit/adw-spec-review.test.ts`** (if it exists; otherwise note its absence) — §D1 changes only the format of one stderr line in `adw-spec-review.ts:364`. If a test asserts on that exact line string, update it to the new multi-line format; if no test covers it, §D1 is untested by the existing suite and Step 13 adds coverage.
- **`test/unit/adw-pipeline-loop.test.ts`** — exercises the target four-stage `adw-plan-review-build-patch.ts` orchestrator with mocked `PipelineDeps` (no real subprocesses). The heartbeat wrapper must not change `PipelineDeps`'s signatures; it wraps the injected `deps.runX` calls transparently. The injected mocks resolve immediately, so the interval is cleared before any real-time beat fires. Add/update coverage here for heartbeat wrapping in the four-stage orchestrator.
- **`test/unit/adw-pipeline.test.ts`** — currently imports `adws/adw-plan-reviewspec-build.ts`, the older three-stage orchestrator. Keep it green, but do not claim it validates heartbeat wrapping in `adw-plan-review-build-patch.ts`.

### New Files

- **`adws/adws-modules/live-filter.ts`** — the stream-json line filter used by §C. Pure function: `formatToolUseLine(label: string, jsonLine: string): string | null` — returns the filtered `[label] <ToolName> <keyInput>` string for each nested assistant `message.content[]` block whose block `type` is `"tool_use"`, `null` for everything else (text deltas, tool_result, result, malformed lines, assistant events without tool calls). Pure + unit-testable in isolation. This is the single piece of new parsing logic in the SPEC; everything else is wiring.
- **`adws/adws-modules/heartbeat.ts`** — the §B heartbeat helper. Exports `withHeartbeat<T>(opts: { stage: string; teeFile?: string; intervalMs?: number; write?: (s: string) => void; clock?: HeartbeatClock }, fn: () => Promise<T>): Promise<T>`, where `HeartbeatClock` provides deterministic `now()`, `setInterval(cb, ms)`, and `clearInterval(handle)` hooks for tests and defaults to `Date.now` / global timers. Starts an interval, awaits `fn`, clears the interval on resolve/reject, returns `fn`'s result. The `write` callback is injectable (defaults to `process.stderr.write`) for unit testing and every heartbeat write is wrapped in try/catch so closed stderr cannot crash the pipeline. Reads `teeFile` size via `statSync` for the byte-growth delta; degrades to elapsed-only when `teeFile` is absent or unreadable.

## Implementation Plan

### Phase 1: Foundation (the two pure helpers)

Build `live-filter.ts` and `heartbeat.ts` in isolation, with full unit tests, before touching any call site. These are the only new logic; getting them right first makes the wiring trivial and low-risk.

### Phase 2: Core wiring

Thread the helpers into the existing call sites: `liveLabel` through `runCapture` (§C), and `withHeartbeat` around the orchestrator's `deps.runX` calls (§B). Each wiring change is additive and defaults to today's behavior when the option is off.

### Phase 2b: Dispatcher-level visibility (§C2 + §D1)

Two small additions inside the stage dispatchers themselves (not the orchestrator): patch-review phase markers (§C2) and spec-review issue text (§D1). Both reuse data the dispatchers already compute for `events.jsonl` — pure routing to stderr, no new helpers, no contract changes.

### Phase 3: Integration verification

Run a real (or realistic) adw pipeline and confirm the operator-visible output matches the target. No new integration tests beyond confirming the existing pipeline/loop tests still pass with the heartbeat wrapping the (mocked) stage calls.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Write `live-filter.ts` (§C pure helper)

- Create `adws/adws-modules/live-filter.ts`.
- Export `formatToolUseLine(label: string, jsonLine: string): string | null`:
  - `JSON.parse` the line defensively — on `SyntaxError`, return `null` (skip malformed).
  - If parsed `type !== "assistant"`, return `null` (skip text deltas, tool_result, result, system events).
  - Read `message.content`; if it is not an array, return `null`.
  - Find content blocks where `block.type === "tool_use"`. Claude stream-json in this repo uses this nested assistant content shape (see `extractStructuredOutput` in `adws/adws-modules/patch-reviewer.ts`), not top-level JSON lines where `type === "tool_use"`.
  - Extract `block.name` (the tool name, e.g. `"Edit"`, `"Bash"`, `"Grep"`, `"Read"`) and `block.input` (object).
  - Build the key-input string by tool name:
    - `Edit` / `MultiEdit` / `Write` / `Read` → `input.file_path` (basename or relative path; trim to a readable length).
    - `Bash` → `input.command` (first line, truncated to ~80 chars).
    - `Grep` / `Glob` → `input.pattern` (or `input.path`).
    - Any other tool → the first string-valued field of `input`, truncated.
  - Return `[${label}] ${name} ${keyInput}` (trimmed, single line, no trailing newline — the caller adds it).
  - If a single assistant event contains multiple tool-use blocks, return one line per block joined with `\n`, or expose a small companion function that returns `string[]` and have `formatToolUseLine` preserve the single-line common case. Do not silently drop later tool-use blocks.
- No I/O, no side effects, no imports beyond `JSON`. Pure function.

### Step 2: Unit-test `live-filter.ts`

- Create `test/unit/live-filter.test.ts`.
- Cases:
  - A real-shaped `assistant` line with `message.content: [{ type: "tool_use", name, input }]` for each of `Edit`, `Bash`, `Grep`, `Read` → correct `[label] Name input` string.
  - `MultiEdit` / `Write` → file path.
  - A top-level `{ "type": "tool_use", ... }` line → `null` (documents that the filter matches the actual Claude stream-json shape used in this repo, not the stale assumption).
  - An `assistant` event with only text content blocks → `null`.
  - An `assistant` event with multiple `tool_use` blocks → all tool calls are represented, not just the first.
  - A `text` delta event (`type: "text"`) → `null`.
  - A `tool_result` event → `null`.
  - A `result` event (`type: "result"`) → `null`.
  - A malformed (non-JSON) line → `null` (no throw).
  - A `tool_use` for an unknown tool name → graceful fallback (first string field), not a crash.
  - Long `Bash` command → truncated to the documented length.
  - `label` is interpolated correctly (e.g. `"build"`, `"plan"`).

### Step 3: Add `liveLabel` to `runCapture` in `adw-build.ts` (§C wiring, build stage)

- In `adw-build.ts`, extend the `runCapture` signature with an optional `liveLabel?: string` on its options object.
- In the `child.stdout.on("data")` handler, after the existing tee-to-file logic, when `liveLabel` is set and the buffered chunk contains complete lines, call `formatToolUseLine(liveLabel, line)` for each complete line and write the non-`null` results to `process.stderr` (with a trailing `\n`). Reuse the same line-buffering the tee logic already maintains (`teeBuf`) — do not re-implement line splitting.
- When `liveLabel` is unset, behavior is byte-for-byte identical to today (the filter is never called).
- **Default off.** The build call site only sets `liveLabel` when live output is desired (see Step 5).

### Step 4: Thread `liveLabel` through `builder.ts` → `build()`

- In `adws-modules/builder.ts`, add an optional `liveLabel?: string` parameter to `build()` (after `model`), defaulting to `undefined`.
- Pass it through to `deps.runCapture(..., { cwd, teeTo: builderLog, ...(liveLabel ? { liveLabel } : {}) })`.
- The `BuilderDeps.runCapture` type signature gains an optional `liveLabel?` on its options — add it as an optional field so `test/unit/builder.test.ts`'s `fakeDeps` continues to satisfy the interface without changes (optional fields don't break existing implementors).
- Do **not** change `build()`'s success/failure semantics; `liveLabel` is pure side effect.

### Step 5: Set `liveLabel` from `runBuild` based on orchestration

- In `adw-build.ts` `runBuild`, decide when to pass a `liveLabel`:
  - When `ADW_ORCHESTRATED === "1"` (driven by the orchestrator, output is going to the tmux window the operator is watching), pass `liveLabel: "build"`.
  - When standalone (`ADW_ORCHESTRATED` unset), default to **off** (current behavior) so standalone runs aren't noisier than today unless the operator opts in. (An optional `--live` flag can be added later; not required by this SPEC.)
- Pass the resolved `liveLabel` into `build(deps, PROJECT_ROOT, ctx.specPath, builderLog, ctx.model, liveLabel)`.

### Step 6: Mirror §C in `adw-plan.ts`

- Read `adw-plan.ts` to locate its `runCapture` (it parallels `adw-build.ts`'s per CHORE-25/26/28).
- Apply the same `liveLabel` option + `formatToolUseLine` integration as Step 3.
- Thread `liveLabel: "plan"` from the plan dispatcher's equivalent of `runBuild` when `ADW_ORCHESTRATED === "1"`.
- Leave `adws-modules/agent.ts`'s `classify()` call (which uses `run`, not `runCapture`) unchanged — classify is short and not the silence problem.

### Step 7: Write `heartbeat.ts` (§B pure-ish helper)

- Create `adws/adws-modules/heartbeat.ts`.
- Export `withHeartbeat<T>(opts: { stage: string; teeFile?: string; intervalMs?: number; write?: (s: string) => void; clock?: HeartbeatClock }, fn: () => Promise<T>): Promise<T>`:
  - `intervalMs` defaults to `30000`. Make it a named module constant (`DEFAULT_HEARTBEAT_MS = 30000`) so it's easy to tune later (RFC-020 Open Question #1).
  - `write` defaults to `(s) => process.stderr.write(s)`.
  - `clock` defaults to a production implementation backed by `Date.now`, `setInterval`, and `clearInterval`. Unit tests inject a controlled clock/timer implementation so assertions do not depend on real elapsed time under Bun/CI.
  - Record `startMs = clock.now()` and, if `teeFile` is set, `lastSize = statSize(teeFile)` (0 on absent/unreadable).
  - Start `const handle = clock.setInterval(() => { ... }, intervalMs)`:
    - Compute `elapsedMs = clock.now() - startMs`.
    - If `teeFile` set and readable, compute `nowSize = statSize(teeFile)`; delta = `nowSize - lastSize`; `lastSize = nowSize`; emit `[adw] ${stage} running — ${fmtElapsed(elapsedMs)} elapsed, ${basename(teeFile)} +${fmtBytes(delta)} since last beat\n`.
    - Else emit `[adw] ${stage} running — ${fmtElapsed(elapsedMs)} elapsed\n`.
    - Wrap the `write(...)` call in try/catch and swallow write failures. Heartbeats are best-effort observability; closed/unwritable stderr must never fail the stage.
  - `const result = await fn(); clock.clearInterval(handle); return result;` — wrap in try/finally so the interval is cleared on rejection too.
  - Pure helpers `fmtElapsed(ms)` (`"4m12s"` style) and `fmtBytes(n)` (`"128KB"` style) live in this module, unit-tested.
- The `teeFile` path is read fresh on each beat via `statSync` (cheap, one syscall per 30s) — no file handle held open.

### Step 8: Unit-test `heartbeat.ts`

- Create `test/unit/heartbeat.test.ts`.
- Cases (inject `write` to capture output, inject a controlled `clock`/timer, and use a temp `teeFile`; do not rely on real `setInterval` timing):
  - Advance the controlled timer through 2 intervals while `fn` is pending → exactly 2 heartbeat lines emitted, each with the right elapsed format.
  - `fn` rejects → interval cleared (advancing the controlled timer after rejection emits no third beat), rejection re-thrown.
  - `teeFile` grows between beats → byte delta present and correct.
  - `teeFile` absent → elapsed-only line, no crash.
  - `teeFile` appears mid-run → handled (absent beats are elapsed-only; once present, deltas appear).
  - Injected `write` throws → no crash, `fn` still resolves/rejects according to its own outcome, and the interval is still cleared.
  - `fmtElapsed` / `fmtBytes` edge cases: 0ms, sub-second, >1h, 0 bytes, negative delta (file truncated — should still print, e.g. `-1KB`, not crash).

### Step 9: Wrap each `deps.runX` call with `withHeartbeat` in the orchestrator

- In `adw-plan-review-build-patch.ts`, import `withHeartbeat`.
- Wrap each stage invocation:
  - `deps.runPlan(...)` (`:577`) → `withHeartbeat({ stage: "plan", teeFile: join(AGENTS_DIR, id, "planner", "raw-output.jsonl") }, () => deps.runPlan(...))`.
  - `deps.runSpecReview(...)` (`:614`) → `stage: "spec-review"`, `teeFile` = review stage's tee target (confirm in `adw-spec-review.ts` / `adws-modules/reviewer.ts`; if absent, omit `teeFile`).
  - `deps.runBuild(...)` (`:638` and the retry at `:712`) → `stage: "build"`, `teeFile: join(AGENTS_DIR, id, "builder", "raw-output.jsonl")`. For the retry, label the stage `"build (retry N)"`.
  - `deps.runPatchReview(...)` (`:673`) → `stage: "patch-review"`, `teeFile` = patch-reviewer's tee target (confirm; omit if absent).
- The heartbeat wraps the **injected** `deps.runX`. Add/update tests against `test/unit/adw-pipeline-loop.test.ts`, which imports the target four-stage `adw-plan-review-build-patch.ts`. `test/unit/adw-pipeline.test.ts` imports the older three-stage `adw-plan-reviewspec-build.ts`; keep it green but do not use it as evidence that the four-stage heartbeat wrapping works. In the four-stage tests, either inject the heartbeat clock/write hooks through the orchestrator or keep mocked stages synchronous enough that no beat fires; use controlled timers for any exact beat-count assertion. **Do not weaken the tests to manufacture a pass** — if a test asserts on stderr, surface that and handle it explicitly.

### Step 10: Confirm `ADW_ORCHESTRATED` gates live output correctly

- Trace: orchestrator sets `ADW_ORCHESTRATED=1` when spawning children (`adw-plan-review-build-patch.ts:352`). The child's `runBuild`/plan dispatcher reads it (Steps 5 and 6) to decide whether to set `liveLabel`. So a standalone `bun adws/adw-build.ts <spec>` run stays silent (current behavior), and an orchestrated run shows the filtered tool-use lines. Confirm by code reading; a dedicated test is optional but cheap (assert `runBuild` passes `liveLabel: "build"` when `ADW_ORCHESTRATED=1` and `undefined` otherwise).

### Step 11: Patch-review phase markers (§C2)

- Read `adws/adw-patch-review.ts` and `adws/adws-modules/patch-reviewer.ts` to locate phase boundaries. The dispatcher runs `gatherContext` (git diff/ls-files) → `runGates` (typecheck:src, then test:unit, then optional test:tmax-use inside `runGates`) → `audit` (claude call) in sequence.
- Add a small best-effort phase writer in `adw-patch-review.ts`, e.g. `writePhase(line: string): void`, that wraps `process.stderr.write(line)` in try/catch and swallows failures.
- Add one phase line before caller-visible transitions:
  - Before `gatherContext`: `[patch-review] gather (git diff + ls-files)\n`.
  - Before `audit`: `[patch-review] audit (claude /audit against spec + diff)\n`.
- Add an optional phase callback to `runGates()` in `adws/adws-modules/patch-reviewer.ts`, e.g. `runGates(deps, cwd, { onPhase?: (phase: "gates:typecheck" | "gates:unit" | "gates:tmax-use", command: string) => void } = {})`. Inside `runGates()`, invoke it immediately before each sequential gate command:
  - Before `bun run typecheck:src`: `[patch-review] gates:typecheck (bun run typecheck:src)\n`.
  - Before `bun run test:unit`: `[patch-review] gates:unit (bun run test:unit)\n`.
  - Before `bun run test:tmax-use`, only inside the existing `hasTmaxUseTargets(cwd)` branch: `[patch-review] gates:tmax-use (bun run test:tmax-use)\n`.
- The callback itself must be best-effort: wrap callback invocation in try/catch inside `runGates()` or pass a callback that catches. A thrown observer must not change gate execution.
- The exact phrasing above is a target, not a contract — match the surrounding code's style. The requirement is: **one line per phase transition, naming the phase.** Keep them short (single line, no wrapping).
- Do **not** change `runPatchReview`'s return value, the `events.jsonl` event shapes, or the `<id> <verdict> <spec-path>` stdout contract. §C2 is additive stderr only.
- If any existing test in `test/unit/adw-patch-review.test.ts` asserts on stderr, the new phase lines will break it — update the assertion to the new shape (do not delete or weaken it). If the test doesn't touch stderr, it passes unchanged.

### Step 12: Spec-review verdict surfaces issue text (§D1)

- In `adws/adw-spec-review.ts:364`, replace the single count-only line:
  ```js
  process.stderr.write(`adw-spec-review: verdict=${verdict.verdict} (${verdict.issues.length} issues)\n`);
  ```
  with a multi-line format that lists the issues when the verdict is `fail`:
  - On `verdict.verdict === "pass"`: keep it one line — `adw-spec-review: verdict=pass\n` (no issues to list; today's `(0 issues)` is noise on the happy path).
  - On `verdict.verdict === "fail"`: emit a header line plus one bullet per issue, capped at a readable number to avoid console flooding on a badly broken spec:
    ```
    adw-spec-review: verdict=fail — N issues:
      - <issue 1>
      - <issue 2>
      ...
      - <issue 10>
      ... (N-10 more)
    ```
    Cap at 10 issues. Each issue string is written verbatim from `verdict.issues[i]`; truncate any single issue longer than ~200 chars to `...` (a malformed review shouldn't dump a paragraph). Use a small pure helper (inline in this file is fine — it's one call site) to format the list; do not add a new module for it.
- The `fail` branch's existing `appendEvent({ event: "review", ..., issues: verdict.issues })` at `:356-363` is unchanged — `events.jsonl` already carries the full list. §D1 only changes what reaches the console.
- If `test/unit/adw-spec-review.test.ts` exists and asserts on the old `verdict=fail (N issues)` string, update it to the new multi-line format. Add a unit case (in that file or a new `test/unit/adw-spec-review-verdict-line.test.ts`) that feeds a `ReviewVerdictPayload` with 3 issues and asserts the rendered output contains all three bullet lines plus the `... (N more)` tail when issues exceed the cap.

### Step 13: Run the Validation Commands

- Execute every command in Validation Commands, top to bottom, and confirm each passes with zero errors before declaring the feature complete. Pay special attention to the pipeline/loop tests (Step 9), the existing builder/agent/reviewer/patch-reviewer tests (Step 3/4/6 interface changes), and the patch-review/spec-review dispatcher tests touched by §C2/§D1 (Step 11/12).

## Testing Strategy

### Unit Tests

- **`test/unit/live-filter.test.ts`** (Step 2) — the §C filter in isolation. This is the critical correctness test: any nested assistant `message.content[]` `tool_use` block the real `claude` emits must map to the right `[label] Name input` string, and every non-tool-use event must be silently skipped. Cover every tool name claude uses in this repo (Edit, MultiEdit, Write, Read, Bash, Grep, Glob, + an unknown tool fallback), multi-tool assistant events, and a top-level `type: "tool_use"` fixture that must return `null`.
- **`test/unit/heartbeat.test.ts`** (Step 8) — the §B helper in isolation with injected `write` and a controlled `clock`/timer. Must prove: beat count matches controlled timer advances, interval cleared on resolve **and** reject, byte delta computed correctly, absent tee file degrades gracefully, write failures are swallowed, formatters handle edge cases. Do not assert exact counts using real `setInterval` sleeps; that is timing-flaky under Bun/CI.
- **Existing `test/unit/builder.test.ts`** — must still pass unchanged after Step 4's `BuilderDeps.runCapture` optional-field addition. This guards the "default off" contract: `fakeDeps` doesn't set `liveLabel`, so the filter is never invoked, so output is byte-identical to today.
- **Existing `test/unit/adw-build.test.ts`** — must still pass after Step 5's `runBuild` change.
- **Existing `test/unit/adw-pipeline-loop.test.ts`** — must still pass after Step 9's heartbeat wrapping and should be the orchestrator coverage for the target four-stage `adw-plan-review-build-patch.ts`. These tests use mocked `PipelineDeps`; add a controlled-clock case if exact heartbeat behavior is asserted. `test/unit/adw-pipeline.test.ts` imports the older three-stage orchestrator, so it must remain green but is not coverage for this change.
- **§C2 patch-review phase markers (Step 11)** — add focused coverage for the `runGates()` phase callback so `gates:typecheck`, `gates:unit`, and conditional `gates:tmax-use` are proven to fire before their respective `runRaw` calls. Coverage also comes from: (a) the existing `test/unit/adw-patch-review.test.ts` still passing (proves the markers didn't break control flow or the return/event shape), and (b) the real-run validation step showing `[patch-review] gather` / `gates:typecheck` / `gates:unit` / `audit` lines in order during a patch-review iteration. If cheap, add one dispatcher-level test that injects a stderr-capturing writer and asserts the gather/gates/audit lines appear in order.
- **§D1 spec-review verdict formatting (Step 12)** — add a focused unit test for the issue-list formatter: a 3-issue `ReviewVerdictPayload` renders all three bullets; an 11-issue payload renders 10 bullets + `... (1 more)`; a `pass` verdict renders the single `verdict=pass` line with no bullets; a single issue >200 chars is truncated. If `test/unit/adw-spec-review.test.ts` already exercises the verdict path, add these cases there; otherwise create `test/unit/adw-spec-review-verdict-line.test.ts`.

### Integration Tests

- No new integration test is required by this SPEC. `test/unit/adw-pipeline-loop.test.ts` covers the target four-stage orchestration paths with mocked subprocesses; `test/unit/adw-pipeline.test.ts` remains a regression check for the older three-stage orchestrator only. The two new unit-test files cover the new logic in isolation. A real end-to-end run is the final validation step (Validation Commands), not an automated test.

### Edge Cases

- **Malformed stream-json line mid-stream** — `formatToolUseLine` returns `null` (skip), no throw, no crash of `runCapture`. Covered in Step 2.
- **Unknown tool name** — graceful fallback to first string field. Covered in Step 2.
- **`claude` emits no tool_use events for a long stretch** (e.g. a long single `text` think) — §C emits nothing (correct: nothing actionable to report), §B's heartbeat still fires every 30s with elapsed-only or byte-delta proof of life. This is the exact scenario the operator asked about ("can't tell if it's stalled"); the heartbeat's byte delta is the answer (if the tee file is growing, claude is still streaming, even if no tool_use crossed the filter).
- **Heartbeat `teeFile` doesn't exist yet** (stage just started, claude hasn't written) — degrade to elapsed-only, no crash. Covered in Step 8.
- **Heartbeat `teeFile` shrinks** (truncated by a re-init) — print a negative delta, don't crash. Covered in Step 8.
- **Standalone `adw-build.ts` run (no orchestrator)** — `liveLabel` unset (Step 5/10), output identical to today. No surprise noise.
- **`ADW_ORCHESTRATED=1` but stderr is closed/redirected** — `process.stderr.write` throws or is a no-op; `runCapture` must not crash on it. Wrap the live-write in try/catch (best-effort, like the existing tee-to-file `appendFileSync` which is already wrapped at `:191`).
- **Pipeline tests with mocked deps that resolve synchronously** — the heartbeat's interval is cleared before the first beat fires; verify no hang, no stderr assertion failure. For any test that needs exact heartbeat output/counts, inject the controlled heartbeat clock rather than relying on wall-clock sleeps.
- **§C2: a gate phase fails fast** (e.g. typecheck exits non-zero immediately) — `runGates()` still continues to unit and optional tmax-use because gates record failures rather than aborting on non-zero exit. The subsequent phase markers (`gates:unit`, `audit`) must still appear as control flow proceeds; the marker is "what phase is starting," not "what phase succeeded." Verify the markers don't couple to gate success.
- **§C2: tmax-use gate absent** (no `tmax-use/playbooks/` or `tests/` targets) — the `[patch-review] gates:tmax-use` line must NOT appear because the callback fires only inside `runGates()`'s existing `hasTmaxUseTargets(cwd)` branch. Verify the marker and the gate stay in sync.
- **§C2: stderr closed mid-iteration** — a phase-marker `process.stderr.write` throws; the try/catch swallows it and the iteration continues. Same best-effort contract as the tee writes.
- **§D1: malformed issue strings** (very long, contains newlines, is not a string) — the formatter truncates long issues, collapses embedded newlines (an issue with a newline must not break the bullet structure), and coerces non-strings to `String(...)`. An issue must never inject multiline content that breaks the `- ` bullet layout.
- **§D1: empty issues array on a `fail` verdict** (reviewer bug) — render `adw-spec-review: verdict=fail — 0 issues:` with no bullets, do not crash. The count is the source of truth, not the array length assumption.
- **§D1: exactly 10 issues** — no `... (N more)` tail (tail appears only when count > cap). Exactly 11 → tail says `... (1 more)`.

## Acceptance Criteria

1. **§C filter is pure and unit-tested.** `formatToolUseLine` maps every nested assistant `message.content[]` `tool_use` block to `[label] Name keyInput`, returns `null` for every other event type, top-level `type: "tool_use"` fixture, assistant events without tool calls, and malformed JSON, with no I/O or side effects. (`test/unit/live-filter.test.ts` green.)
2. **§C emits filtered live lines during orchestrated runs.** When `ADW_ORCHESTRATED=1`, the build and plan stages' `runCapture` prints one filtered line per nested assistant `tool_use` block to stderr. Standalone runs emit nothing (default off). Verified by the real-run validation step (Validation Commands) showing `[build] Edit ...` / `[build] Bash: ...` lines.
3. **§C is additive and default-off.** `BuilderDeps.runCapture`'s new `liveLabel` is optional; `test/unit/builder.test.ts`'s `fakeDeps` passes unchanged; `test/unit/adw-build.test.ts` passes unchanged.
4. **§B heartbeat helper is pure-ish and unit-tested.** `withHeartbeat` emits N beats for N controlled timer advances, clears the interval on resolve **and** reject, computes byte deltas correctly, degrades gracefully on absent/unreadable/shrinking `teeFile`, and swallows write failures. (`test/unit/heartbeat.test.ts` green.)
5. **§B fires during each orchestrator stage.** Each `deps.runX` call in `runPipeline` is wrapped; a real orchestrated run shows one `[adw] <stage> running — Xm Ys elapsed, <file> +NKB since last beat` line every 30s per stage. Verified by the real-run validation step.
6. **No on-disk contract change.** `events.jsonl` and `adw-state.json` shapes are unchanged; the stage subprocess protocol (`<id> <spec-path>` stdout, `--id`/`ADW_ORCHESTRATED` env) is unchanged.
7. **No regression in existing tests.** `bun test test/unit/` passes with zero new failures — specifically `builder.test.ts`, `adw-build.test.ts`, `adw-pipeline.test.ts`, `adw-pipeline-loop.test.ts`, `adw-patch-review.test.ts`, `agent.test.ts`/`reviewer.test.ts` if they exist and touch the modified interfaces.
8. **Typecheck/build clean.** `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck`, `bun run build` all pass with zero errors.
9. **§C2 patch-review shows phase transitions.** A real orchestrated patch-review iteration prints one stderr line per internal phase in order: `[patch-review] gather`, `gates:typecheck`, `gates:unit`, (`gates:tmax-use` only when tmax-use targets exist), `audit`. The `gates:tmax-use` line is absent when `runGates()` skips the optional tmax-use gate (marker is emitted from the same branch as the gate command). The markers do not change `runPatchReview`'s return value, event shapes, or stdout contract. Verified by unit coverage for the `runGates()` phase callback and the real-run validation step.
10. **§D1 spec-review shows issue text on fail.** On a `fail` verdict, the console prints `adw-spec-review: verdict=fail — N issues:` followed by one `- <issue>` bullet per issue (capped at 10, with a `... (N more)` tail), with each issue truncated to ~200 chars and embedded newlines collapsed. On a `pass` verdict, it prints the single line `adw-spec-review: verdict=pass`. The `events.jsonl` `review` event is unchanged (already carried `issues`). Verified by the new §D1 unit test and the real-run validation step.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck; the `runCapture` / `build()` / `runBuild` signature changes and the two new modules must typecheck cleanly.
- `bun run typecheck:test` — Test typecheck; the two new test files must typecheck.
- `bun run typecheck` — Full typecheck (src + test + tmax-use).
- `bun run build` — Build succeeds.
- `bun test test/unit/live-filter.test.ts` — New §C filter unit tests pass.
- `bun test test/unit/heartbeat.test.ts` — New §B heartbeat unit tests pass.
- `bun test test/unit/builder.test.ts` — Existing builder tests pass UNCHANGED (guards the "default off" contract).
- `bun test test/unit/adw-build.test.ts` — Existing build dispatcher tests pass unchanged.
- `bun test test/unit/adw-pipeline.test.ts` — Older three-stage orchestrator tests remain green; this is a regression check, not heartbeat coverage for the four-stage orchestrator.
- `bun test test/unit/adw-pipeline-loop.test.ts` — Four-stage orchestrator/retry-loop tests pass with heartbeat wrapping (retry stage label included); add controlled-clock coverage here if exact heartbeat behavior is asserted.
- `bun test test/unit/adw-patch-review.test.ts` — Patch-reviewer dispatcher tests pass unchanged after §C2's phase markers are added (proves the markers didn't break control flow, return shape, or events).
- `bun test test/unit/adw-spec-review-verdict-line.test.ts` (or the added cases in `adw-spec-review.test.ts` if it exists) — §D1 formatter: 3-issue list, 11-issue cap + tail, `pass` one-liner, long-issue truncation, empty-issues-on-fail, newline-in-issue collapse.
- `bun test test/unit/` — Full unit suite; zero regressions.
- `bun adws/adw-launch.ts --foreground --script adw-build.ts docs/specs/SPEC-062-adw-observability.md` (or any small existing spec) — **manual live check.** Run standalone first (confirm it's silent, default-off holds). Then run via the orchestrator (`bun adws/adw-launch.ts docs/specs/SPEC-062-adw-observability.md`) in a tmux window and confirm:
  - (a) `[build] Edit ...` / `[build] Bash: ...` filtered lines appear during the build stage (§C).
  - (b) One `[adw] build running — ... elapsed, raw-output.jsonl +NKB since last beat` line appears every ~30s (§B).
  - (c) No thinking-delta / token-count / tool_result-body noise is printed.
  - (d) During patch-review, the five phase lines appear in order: `[patch-review] gather`, `gates:typecheck`, `gates:unit`, (`gates:tmax-use` only if tmax-use targets exist), `audit` (§C2).
  - (e) If the spec-review stage returns `fail`, the console lists the issue bullets (not just a count); if `pass`, a single `verdict=pass` line (§D1).

  If a real `claude`/`codex` run isn't feasible in the environment, substitute short fixtures that emit canned stream-json (§C), canned gate results (§C2), and a canned `ReviewVerdictPayload` (§D1) through mocks and verify the rendered output directly — state explicitly which path was taken.

## Notes

- **Why C + B and not the full A–G.** The operator asked for "high-level updates, not all the thinking." C (filtered tool_use) + B (heartbeat) deliver exactly that. A raw would clutter (it's the thinking stream); D/E/F/G are deferred Phase 2 candidates documented in [RFC-020](../rfcs/RFC-020-adw-observability.md). Land C+B, watch real runs, then decide which of the rest are actually needed.
- **§C vs §A.** A (tee `claude`'s raw stderr) was rejected because `--verbose` stderr *is* the thinking stream. C achieves A's goal (live visibility) via a tight filter on the already-teed stream-json stdout, which is where the structured `tool_use` events live. If claude-side errors (rate limits, gateway messages) turn out to be missed, RFC-020 §A describes a narrow stderr filter add-on that only forwards `/error|rate limit|429|overloaded/i` lines — high signal, ~0 lines normally.
- **§B vs §E.** E (stall watchdog that kills silent stages) is deferred because its threshold is a guess without §B's throughput data. Land B first, watch a few runs, then tune E against measured normal activity. RFC-020 Open Question #4 notes E and B should share the same activity signal when E is built.
- **Why the heartbeat wraps the injected `deps.runX` and not `spawnStage`.** `spawnStage` is the real subprocess spawner, but the four-stage orchestrator's `runPipeline` is unit-tested via mocked `PipelineDeps` in `test/unit/adw-pipeline-loop.test.ts` (no real subprocess). Wrapping at the `deps.runX` layer means the heartbeat is testable with those mocks and a controlled clock, and the real subprocess path gets the heartbeat for free because `realDeps.runX` calls `spawnStage` under the hood. This matches the project's "testable via injected deps" convention (`AGENTS.md` §2, the `BuilderDeps`/`AgentDeps`/`PipelineDeps` pattern).
- **Heartbeat cadence (30s) is a tunable constant.** RFC-020 Open Question #1 flags this; the right number depends on typical stage length. `DEFAULT_HEARTBEAT_MS = 30000` in `heartbeat.ts` makes it a one-line change later. Do not make it configurable via CLI in this SPEC (YAGNI); a constant is enough.
- **Byte-growth source must be confirmed per stage.** Build and plan tee `agents/{id}/{builder,planner}/raw-output.jsonl`. Review and patch-review may tee elsewhere or not at all — confirm in `adw-spec-review.ts` / `adws-modules/reviewer.ts` / `adws-modules/patch-reviewer.ts` during Step 9, and omit `teeFile` (elapsed-only heartbeat) where unknown. §C is the primary visibility for those stages regardless.
- **Do not change `BuilderDeps`'s method signatures in a breaking way.** Add `liveLabel?` as an optional field on the existing options object so `fakeDeps` in `test/unit/builder.test.ts` continues to satisfy the interface. `AGENTS.md` §3 (surgical changes) and the `BuilderDeps` docstring both govern here.
- **Live writes are best-effort.** Like the existing tee-to-file `appendFileSync` (wrapped in try/catch at `adw-build.ts:191`), the §C live-write, §B heartbeat write, §C2 phase markers, and §D1 verdict lines must not crash the pipeline if stderr is closed or unwritable. Wrap in try/catch; swallow on failure. Unit-test the heartbeat write-failure path explicitly because it runs from an interval.
- **Why §C2 is its own thing, not part of §B or §C.** §B's heartbeat answers "is it alive" (elapsed + byte growth) but is phase-agnostic — it can't say *which* of gather/gates/audit the iteration is in. §C's filtered tee only fires during the claude `audit` call because gates don't emit stream-json, so the longest silent stretches (typecheck, test:unit) get zero narration from §C. §C2 fills exactly that gap with one stderr line per phase transition, emitted by the dispatcher at the boundaries it already knows. The three mechanisms are complementary: §B = "alive," §C = "what claude is doing," §C2 = "which phase the stage is in." The operator's report — "patch-review just stays at `(iteration 1/3)` even though it's working through multiple iterations" — is precisely the gap §B+§C leave open and §C2 closes.
- **Why §D1 doesn't need a new helper module.** The data (`ReviewVerdictPayload.issues`) is already computed by `reviewer.ts`, already destructured at `adw-spec-review.ts:355-366`, and already written to `events.jsonl`. §D1 is a one-call-site format change at `:364`. Pulling it into a module would be premature abstraction (AGENTS.md §2) for a single 10-line formatter. Keep it inline in `adw-spec-review.ts`; if a second caller appears later, extract then.
- **§C2 must stay in sync with `runGates`'s tmax-use decision.** The `[patch-review] gates:tmax-use` marker is emitted from inside the existing `hasTmaxUseTargets(cwd)` branch in `adws/adws-modules/patch-reviewer.ts`. If the marker and the gate ever diverge (marker printed but gate skipped, or vice versa), the console lies. Do not duplicate the tmax-use detection in `adw-patch-review.ts`.
- **§D1 issue cap (10) is a readability choice, not a contract.** A badly broken spec can have 20+ issues; dumping all of them floods the console and pushes earlier output off-screen. 10 + `... (N more)` is a reasonable balance — the operator sees the shape of the problems and knows how many remain. The full list is always in `events.jsonl` for follow-up. Make the cap a named constant (`MAX_VERDICT_ISSUES_ON_CONSOLE = 10`) so it's a one-line change if it turns out wrong.
- **§C2 and §D1 do not change the orchestrator.** Both additions live inside the stage dispatchers (`adw-patch-review.ts`, `adw-spec-review.ts`), which run as child subprocesses spawned by `adw-plan-review-build-patch.ts:spawnStage`. The orchestrator already inherits the child's stderr (`stdio: ["ignore", "pipe", "inherit"]` at `:352`), so anything the child writes to stderr appears in the tmux window automatically. No orchestrator change is needed for §C2/§D1 — only §B touches the orchestrator.

## Audit findings (adw-patch-review 2026-06-21T10:54:45.904Z)

**Verdict:** gaps

The build implements all four pieces of SPEC-062 (§C live tool-use filter, §B heartbeat, §C2 patch-review phase markers, §D1 spec-review verdict line). The two new pure helpers (live-filter.ts, heartbeat.ts) have thorough unit tests (50 + 16 cases). §D1 has a dedicated verdict-line test (10 cases). All existing tests (builder, adw-build, adw-pipeline, adw-pipeline-loop, adw-patch-review) pass unchanged, typecheck/build are clean. The one gap: §C2 has no unit coverage for the runGates() onPhase callback, despite AC #9 explicitly requiring "unit coverage for the runGates() phase callback" and the testing strategy directing to "add focused coverage for the runGates() phase callback so gates:typecheck, gates:unit, and conditional gates:tmax-use are proven to fire before their respective runRaw calls." The implementation has the callback wired correctly (verified by code reading) and the existing patch-review tests still pass (proving the markers don't break control flow), but the explicit unit test was never added. The implementation also carries unrelated out-of-scope changes (tmaxUse? field on GateResults, runE2eGate in adw-build.ts) that belong to SPEC-061, not SPEC-062 — these don't violate SPEC-062's contract but expand the diff beyond what the spec authorized.

### Criteria
- **AC#1 — §C filter is pure and unit-tested: formatToolUseLine maps every nested assistant message.content[] tool_use block to [label] Name keyInput, returns null for other events, top-level type:tool_use, no-tool-call assistants, and malformed JSON.** — implemented: adws/adws-modules/live-filter.ts:85-118 (pure function, JSON.parse in try/catch at :87-91, type!=="assistant" check at :94, content array check at :98, multi-block join at :117); test/unit/live-filter.test.ts:1-154 (50 cases covering Edit/MultiEdit/Write/Read/Bash/Grep/Glob, top-level tool_use→null, text-only assistant→null, multi-tool_use blocks, malformed JSON, unknown tool fallback, label interpolation)
- **AC#2 — §C emits filtered live lines during orchestrated runs: when ADW_ORCHESTRATED=1, build and plan stages' runCapture prints one filtered line per nested assistant tool_use block to stderr. Standalone runs emit nothing.** — implemented: adws/adw-build.ts:173 (runCapture signature with liveLabel?), :194-199 (stdout handler emits filtered lines), :211-216 (close handler flushes trailing line), :508 (liveLabel = ADW_ORCHESTRATED === "1" ? "build" : undefined); adws/adw-plan.ts:168 (same signature), :188-193 and :206-211 (same emit logic), :329 (liveLabel = "plan" when orchestrated); adws/adws-modules/builder.ts:113 (liveLabel?: string on build()), :131 (spread into runCapture opts); adws/adws-modules/agent.ts:214 (liveLabel?: string on dispatch()), :228 (spread into runCapture). Verification via real-run validation step is not executable in this audit but wiring is correct.
- **AC#3 — §C is additive and default-off: BuilderDeps.runCapture's new liveLabel is optional; test/unit/builder.test.ts's fakeDeps passes unchanged; test/unit/adw-build.test.ts passes unchanged.** — implemented: adws/adws-modules/builder.ts:36 (runCapture opts adds liveLabel?: string as optional field — existing implementors remain valid); test/unit/builder.test.ts:30-49 (fakeDeps still satisfies BuilderDeps without setting liveLabel); test/unit/builder.test.ts + test/unit/adw-build.test.ts both pass (148/148 across the suite).
- **AC#4 — §B heartbeat helper is pure-ish and unit-tested: withHeartbeat emits N beats for N controlled timer advances, clears interval on resolve AND reject, computes byte deltas, degrades on absent/unreadable/shrinking teeFile, swallows write failures.** — implemented: adws/adws-modules/heartbeat.ts:42-73 (withHeartbeat with try/finally clear at :68-72, try/catch write at :65), :15 (DEFAULT_HEARTBEAT_MS = 30_000 constant), :76-78 (tryStatSize swallows errors), :83-92 (fmtElapsed with negative-clamp), :98-104 (fmtBytes with negative support); test/unit/heartbeat.test.ts:52-287 (16 cases: N-beats-for-N-advances, clear-on-resolve, clear-on-reject-and-rethrow, byte-delta growth, absent teeFile, teeFile appears mid-run, write-throws-no-crash on resolve and reject, fmtElapsed/fmtBytes edge cases incl. negative delta).
- **AC#5 — §B fires during each orchestrator stage: each deps.runX call in runPipeline is wrapped.** — implemented: adws/adw-plan-review-build-patch.ts:49 (import withHeartbeat), :578-581 (plan wrapped with planner/raw-output.jsonl teeFile), :618-621 (spec-review wrapped with reviewer/raw-output.jsonl), :645-648 (build wrapped with builder/raw-output.jsonl), :683-689 (patch-review wrapped with patch-reviewer/raw-output.jsonl and iteration-labeled stage), :728-734 (retry build wrapped as stage `build (retry N)`).
- **AC#6 — No on-disk contract change: events.jsonl and adw-state.json shapes unchanged; subprocess protocol (<id> <spec-path> stdout, --id/ADW_ORCHESTRATED env) unchanged.** — implemented: adws/adw-spec-review.ts:402-409 (review event shape unchanged: verdict/summary/issue_count/issues); adws/adw-patch-review.ts:450-456 (gather event shape unchanged), :466-471 (gates event retains typecheck/unit fields), :490-494 (audit event shape unchanged); orchestrator spawnStage env ADW_ORCHESTRATED unchanged. Note: an unrelated tmaxUse? field was added to GateResults (patch-reviewer.ts:67-73) but that is SPEC-061 scope, not SPEC-062; events.jsonl gates event itself still reports only typecheck/unit (adw-patch-review.ts:466-471), so the on-disk contract for §C2 is preserved.
- **AC#7 — No regression in existing tests.** — implemented: bun test test/unit/builder.test.ts test/unit/adw-build.test.ts test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts test/unit/adw-patch-review.test.ts → 148 pass / 0 fail across 5 files; new tests (live-filter, heartbeat, adw-spec-review-verdict-line) → 50 pass / 0 fail.
- **AC#8 — Typecheck/build clean.** — implemented: bun run typecheck (src + test + tmax-use + bench via tsc --noEmit) exits 0; bun run build (tmax + tlisp + tmax-use compile) exits 0.
- **AC#9 — §C2 patch-review shows phase transitions: gather, gates:typecheck, gates:unit, (gates:tmax-use only when targets exist), audit. markers do not change return value, event shapes, or stdout contract. Verified by unit coverage for the runGates() phase callback AND the real-run validation step.** — partial: Implementation present: adws/adw-patch-review.ts:405-412 (writePhase best-effort stderr writer), :448 (gather marker before gatherContext), :463-465 (onPhase callback into runGates), :488 (audit marker before audit); adws/adws-modules/patch-reviewer.ts:350-355 (GatePhase/RunGatesOptions types), :357-361 (safePhase try/catch wrapper), :369 (gates:typecheck before tcRes), :382 (gates:unit before unitRes), :397-398 (gates:tmax-use inside hasTmaxUseTargets branch only). GAP: no unit test exists for the runGates() onPhase callback (grep for onPhase/GatePhase/RunGatesOptions/runGates in test/ returns no matches). The spec's testing strategy explicitly directs adding focused coverage for the phase callback, and AC #9's verification clause requires it. The existing adw-patch-review.test.ts passes (proving control flow / return shape unchanged) which satisfies the indirect coverage allowance, but the explicit unit coverage is missing.
- **AC#10 — §D1 spec-review shows issue text on fail: fail verdict prints header + one bullet per issue (capped at 10 with ... (N more) tail), each issue truncated to ~200 chars and embedded newlines collapsed; pass verdict prints single verdict=pass line. events.jsonl review event unchanged.** — implemented: adws/adw-spec-review.ts:41-42 (MAX_VERDICT_ISSUES_ON_CONSOLE = 10, MAX_ISSUE_LEN = 200 constants), :58-82 (formatVerdictLine: pass→one-liner at :59-61, fail header with pluralization at :64, empty-issues early return at :65, slice+cap at :66, tail-when-remaining>0 at :71-72), :77-82 (collapseAndTruncateIssue: String coercion, newline/space collapse, 200-char truncation with '...'), :410 (process.stderr.write(formatVerdictLine(verdict)) replaces old count-only line); test/unit/adw-spec-review-verdict-line.test.ts:1-110 (10 cases: pass one-liner, 3-issue fail, 11-issue cap+tail, exactly-10 no-tail, >200 char truncation, embedded newline collapse, empty issues on fail, non-string coercion, pluralization). events.jsonl write at :403-409 is unchanged (still carries full issues array).

### Tests
- **§C formatToolUseLine maps nested assistant tool_use blocks (Edit/MultiEdit/Write/Read/Bash/Grep/Glob) to [label] Name keyInput** — covered: test/unit/live-filter.test.ts:19-52 (one test per tool name)
- **§C formatToolUseLine returns null for non-tool_use events (text deltas, tool_result, result, top-level tool_use, malformed JSON, assistant without tool calls)** — covered: test/unit/live-filter.test.ts:91-120 (six negative cases)
- **§C multi-tool_use assistant event returns one line per block** — covered: test/unit/live-filter.test.ts:124-135 (two Edit blocks → two lines joined with \n)
- **§C unknown tool name falls back to first string field; long inputs truncated** — covered: test/unit/live-filter.test.ts:66-87 (long Bash truncation, unknown-tool fallback, no-string-field fallback)
- **§B withHeartbeat emits N beats for N controlled timer advances; clears on resolve and reject; re-throws rejection** — covered: test/unit/heartbeat.test.ts:53-110 (three cases)
- **§B byte-delta computation, absent teeFile, teeFile appears mid-run** — covered: test/unit/heartbeat.test.ts:112-184 (three cases)
- **§B write callback throwing is swallowed on both resolve and reject paths** — covered: test/unit/heartbeat.test.ts:186-228 (two cases)
- **§B fmtElapsed / fmtBytes edge cases (0ms, sub-second, >1h, negative delta)** — covered: test/unit/heartbeat.test.ts:232-287 (fmtElapsed: 7 cases; fmtBytes: 6 cases including negative)
- **§D1 formatVerdictLine renders pass one-liner, fail with N issues, 11-issue cap + tail, exactly-10 no-tail, >200 char truncation, embedded newlines, empty issues, non-string coercion, pluralization** — covered: test/unit/adw-spec-review-verdict-line.test.ts:13-109 (10 cases)
- **§C2 runGates() onPhase callback fires gates:typecheck, gates:unit, conditional gates:tmax-use before each gate's runRaw call** — uncovered: grep across test/ for onPhase|GatePhase|RunGatesOptions|runGates( returns no matches. AC #9 verification clause and Step 11 testing strategy both direct adding focused unit coverage for the phase callback; not done.
- **§C2 dispatcher-level gather → gates → audit markers appear in order via stderr-capture** — uncovered: Spec Step 11 / testing strategy say 'If cheap, add one dispatcher-level test that injects a stderr-capturing writer and asserts the gather/gates/audit lines appear in order.' Not done (test/unit/adw-patch-review.test.ts has no runPatchReviewWithDeps-level test that captures stderr).
- **§C/§B integration via mocked PipelineDeps still passes (regression)** — covered: test/unit/adw-pipeline-loop.test.ts (148/148 across 5 test files pass; mocked deps resolve synchronously so the heartbeat interval clears before any beat fires — no hang, no stderr assertion failure)
- **BuilderDeps.runCapture optional liveLabel field doesn't break fakeDeps** — covered: test/unit/builder.test.ts:30-49 fakeDeps still typechecks and runs; tests pass unchanged

### Edge cases
- **Malformed stream-json line mid-stream — formatToolUseLine returns null, no throw, no crash of runCapture** — handled: adws/adws-modules/live-filter.ts:87-91 (JSON.parse in try/catch → null on SyntaxError); adws/adw-build.ts:195-198 (live-write wrapped in try/catch); test/unit/live-filter.test.ts:116-120 (three malformed fixtures)
- **Unknown tool name — graceful fallback to first string field** — handled: adws/adws-modules/live-filter.ts:49-51 (default branch calls firstStringField), :59-66 (firstStringField iteration); test/unit/live-filter.test.ts:75-87
- **claude emits no tool_use events for a long stretch — §C emits nothing, §B heartbeat still fires** — handled: live-filter.ts returns null for non-tool_use events (no emit); heartbeat.ts:53-66 interval fires independently of §C output. Combination verified by code reading.
- **Heartbeat teeFile doesn't exist yet (stage just started) — degrade to elapsed-only, no crash** — handled: adws/adws-modules/heartbeat.ts:51 (lastSize via tryStatSize → null on absent), :56-64 (nowSize null → elapsed-only branch); test/unit/heartbeat.test.ts:137-158
- **Heartbeat teeFile shrinks (truncated mid-run) — print negative delta, don't crash** — handled: heartbeat.ts:98-104 fmtBytes handles negative (sign prefix); test/unit/heartbeat.test.ts:282-286 (negative -1024 case asserts output contains '-' and 'KB')
- **Standalone adw-build.ts run (no orchestrator) — liveLabel unset, output identical to today** — handled: adws/adw-build.ts:508 (liveLabel = process.env.ADW_ORCHESTRATED === "1" ? "build" : undefined); adws/adw-plan.ts:329 (same gate for plan). No fixture-based test, but the env check is single-line and obvious.
- **ADW_ORCHESTRATED=1 but stderr is closed/redirected — runCapture must not crash** — handled: adws/adw-build.ts:195-198 and :211-216 (live-write in try/catch with `/* best-effort */` swallow); adws/adw-plan.ts:188-193 and :206-211 (mirror).
- **Pipeline tests with mocked deps that resolve synchronously — interval cleared before first beat fires** — handled: heartbeat.ts:68-72 (try { return await fn() } finally { clearInterval }); the four-stage orchestrator tests use synchronous mocked PipelineDeps and pass without hangs (148/148).
- **§C2 gate phase fails fast (non-zero exit) — gates:typecheck/unit/tmax-use markers must still appear sequentially** — handled: adws/adws-modules/patch-reviewer.ts:370 (spawn-failure returns Left, but non-zero exit returns Right with ok:false at :374-380), :382 (next safePhase fires regardless of prior gate's ok flag), :397-398 (tmax-use marker fires only when hasTmaxUseTargets). The marker is decoupled from gate success. No dedicated test for this specific scenario, but the control flow is straightforward.
- **§C2 tmax-use gate absent — gates:tmax-use marker must NOT appear** — handled: patch-reviewer.ts:397-398 (safePhase for gates:tmax-use is inside `if (hasTmaxUseTargets(cwd))` branch, same branch that runs the gate — they cannot diverge). No fixture test for this in the test suite.
- **§C2 stderr closed mid-iteration — phase-marker write throws, swallowed, iteration continues** — handled: adws/adw-patch-review.ts:410-412 (writePhase wraps process.stderr.write in try/catch); patch-reviewer.ts:358-361 (safePhase wraps callback invocation in try/catch).
- **§D1 malformed issue strings (very long, embedded newlines, non-string) — truncate, collapse, coerce** — handled: adws/adw-spec-review.ts:77-82 (collapseAndTruncateIssue: String() coercion, /[\r\n]+/ and /\s+/ collapse, 200-char slice with '...'); test/unit/adw-spec-review-verdict-line.test.ts:62-102 (long-issue truncation, embedded newlines, non-string coercion all covered)
- **§D1 empty issues array on fail verdict — render 'verdict=fail — 0 issues:' header only, no crash** — handled: adws/adw-spec-review.ts:65 (if (total === 0) return header — early return with header only); test/unit/adw-spec-review-verdict-line.test.ts:88-92
- **§D1 exactly 10 issues — no '... (N more)' tail; exactly 11 → tail says '... (1 more)'** — handled: adws/adw-spec-review.ts:71-72 (tail = remaining > 0 ? `  ... (${remaining} more)\n` : ""); test/unit/adw-spec-review-verdict-line.test.ts:36-60 (11-issue case asserts tail '(1 more)'; exactly-10 case asserts no 'more)' substring)

