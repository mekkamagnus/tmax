# Chore: extract agent logic to `./adws/adws-modules/agent.ts`

## Chore Description

Extract the `claude -p` interaction logic out of `adws/adw-plan.ts` into a new module `adws/adws-modules/agent.ts`, leaving `adw-plan.ts` as the CLI wrapper + state tracker. The goal is a clean separation: **`agent.ts` = the LLM interface** (classify + dispatch via the `claude` CLI); **`adw-plan.ts` = the CLI/argv/state layer** that calls into it.

After this chore, `adw-plan.ts` no longer mentions `claude`, the classify prompt, stream-json, or `--model`/`--verbose` flags — all of that lives in `agent.ts`. And the extracted module uses the project's **canonical `Either`** (`src/utils/task-either.ts`) instead of the local `{ok,value}|{ok,error}` shape the script invented, matching the convention `adws/adw-run-e2e.ts` already follows.

### Scope boundary (locked from the planning conversation)

**Moves to `agent.ts`** (the "claude -p parts"):
- `CLAUDE`, `CLAUDE_MODEL` constants.
- `PlanType`, `SKILL_BY_TYPE` type/const.
- `CLASSIFY_PROMPT()` — the classify prompt builder.
- `classify()` — shells out to `claude -p --model … --output-format json`.
- `dispatch()` — shells out to `claude -p --model … --verbose --output-format stream-json`, tees to the planner log, snapshots/diffs `docs/specs/`.
- `snapshotSpecsDir()` / `diffSpecsDir()` — only used by `dispatch`, so they move with it.
- `pickType()` / `pickTypeFromEnvelope()` / `isPlanType()` — classify's response-parsing helpers, move with `classify`.

**Stays in `adw-plan.ts`** (NOT agent logic):
- `run()` / `runCapture()` — generic subprocess plumbing (spawn + capture + optional tee). Not LLM-specific.
- `adwId()` / `logState()` — run-state tracking (id minting + the `adw-state.json` ledger). Not LLM-specific.
- `parseArgs()` / `main()` / `ensureClaude()` — CLI entry point.
- Usage text, argv handling, exit codes, stdout/stderr discipline.

### Design decisions (locked)

- **Use the canonical project `Either`** from `../../src/utils/task-either.ts` (`_tag:'Left'|'Right'`, `.left`/`.right`, with `Either.left`/`Either.right`/`Either.isLeft`/`Either.isRight` helpers). This is what `adws/adw-run-e2e.ts` already imports (`../src/utils/task-either.ts`), so the new module is consistent with the existing convention. **This means dropping the local `Either`/`ok`/`err` helpers from the agent surface** and migrating the two moved functions to the canonical shape.
- **The generic `run()` stays in `adw-plan.ts`.** The agent module calls back into it via a passed-in `run` function (dependency injection) — see Step 2. This keeps `agent.ts` free of subprocess plumbing and makes the agent functions unit-testable with a mock `run`.
- **No new files beyond `agent.ts`.** No separate `run.ts` or `types.ts` — single module, single concern. `adws-modules/` is a new directory containing just this one file for now.

## Relevant Files

Use these files to resolve the chore:

### New Files

- **`adws/adws-modules/agent.ts`** — The extracted LLM-interface module. Exports `PlanType`, `SKILL_BY_TYPE`, `classify`, `dispatch`. Imports the canonical `Either` from `../../src/utils/task-either.ts`. No `main()`, no argv, no `logState`, no `adwId` — purely the two `claude -p` calls and their direct helpers.

### Existing Files to Modify

- **`adws/adw-plan.ts`** — Remove the moved functions/constants/types; import them from `./adws-modules/agent.ts`; keep `run`/`runCapture`/`adwId`/`logState`/`parseArgs`/`main`/`ensureClaude`. Migrate the **remaining** local-`Either` usages (in `run`, `parseArgs`, `ensureClaude`, `main`) to the canonical `Either` so the file is internally consistent and matches the new import. Net effect: the file shrinks by ~150 lines and gains one import line.

### Existing Files to Read (reference, not modify)

- **`src/utils/task-either.ts`** — The canonical `Either` definition to import. Key surface: `Either<L,R>` type, `Either.left(v)`, `Either.right(v)`, `Either.isLeft(e)`, `Either.isRight(e)`. Note the shape is `_tag:'Left'|'Right'` with `.left`/`.right` — **not** the `{ok,value}` shape `adw-plan.ts` currently uses, so every `res.ok`/`res.value`/`res.error` access in the moved code must be rewritten as `Either.isRight(res)`/`res.right`/`res.left`.
- **`adws/adw-run-e2e.ts`** — The precedent for an `adws/` script importing `../src/utils/task-either.ts` (line 50). Match its import path style. (Note: it uses `../src/...` because it lives in `adws/`; `agent.ts` lives one level deeper in `adws-modules/`, so it needs `../../src/...`.)
- **`docs/specs/CHORE-25-adw-plan-dispatcher.md`** — The original spec for `adw-plan.ts`. The behavior contract (classify → dispatch → state events → `<adw-id> <path>` stdout) must be preserved exactly. This chore is a pure refactor; no behavior change.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Task 1 — Create `adws/adws-modules/agent.ts` with types + constants

Create the directory and file. Start with imports and the exported surface. Use the canonical `Either`:

```ts
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
import { Either } from "../../src/utils/task-either.ts";
import { appendFileSync, readdirSync } from "fs";
import { join } from "path";

export type PlanType = "feature" | "bug" | "chore";
export const SKILL_BY_TYPE: Record<PlanType, string> = { feature: "feature", bug: "bug", chore: "chore" };

const CLAUDE = "claude";
// Intended target model: the higher-capability sonnet-tier model on this gateway.
// Explicitly pinned (not left to default resolution) because z.ai's default-model
// discovery can hang silently. NOTE: as of the troubleshooting session on
// 2026-06-17, `glm-5.2[1m]` itself hangs on api.z.ai (returns nothing, never
// exits) while `glm-4.7` and `glm-4.5-air` work. This is the *intended* end-state
// model; until the gateway/model is healthy, the live Validation Commands that
// invoke `claude` will stall. See the "Model availability risk" note below.
const CLAUDE_MODEL = "glm-5.2[1m]";

/** Injected subprocess helpers (shape matches the run/runCapture in adw-plan.ts). */
export interface AgentDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<Either<string, string>>;
  runCapture: (cmd: string, args: string[], opts: { cwd?: string; teeTo: string }) => Promise<Either<string, string>>;
}
```

- Verify: file exists; `bun -e 'import "./adws/adws-modules/agent.ts"'` resolves without error (syntax + import path check). Note: full typecheck coverage for `adws/` is addressed in Task 5.

### Task 2 — Move `classify()` (+ its prompt + parsers) into `agent.ts`, migrated to canonical `Either`

Move `CLASSIFY_PROMPT`, `isPlanType`, `pickType`, `pickTypeFromEnvelope`, and `classify` from `adw-plan.ts` into `agent.ts`. `classify` now takes `deps: AgentDeps` and a `cwd` so it can call the injected `run`. **Migrate the Either shape**: every `res.ok` → `Either.isRight(res)`, `res.value` → `res.right`, `res.error` → `res.left`.

```ts
function classifyPrompt(desc: string): string { /* ...unchanged body... */ }
function isPlanType(s: unknown): s is PlanType { /* ... */ }
function pickType(o: unknown): { type: PlanType; reason: string } | null { /* ... */ }
function pickTypeFromEnvelope(o: unknown): { type: PlanType; reason: string } | null { /* ... */ }

export async function classify(
  deps: AgentDeps,
  cwd: string,
  desc: string,
): Promise<Either<string, PlanType>> {
  const res = await deps.run(CLAUDE, ["-p", "--model", CLAUDE_MODEL, "--output-format", "json", classifyPrompt(desc)], { cwd });
  if (Either.isLeft(res)) return res;
  // parse res.right; on bad shape return Either.left(...); on good shape return Either.right(type)
  // (state-event logging stays in the caller — agent.ts is pure LLM I/O)
}
```

**Important:** the `logState(adwId, …)` calls that `classify` currently makes do **not** move — state tracking is not agent logic. The caller (`adw-plan.ts`'s `main`) is responsible for logging `classify`/`error` events around the call. Update `adw-plan.ts`'s `main` to log the classify event from the caller side after a successful `classify`, and log an `error` event on failure (Task 4).

- Verify: reading the new `classify` — it contains no `logState`, no `AGENTS_DIR`, no `adwId` references. It returns `Either<string, PlanType>` using the canonical constructors.

### Task 3 — Move `dispatch()` (+ snapshot/diff helpers) into `agent.ts`, migrated to canonical `Either`

Move `snapshotSpecsDir`, `diffSpecsDir`, and `dispatch`. `dispatch` takes `deps`, `cwd`, and the resolved `specsDir`/`agentsDir` paths (it writes the planner log into `agentsDir/{adwId}/planner/raw-output.jsonl`, so it needs the path — pass it in rather than re-deriving `PROJECT_ROOT`). **Keep `appendFileSync`/`readdirSync`** since `dispatch` owns the planner-log tee target setup (creating the dir, truncating the file) — that's LLM-output capture, which is agent logic. The actual line-by-line teeing happens inside the injected `runCapture`.

```ts
function snapshotSpecsDir(specsDir: string): Set<string> { /* ...reads specsDir, not global... */ }
function diffSpecsDir(before: Set<string>, specsDir: string): string | null { /* ... */ }

export async function dispatch(
  deps: AgentDeps,
  cwd: string,
  specsDir: string,
  plannerLog: string,            // full path: agents/{adwId}/planner/raw-output.jsonl
  type: PlanType,
  desc: string,
): Promise<Either<string, string>> {
  const skill = SKILL_BY_TYPE[type];
  const before = snapshotSpecsDir(specsDir);
  // mkdir + truncate plannerLog (as today)
  const res = await deps.runCapture(CLAUDE, ["-p", "--model", CLAUDE_MODEL, "--verbose", "--output-format", "stream-json", `/${skill} ${desc}`], { cwd, teeTo: plannerLog });
  if (Either.isLeft(res)) return res;
  const created = diffSpecsDir(before, specsDir);
  if (!created) return Either.left("skill ran but no new spec file appeared in docs/specs/");
  return Either.right(created);
}
```

**Same rule as Task 2:** `logState` calls move out — the caller logs `dispatch`/`result`/`error` events.

- Verify: `dispatch` has no `logState`/`AGENTS_DIR`/`adwId` references; returns canonical `Either`; its only filesystem writes are to `plannerLog` (truncate) and reading `specsDir`.

### Task 4 — Rewrite `adw-plan.ts` to import from `agent.ts` and wire `AgentDeps`

This is where the two halves meet. In `adws/adw-plan.ts`:

1. **Delete** the moved code: `PlanType`, `SKILL_BY_TYPE`, `CLAUDE`, `CLAUDE_MODEL`, `CLASSIFY_PROMPT`, `isPlanType`, `pickType`, `pickTypeFromEnvelope`, `classify`, `snapshotSpecsDir`, `diffSpecsDir`, `dispatch`.
2. **Add** imports: `import { PlanType, SKILL_BY_TYPE, classify, dispatch, AgentDeps } from "./adws-modules/agent.ts";` and the canonical `import { Either } from "../src/utils/task-either.ts";`.
3. **Migrate the remaining local-`Either` usages** (`run`, `runCapture`, `parseArgs`, `ensureClaude`, `main`) to the canonical shape. This means: `ok(v)` → `Either.right(v)`, `err(e)` → `Either.left(e)`, `res.ok` → `Either.isRight(res)`, `res.value` → `res.right`, `parsed.error` → `parsed.left`. Delete the local `type Either`/`ok`/`err` definitions.
4. **Build the `AgentDeps`** object in `main` from the local `run`/`runCapture`, and pass it to `classify`/`dispatch`:
   ```ts
   const deps: AgentDeps = { run, runCapture };
   const c = await classify(deps, PROJECT_ROOT, desc);   // then log classify/error event from here
   const d = await dispatch(deps, PROJECT_ROOT, SPECS_DIR, plannerLogPath, type, desc);  // then log dispatch/result/error
   ```
5. **Move the state-event logging into the caller** — `main` now logs `classify`/`error`(stage:classify) around the classify call, and `dispatch`/`result`/`error`(stage:dispatch) around the dispatch call, since `agent.ts` no longer calls `logState`.
6. Compute `plannerLogPath` in `main` as `join(AGENTS_DIR, id, "planner", "raw-output.jsonl")` and pass it to `dispatch`.

- Verify: `rg -n 'claude|CLAUDE_MODEL|CLASSIFY_PROMPT|stream-json|pickType' adws/adw-plan.ts` returns **zero matches** — all LLM specifics now live in `agent.ts`.
- Verify: `rg -n 'logState' adws/adws-modules/agent.ts` returns **zero matches** — state tracking stays in the caller.
- Verify: `rg -n "from \"./adws-modules/agent.ts\"" adws/adw-plan.ts` returns exactly one match.

### Task 5 — Add `adws/` to the typecheck graph

The new module imports from `src/utils/`, and `adws/adw-plan.ts` imports the new module — but `tsconfig.json`'s `include` is `['src/**/*','test/**/*','scripts/**/*','*.ts','*.tsx']`, so **`adws/` is currently not typechecked at all** (including the existing `adw-plan.ts`). Add `'adws/**/*'` to `tsconfig.json`'s `include` array so the refactor is actually verified by the compiler going forward.

- Verify: `bun run typecheck` now compiles `adws/adws-modules/agent.ts` and `adws/adw-plan.ts` (previously they were silently excluded). Any type errors introduced by the Either-shape migration surface here.
- Note: `adws/adw-run-e2e.ts` and `adws/adw-right-bracket-h.test.ts` will *also* become typechecked by this change. If they have pre-existing type errors (they may — they were never in the graph), that is **out of scope** for this chore; either fix only the errors in files this chore touches (`agent.ts`, `adw-plan.ts`) or, if the sibling files error, temporarily exclude them with a focused `exclude` entry and flag it in the Notes. Do not fix unrelated files as part of this chore (per the surgical-changes guideline).

### Task 6 — Run `Validation Commands`

Run every command in the Validation Commands section. All must pass with zero errors.

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `bun run typecheck` — zero TypeScript errors. Critically this now **includes** `adws/` (Task 5); confirm `agent.ts` and `adw-plan.ts` compile clean. If sibling `adws/` files newly error, see Task 5's note (out of scope — exclude + flag, don't fix).
- `rg -n 'claude|CLAUDE_MODEL|CLASSIFY_PROMPT|stream-json|pickType|isPlanType' adws/adw-plan.ts` — **zero matches** (all LLM specifics extracted).
- `rg -n 'logState|adwId|AGENTS_DIR|adw-state\.json' adws/adws-modules/agent.ts` — **zero matches** (no state tracking in the agent module).
- `rg -n 'child_process|spawn' adws/adws-modules/agent.ts` — **zero matches** (subprocess execution is injected via `AgentDeps`, not imported directly).
- `rg -n 'import.*task-either' adws/adws-modules/agent.ts adws/adw-plan.ts` — **two matches** (both files now use the canonical Either).
- `bun adws/adw-plan.ts --help` — still prints usage to stdout, exit 0 (CLI behavior unchanged).
- `bun adws/adw-plan.ts` — still prints usage to stderr, exit 1.
- `PATH=/usr/bin:/bin:/Users/mekael/.bun/bin bun adws/adw-plan.ts "x"` — dependency-guard error to stderr, exit 1, no `agents/` dir (unchanged).
- **End-to-end smoke test** (creates a real spec — clean up after): `bun adws/adw-plan.ts --chore "scratch agent-module refactor smoke test"` — prints `<adw-id> <docs/specs/CHORE-##-*.md path>` to stdout; spec exists; `agents/<adw-id>/adw-state.json` has `start`/`dispatch`/`result` events; `agents/<adw-id>/planner/raw-output.jsonl` is non-empty. **Then delete the scratch spec and the `agents/<adw-id>/` dir.** This confirms the refactor preserved the full behavior contract from CHORE-25.
- **Classify still works** (creates a real spec — clean up): `bun adws/adw-plan.ts "the editor crashes when pressing C-c in insert mode"` — classifies as `bug`, prints `<adw-id> <docs/specs/BUG-##-*.md path>`. **Then delete the scratch spec and agents dir.**

## Notes

**⚠️ Model availability risk (read before running Validation Commands).** This plan pins `CLAUDE_MODEL = "glm-5.2[1m]"` as the intended end-state model. As of the troubleshooting session on 2026-06-17, `glm-5.2[1m]` (and bare `glm-5.2`) **hangs silently on api.z.ai** — `claude -p` exits 124 (timeout) with zero output — while `glm-4.7` and `glm-4.5-air` work and respond in ~25s. Consequence: the end-to-end smoke tests in Validation Commands (the `bun adws/adw-plan.ts …` runs that actually invoke `claude`) **will stall** until the gateway/model is healthy. The static checks (`rg` grep guards, `typecheck`, `--help`/no-args/dependency-guard) still pass regardless of model. When implementing:
- Run the static checks first — they validate the refactor is correct regardless of model health.
- For the live smoke test, if `glm-5.2[1m]` is still hanging, temporarily swap `CLAUDE_MODEL` to `glm-4.7` locally to confirm the wiring end-to-end, **then revert to `glm-5.2[1m]`** before committing (it's the intended target). Do not commit `glm-4.7` — that was a debugging workaround, not the desired end-state.

**Why dependency-inject `run`/`runCapture` instead of importing them.** `agent.ts` could import `run`/`runCapture` from a shared module, but that creates a circular/layering dependency (the CLI layer owning subprocess plumbing that the agent layer needs). Passing them as `AgentDeps` keeps `agent.ts` pure (no `child_process` import, no filesystem outside its declared inputs) and makes `classify`/`dispatch` unit-testable with a fake `run` that returns canned `claude` responses — important since the real calls take 30s–4min and hit a live LLM.

**Why the caller logs state events, not the agent.** Mixing `logState` into `classify`/`dispatch` couples two concerns (LLM I/O vs run-state ledger) and makes the agent module depend on the `agents/` directory layout. Keeping `agent.ts` free of `logState`/`adwId`/`AGENTS_DIR` means it has exactly one job (talk to `claude`) and could be reused by a future caller that tracks state differently.

**Why migrate to the canonical `Either` even in `adw-plan.ts`.** Once `agent.ts` returns canonical `Either`, the caller must handle that shape anyway — so keeping a second, local `Either` in `adw-plan.ts` would mean two Either types in one file. Migrating the whole file to canonical is simpler and matches `adw-run-e2e.ts`. This is the one piece of "touch more than strictly necessary" in this chore, justified by internal consistency.

**`tsconfig` inclusion is a behavior change for `adws/`.** Before this chore, `bun run typecheck` did not compile `adws/` at all (it's absent from `include`). Adding `'adws/**/*'` means the existing `adw-run-e2e.ts` (38KB, never typechecked) and `adw-right-bracket-h.test.ts` become subject to typecheck. If they have latent errors, the chore's `bun run typecheck` will surface them — **those are pre-existing, not caused by this refactor**, and fixing them is out of scope. The plan's Task 5 note handles this: scope the fix to `agent.ts` + `adw-plan.ts`, and if siblings error, exclude them narrowly and flag.

**Not in scope (explicit non-goals):**
- Extracting `run`/`runCapture` into their own shared module (e.g. `adws-modules/run.ts`) for reuse by `adw-run-e2e.ts`. That's a worthwhile follow-up but a separate chore — this one is "extract the claude-p parts" only.
- Migrating `adw-run-e2e.ts` or `adw-right-bracket-h.test.ts` to share the new `agent.ts`. Those scripts don't currently classify/dispatch via `claude -p`; they drive the tmax daemon directly. No overlap.
- Changing the externally-observable behavior of `adw-plan.ts` (stdout shape, exit codes, state-file format, planner-log path). This is a pure refactor; the CHORE-25 contract is preserved.
- Adding unit tests for `agent.ts`. The DI design *enables* them (mock `AgentDeps`), but writing tests is a separate task — the validation here is the end-to-end smoke test.
