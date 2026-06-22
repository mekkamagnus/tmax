# Feature: `/adw-plan` — Planning-Only adw Skill (plan → spec-review → revised spec)

## Feature Description

A new user-invokable skill, `/adw-plan`, that runs **only the planning half** of the adw pipeline and stops — leaving a reviewed, revised spec on disk and a resumable workspace. It is the planning counterpart to `/adw-implement` (which runs the full 5-stage pipeline).

`/adw-plan` runs a new 2-stage orchestrator, `adw-plan-reviewspec.ts`, through the existing tmux launcher:

```
plan → spec-review → (stop — revised spec on disk + resumable workspace)
```

The handoff to implementation is the key design point, and it works **two ways**:

1. **By workspace id** — `/adw-implement --resume <id>` auto-detects that `plan` and `review` are already completed and resumes at `build`. This works because the 2-stage orchestrator writes `status: "planned"` (not `"completed"`); the full orchestrator's resume logic refuses only `"completed"` workspaces, so a `"planned"` workspace resumes cleanly at the first incomplete stage (`build`).
2. **By spec path** — `/adw-implement docs/specs/SPEC-###.md` (no `--id`) discovers the `"planned"` workspace for that spec via `findWorkspaceBySpecPath` and resumes at `build`, **without the user ever needing the id**. The user just passes the same spec path `/adw-plan` produced. This lifts the spec-anchored discovery already used by the `adw-build` / `adw-spec-review` / `adw-patch-review` dispatchers into the full orchestrator's spec-path branch.

```
/adw-plan "description"                 →  plan → spec-review  (workspace status: "planned")
/adw-implement --resume <id>            →  build → test → patch-review  (skips plan + review)
/adw-implement docs/specs/SPEC-###.md   →  build → test → patch-review  (skips plan + review, via discovery)
```

The spec file itself is **not** mutated to embed the workspace id — discovery reads `agents/*/adw-state.json` (the source of truth) every time. See Notes for why embedding the id in the spec is rejected.

## User Story

As a **developer using the adw pipeline**
I want to **run only the planning + spec-review stages as a standalone skill, then hand the revised spec off to the build pipeline**
So that **I can review a generated spec before committing to a 30–90 minute build, iterate on the plan separately from implementation, and resume directly at build without re-running planning.**

## Problem Statement

Today the only user-facing entry point is `/adw-implement`, which runs the **entire** 5-stage pipeline (`plan → spec-review → build → test → patch-review`). There is no way to run just the planning half as a user action:

1. **No standalone planning entry point.** To get a reviewed spec without kicking off a build, a developer must drop to the raw dispatcher level (`bun adws/adw-plan.ts` then `bun adws/adw-spec-review.ts`) — two manual invocations, no shared workspace id by default, no tmux launch, no skill surface. The skill layer (`/adw-implement`) has no planning-only sibling.
2. **Plan and build are coupled.** `/adw-implement "description"` runs planning and immediately proceeds into a long build. If the generated spec is wrong or the spec-review upgrade is unsatisfactory, the developer discovers this only after a 30–90 minute build has started (or finished). There is no natural "review the plan, then decide to build" checkpoint exposed as a skill.
3. **Re-running planning on resume is wasteful.** The full orchestrator already supports resume (`--resume <id>` / `--id <id>`), and it already skips `plan` when a spec path is given as input. But there is no workflow that produces a workspace with `plan` + `review` already completed and `build` pending, so that `/adw-implement --resume <id>` skips straight to build. Today resuming a workspace either re-runs everything from a fresh id, or resumes an interrupted full run — never a deliberate "planning done, build not started" handoff.

## Solution Statement

Add three things:

1. **A new 2-stage orchestrator, `adws/adw-plan-reviewspec.ts`**, structurally a sibling of the existing `adw-plan-reviewspec-build.ts` (3-stage: plan → review → build) and `adw-plan-review-build-patch.ts` (5-stage). It runs `plan` then `spec-review` and stops. It mints (or accepts via `--id`) one workspace id, shares it across both child subprocesses, owns the single `agents/{id}/adw-state.json`, and prints `<id> <spec-path>` on stdout. Critically, on success it writes **`status: "planned"`** (a new terminal status for this orchestrator) with `completed_stages: ["plan", "review"]` — deliberately NOT `"completed"`, so the full orchestrator's resume logic picks it up at `build`.
2. **A new skill, `.zcode/skills/adw-plan/SKILL.md`**, mirroring `.zcode/skills/adw-implement/SKILL.md` in structure and front-matter. It validates the argument (free-text description or spec path) and launches `adw-launch.ts --script adw-plan-reviewspec.ts <arg>` in a detached tmux window, then reports the tmux window + attach instructions and stops.
3. **The resume handoff — two entry points, one small orchestrator change.** `/adw-implement` must resume the `/adw-plan` workspace from **either** the workspace id (`/adw-implement --resume <id>`) **or** the spec path (`/adw-implement docs/specs/SPEC-###.md`, no id). The id path already works today via `loadWorkspace` (it refuses only `status: "completed"`, so a `"planned"` workspace resumes at `build`). The spec-path path requires a **focused change to the full orchestrator**: today `runPipeline` mints a fresh id whenever a spec path is given without `--id`, so it re-runs spec-review+build from scratch. The change inserts `findWorkspaceBySpecPath` into the full orchestrator's workspace-id resolution — the same discovery the `adw-build` / `adw-spec-review` / `adw-patch-review` / `adw-test` dispatchers already perform — so a spec-path input reuses the most recent resumable workspace for that spec (the `"planned"` one `/adw-plan` just wrote) and resumes at `build`. A `"completed"` workspace is refused by `loadWorkspace`, so the existing "rebuild a finished spec" behavior is preserved (discovery finds it, loadWorkspace refuses, orchestrator mints fresh). `AGENTS.md` / `CLAUDE.md` get a note covering both handoff forms.

The 2-stage orchestrator reuses the exact `looksLikeSpecPath`, `loadWorkspace`, `spawnStage`, `tokensOf`, and `realDeps` patterns already proven in `adw-plan-reviewspec-build.ts` — it is that file with the build stage removed and the terminal status changed from `"completed"` to `"planned"`. The full-orchestrator change reuses the existing, tested `findWorkspaceBySpecPath` helper unchanged — no new discovery logic is written.

## Relevant Files

Use these files to implement the feature:

### Existing Files to Read (reference, not modify)

- **`adws/adw-plan-reviewspec-build.ts`** — The primary template. The new orchestrator is this file with stage 3 (build) removed. Copy its structure verbatim: file header comment, `USAGE`, `OrchestratorArgs` + `parseArgs` (minus `--model`, which only the build stage consumes), `looksLikeSpecPath`, `adwId()`, `appendEvent()`, `writeState()`, `WorkspaceState`, `ResumeContext`, `readWorkspaceState`, `recoverSpecPathFromEvents`, `loadWorkspace`, `PlanResult` / `SpecReviewResult` types, `spawnStage`, `tokensOf`, `PipelineDeps` (minus `runBuild`), `realDeps` (minus `runBuild`), `OrchestratorState`, `PipelineResult` (minus `build`), `runPipeline` (stages 1 + 2 only), `main()`, `import.meta.main` guard.
- **`adws/adw-plan-review-build-patch.ts`** — The 5-stage orchestrator. Two things matter here. (a) **`loadWorkspace`'s resume-refusal logic** (line ~270: `if (state.status === "completed") return Either.left(...)`) — it refuses only `"completed"`, and `STAGE_ORDER.find((s) => !completedStages.includes(s))` resolves `["plan","review"]` → `"build"`, which is why a `"planned"` workspace resumes at build via `--resume <id>` with no logic change. (b) **`runPipeline`'s workspace-id resolution** (line ~514: `const id = args.id ?? adwId();`) — today this mints a fresh id whenever a spec path is given without `--id`, so spec-path input re-runs spec-review+build from scratch. The spec-path handoff requires editing this one spot to consult `findWorkspaceBySpecPath` first (see "Existing Files to Modify" below). Read both spots before editing.
- **`adws/adws-modules/workspace.ts`** — `findWorkspaceBySpecPath(agentsDir, specPath)`: pure, synchronous, scans `agents/*/adw-state.json` for a matching `spec_path`, returns the newest matching workspace id (ULID ids sort chronologically) or null. Already used by `adw-build`, `adw-spec-review`, `adw-patch-review`, `adw-test`. Imported **unchanged** by both the new 2-stage orchestrator and (newly) by the full orchestrator's spec-path branch.
- **`adws/adw-plan.ts`** + **`adws/adw-spec-review.ts`** — The two child stages the orchestrator spawns. Their stdout contracts are the wiring the orchestrator parses: plan prints `<id> <spec-path>` (or `<id> -` on noop); spec-review prints `<id> <pass|upgraded|unchanged> <spec-path>`. No changes to either.
- **`adws/adw-launch.ts`** — The tmux launcher the skill calls. `--script adw-plan-reviewspec.ts` resolves to `adws/adw-plan-reviewspec.ts` (bare name → `adws/<name>`, per `resolveScriptPath`). `--resume <id>` is translated to `--id <id>` and forwarded. No changes.
- **`.zcode/skills/adw-implement/SKILL.md`** — The skill template to mirror for `.zcode/skills/adw-plan/SKILL.md`: front-matter (`name`, `description` with trigger phrases, `argument-hint`, `allowed-tools: Bash`, `user-invocable: true`), Usage examples, "What it does", "Invocation protocol" (validate arg → launch via tmux → report → stop), workspace artifacts, prerequisites, See also.
- **`test/unit/adw-pipeline.test.ts`** — The test pattern to mirror for the new orchestrator: mock `PipelineDeps` with canned `Either` returns + call-recording arrays, assert stage chaining, skip-when-spec-path, abort-on-plan-noop, resume via `loadWorkspace`, temp `agents/{id}/` cleanup in `afterEach`.

### Existing Files to Modify

- **`adws/adw-plan-review-build-patch.ts`** — One focused change in `runPipeline`'s workspace-id resolution (around line 514). Today: `const id = args.id ?? adwId();`. Change to: when `args.specPath` is set AND `args.id` is unset, call `findWorkspaceBySpecPath(AGENTS_DIR, args.specPath)`; if it returns a non-null id whose `loadWorkspace` succeeds (i.e. the discovered workspace is resumable — status is not `"completed"`), use that id and treat it as a resume (`resume` context populated, stages seeded from `completed_stages`). If discovery returns null OR the discovered workspace is `"completed"` (refused by `loadWorkspace`), fall back to minting a fresh id — preserving the existing "rebuild a finished spec" behavior. This is the change that makes `/adw-implement docs/specs/SPEC-###.md` resume a `"planned"` workspace at `build` instead of re-planning. Reuses the existing, tested `findWorkspaceBySpecPath` helper; no new discovery logic. Add an import for `findWorkspaceBySpecPath`. No other changes to this file.
- **`docs/specs/SPECS_INDEX.md`** — Add SPEC-064 under "ADW Pipeline & Testing"; increment the total count.
- **`.zcode/skills/adw-implement/SKILL.md`** — Add a one-line cross-reference in the "See also" section: `- /adw-plan — planning-only entry point (plan → spec-review); resume its workspace here with /adw-implement --resume <id> OR /adw-implement docs/specs/SPEC-###.md to skip straight to build.` (Pure documentation; the behavior change is in the orchestrator, not the skill.)
- **`AGENTS.md`** — In the "adw Pipeline (Agent-Driven Workflow)" section, add a short note under "Running a pipeline": `/adw-plan "<description>"` runs only plan → spec-review and leaves a resumable (`status: planned`) workspace; build it with either `/adw-implement --resume <id>` or `/adw-implement docs/specs/SPEC-###.md` — both skip straight to build. Mirror the same note in **`CLAUDE.md`** (the authoritative workflow doc; AGENTS.md mirrors it).

### New Files

- **`adws/adw-plan-reviewspec.ts`** — The 2-stage orchestrator (plan → spec-review, terminal). Mirrors `adw-plan-reviewspec-build.ts` minus the build stage; terminal status `"planned"`.
- **`.zcode/skills/adw-plan/SKILL.md`** — The user-invokable skill. Launches `adw-launch.ts --script adw-plan-reviewspec.ts <arg>` in tmux; reports window + attach instructions; documents **both** handoff forms (`/adw-implement --resume <id>` and `/adw-implement docs/specs/SPEC-###.md`).
- **`test/unit/adw-plan-reviewspec.test.ts`** — Unit tests for the 2-stage orchestrator (arg parsing, stage chaining, spec-path skip-plan, plan-noop abort, resume via `loadWorkspace`, terminal status `"planned"`, id-based cross-orchestrator handoff).
- **`test/unit/adw-plan-resume-by-spec.test.ts`** — Unit tests for the full-orchestrator spec-path discovery change (spec-path resume reuses `"planned"` workspace; `"completed"` falls through to fresh mint; `--id` precedence; newest-wins; free-text skips discovery).

## Implementation Plan

### Phase 1: Orchestrator (`adws/adw-plan-reviewspec.ts`)

Build the 2-stage orchestrator by adapting `adw-plan-reviewspec-build.ts`: drop the build stage, drop `--model`, change `StageName`/`STAGE_ORDER` to `["plan","review"]`, change terminal status to `"planned"`. Same `Either`/`TaskEither` composition, same subprocess plumbing, same checkpoint/resume support.

### Phase 2: Full-orchestrator spec-path discovery (`adws/adw-plan-review-build-patch.ts`)

One focused change so `/adw-implement docs/specs/SPEC-###.md` resumes the `"planned"` workspace at build instead of re-planning. Insert `findWorkspaceBySpecPath` into `runPipeline`'s workspace-id resolution; reuse the existing helper unchanged. Preserves the existing "rebuild a finished spec" behavior (`"completed"` workspace is refused by `loadWorkspace` → fall through to fresh mint).

### Phase 3: Skill (`.zcode/skills/adw-plan/SKILL.md`)

Write the skill front-matter + body mirroring `adw-implement`. The invocation protocol is identical except it passes `--script adw-plan-reviewspec.ts`. Add a prominent "Handoff" section documenting **both** `/adw-implement --resume <id>` and `/adw-implement docs/specs/SPEC-###.md`.

### Phase 4: Tests + docs

Write `test/unit/adw-plan-reviewspec.test.ts` mirroring `adw-pipeline.test.ts` (2-stage orchestrator). Add `test/unit/adw-plan-resume-by-spec.test.ts` for the full-orchestrator discovery change. Update SPECS_INDEX, the `/adw-implement` See also, and AGENTS.md/CLAUDE.md adw sections.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Orchestrator skeleton — `adws/adw-plan-reviewspec.ts`

- Create `adws/adw-plan-reviewspec.ts`. Start from a verbatim copy of `adws/adw-plan-reviewspec-build.ts`, then make these surgical edits:
  - **Header comment**: rewrite to describe the 2-stage pipeline (plan → spec-review, terminal). Update the usage examples, the stages list (drop build), the file-layout block (drop `builder/`), and the exit-code note.
  - **`StageName`**: `"plan" | "review"` (drop `"build"`).
  - **`STAGE_ORDER`**: `["plan", "review"]` (drop `"build"`).
  - **`USAGE`**: rewrite to describe plan → spec-review. Drop the `--model` line (no build stage consumes it). Keep `--feature`/`--bug`/`--chore`, `<description>`, `<spec-path>` (skip-plan), `--id`, `--from-stage <plan|review>`.
  - **`OrchestratorArgs`**: drop `modelOverride?: string`. Keep `description`, `forcedType`, `id`, `fromStage`, `specPath`.
  - **`parseArgs`**: drop the `--model` branch. Keep `--feature`/`--bug`/`--chore`, `--id`, `--from-stage` (validate against `"plan" | "review"` only), positional spec-path-vs-description detection via `looksLikeSpecPath`. Keep the `forcedType && specPath` conflict check and the `fromStage && !id` check.
  - Keep `looksLikeSpecPath`, `adwId`, `appendEvent`, `writeState` verbatim.

### Step 2: Orchestrator — resume + state types

- **`WorkspaceState.status`**: extend the union to `"running" | "completed" | "failed" | "planned"`. (The full orchestrator reads only `=== "completed"` to refuse resume; adding `"planned"` here is for this orchestrator's own type accuracy.)
- **`loadWorkspace`**: change the resume-refusal check from `if (state.status === "completed")` to `if (state.status === "completed" || state.status === "planned")` — a `"planned"` workspace is terminal *for this orchestrator* (both its stages are done), so resuming *this* 2-stage pipeline has nothing to do. (Note: this refusal is correct and intentional — the handoff to `/adw-implement` is a resume of the **full** orchestrator, which has no `"planned"` refusal and will accept it. Verify by re-reading `adw-plan-review-build-patch.ts` `loadWorkspace`.) Keep the description-recovery, completedStages inference (planner → plan, reviewer → review; drop the builder → build line), spec-path recovery, and `resumeFrom` auto-detection (`STAGE_ORDER.find` now scans only plan/review).
- **`ResumeContext`**, **`readWorkspaceState`**, **`recoverSpecPathFromEvents`**: unchanged (drop any `build`-specific handling — there is none in these helpers).

### Step 3: Orchestrator — stage types, deps, and `realDeps`

- **`PipelineDeps`**: drop `runBuild`. Keep `runPlan` and `runSpecReview` with identical signatures.
- **`realDeps`**: drop the `runBuild` entry. Keep `runPlan` and `runSpecReview` verbatim (they spawn `adw-plan.ts` / `adw-spec-review.ts` and parse the stdout contracts). No `--model` forwarding anywhere.
- **`PipelineResult.stages`**: `{ plan: PlanResult; review?: SpecReviewResult }` (drop `build`).
- **`OrchestratorState`**: drop nothing structurally, but `failed_stage` is now `"plan" | "review"` only.
- Keep `PlanResult` (`{ id; specPath: string | null }`) and `SpecReviewResult` (`{ id; specPath; kind }`) verbatim.

### Step 4: Orchestrator — `runPipeline` (stages 1 + 2 only)

- Adapt the 3-stage `runPipeline` by removing the build stage entirely:
  - Keep workspace-id resolution (`args.id ?? adwId()`), `loadWorkspace` resume, description resolution, `completedStages`/`specPath`/`stages` seeding, `state`, `finalize`, `checkpoint`, the initial state write, and the start/resume event.
  - **Stage 1 — plan**: identical to the 3-stage version. `shouldRunPlan = !args.specPath && (!resume || resume.resumeFrom === "plan")`. On `Left` → `failed_stage: "plan"`, finalize as failed. On `Right` with null specPath → abort ("plan produced no spec"). Record `stage-complete`, push `"plan"`, checkpoint. Skipped branch (spec-path input) records a skipped `stage-complete` event.
  - **Stage 2 — spec-review**: `shouldRunReview = !resume || resume.resumeFrom !== ... ` — since there is no build stage, review runs unless the workspace is already past it. Concretely: `shouldRunReview = !resume || resume.resumeFrom === "review"`. (When resuming and review already completed, `resumeFrom` will be past review and review is skipped.) On `Left` → `failed_stage: "review"`, finalize as failed. On `Right` → record `stage-complete` with `kind`, push `"review"`, checkpoint. Update all `N/3` progress messages to `N/2`.
  - **Finalize**: after review completes (or is skipped on resume), finalize as **`status: "planned"`** (NOT `"completed"`). The `finalize` helper writes the status — change the success branch from `status: "completed"` to `status: "planned"`. The failure branch stays `status: "failed"`. This is the single most important line in the whole feature: it is what makes `/adw-implement --resume <id>` resume at build.
  - Return `Right({ id, specPath, stages })`.
- **`main()`**: unchanged shape — print `<id> <spec-path>` on Right, error to stderr + exit 2 on Left, exit 1 on usage error. Drop any `--model` handling.
- `import.meta.main` guard: unchanged.

### Step 5: Full-orchestrator spec-path discovery — `adws/adw-plan-review-build-patch.ts`

This is the change that makes `/adw-implement docs/specs/SPEC-###.md` (no `--id`) resume a `"planned"` workspace at build instead of re-planning. One focused edit:

- Add `import { findWorkspaceBySpecPath } from "./adws-modules/workspace.ts";` to the imports.
- In `runPipeline`, change the workspace-id resolution block. Today (around line 514):
  ```ts
  const id = args.id ?? adwId();
  let resume: ResumeContext | null = null;
  if (args.id) {
    const loaded = loadWorkspace(args.id, args.fromStage);
    if (Either.isLeft(loaded)) return Promise.resolve(Either.left(loaded.left));
    resume = loaded.right;
  }
  ```
  Change to consult discovery when a spec path is given without `--id`:
  ```ts
  let id: string;
  let resume: ResumeContext | null = null;
  if (args.id) {
    id = args.id;
    const loaded = loadWorkspace(args.id, args.fromStage);
    if (Either.isLeft(loaded)) return Promise.resolve(Either.left(loaded.left));
    resume = loaded.right;
  } else if (args.specPath) {
    // Spec-path input: reuse the most recent resumable workspace for this spec
    // (the "planned" workspace /adw-plan just wrote), if one exists. A "completed"
    // workspace is refused by loadWorkspace below → fall through to fresh mint,
    // preserving the existing "rebuild a finished spec" behavior.
    const discovered = findWorkspaceBySpecPath(AGENTS_DIR, args.specPath);
    if (discovered) {
      const loaded = loadWorkspace(discovered, args.fromStage);
      if (Either.isRight(loaded)) {
        id = discovered;
        resume = loaded.right;
      } else {
        id = adwId();   // discovered but not resumable (e.g. completed) → fresh
      }
    } else {
      id = adwId();     // no prior workspace for this spec → fresh
    }
  } else {
    id = adwId();
  }
  ```
  - Emit a stderr line when discovery reuses a workspace: `adw-plan-review-build-patch: reusing workspace <id> for <specPath>` (mirrors `adw-spec-review.ts` line ~359). Emit it only on the discovered-and-resumable branch.
  - No change to anything downstream: `resume` is already threaded through `completedStages`/`specPath`/`stages` seeding, the plan/review skip conditions (`shouldRunPlan`/`shouldRunReview` already key off `resume.resumeFrom`), and checkpoint/finalize. When `resume.resumeFrom === "build"` (the `"planned"` case), plan and review are skipped and build runs.
  - `--from-stage` still works with discovery: it's passed through to `loadWorkspace` as today; if discovery found a workspace and the user also passed `--from-stage`, the override applies to the discovered workspace. (Edge case, but consistent — `--id` + `--from-stage` already behaved this way.)
- **Do not** change anything else in this file: not `parseArgs`, not `loadWorkspace` (it already refuses only `"completed"`, which is exactly what the fall-through needs), not the stage logic, not the retry loop. This is one block replacement + one import.

### Step 6: Skill — `.zcode/skills/adw-plan/SKILL.md`

- Create `.zcode/skills/adw-plan/SKILL.md`. Mirror `.zcode/skills/adw-implement/SKILL.md` structure:
  - **Front-matter**:
    ```yaml
    ---
    name: adw-plan
    description: "Run the planning half of the adw pipeline (plan → spec-review) via the tmux launcher, leaving a reviewed, revised spec and a resumable workspace. Takes a spec path or free-text description as the argument. Hand off to /adw-implement --resume <id> to build. Triggers on: adw-plan, adw plan, /adw-plan."
    argument-hint: '<spec-path-or-description>'
    allowed-tools: Bash
    user-invocable: true
    ---
    ```
  - **Title + overview**: "Run the 2-stage planning pipeline in a detached tmux window: `plan → spec-review` (stop). The pipeline runs in the `tmax` tmux session, surviving agent timeouts and terminal disconnects."
  - **Usage**:
    ```
    /adw-plan "add a URL bar to the status line"        # free-text → plan → spec-review
    /adw-plan docs/specs/SPEC-064-adw-plan-skill.md     # existing spec → spec-review only (plan skipped)
    /adw-plan --chore "rename adw-build-dispatcher"      # chore classification
    ```
  - **What it does**: numbered list mirroring adw-implement's, truncated to 2 stages: (1) Plan — classifies, dispatches to /feature|/bug|/chore, produces a spec; (2) Spec review — reviews via codex, upgrades in place if issues found. End with: "Stops after review. The workspace is left with `status: planned` and `completed_stages: [plan, review]`."
  - **Invocation protocol**: identical 4-step structure to adw-implement — (1) validate the argument (spec path or quoted free-text; if empty, report usage and stop); (2) launch via `bun adws/adw-launch.ts --script adw-plan-reviewspec.ts $ARGUMENTS`; (3) report the tmux window name + attach instructions (`Attach: tmux attach -t tmax`); (4) STOP — do not wait.
  - **Handoff to implementation** (NEW section, the key addition over adw-implement):
    ````md
    ## Handoff to implementation

    After /adw-plan completes, the workspace is ready to build. Resume it with the
    full pipeline — plan and review are auto-detected as completed and skipped. You
    can hand off two ways:

        # By workspace id (explicit):
        /adw-implement --resume <id>

        # By spec path (no id needed — the workspace is discovered automatically):
        /adw-implement docs/specs/SPEC-###.md

    Both run build → test → patch-review. The spec-path form finds the most recent
    resumable workspace for that spec (the `status: planned` one /adw-plan just
    wrote) via spec-anchored discovery, so you don't need to copy the id. If you
    pass a spec whose workspace is `completed` (a finished build), a fresh
    workspace is minted and the full pipeline re-runs from spec-review.
    ````
  - **Workspace artifacts**: mirror adw-implement's block but drop `builder/` and `patch-reviewer/` lines (this pipeline has neither). Keep `adw-state.json`, `orchestrator/events.jsonl`, `planner/events.jsonl`, `reviewer/events.jsonl`, `upgrader/events.jsonl` (upgrader runs conditionally inside spec-review).
  - **Prerequisites**: `tmux` + `tmax` session, `bun`, `claude` CLI (plan stage), `codex` CLI (spec-review stage).
  - **See also**: `adw-launch.ts`, `adw-plan-reviewspec.ts`, `/adw-implement` (for the build handoff).

### Step 7: Unit tests — 2-stage orchestrator (`test/unit/adw-plan-reviewspec.test.ts`)

- Mirror `test/unit/adw-pipeline.test.ts` structure: import `parseArgs`, `runPipeline`, `loadWorkspace`, types; mock `PipelineDeps` (now `runPlan` + `runSpecReview` only) with canned `Either` returns and call-recording arrays; `afterEach` cleanup of temp `agents/{id}/` dirs.
- Cases:
  - **parseArgs**: free-text description → `description` set; spec path → `specPath` set (plan will skip); `--feature`/`--bug`/`--chore` → `forcedType`; `--id <valid>` accepted; `--id <bad>` rejected (not 10-char ULID); `--from-stage plan|review` accepted; `--from-stage build` rejected (not a stage of this orchestrator); `--from-stage` without `--id` rejected; `--feature` + spec-path together rejected (conflict); `--model` rejected (unknown flag → pass-through, OR explicitly unsupported — assert it is not consumed); missing input → usage error.
  - **runPipeline — fresh description run**: plan returns spec → review returns `pass` → both stages called once, `stages.plan` + `stages.review` set, final `adw-state.json` has `status: "planned"` and `completed_stages: ["plan","review"]`, stdout-spec not asserted here (main does that). `runBuild` is NOT in the deps and must NOT be called.
  - **runPipeline — spec-path input skips plan**: `args.specPath` set → `runPlan` NOT called, `runSpecReview` called once with the spec path; `completed_stages` includes `"plan"` (seeded as skipped); status `"planned"`.
  - **runPipeline — plan returns null specPath (noop) → abort**: `runPlan` returns `Right({ specPath: null })` → pipeline returns `Left` mentioning "no spec", `failed_stage: "plan"`, status `"failed"`, `runSpecReview` NOT called.
  - **runPipeline — plan Left → abort**: `runPlan` returns `Left` → pipeline `Left`, `failed_stage: "plan"`, `runSpecReview` NOT called.
  - **runPipeline — review Left → abort**: plan ok, `runSpecReview` returns `Left` → pipeline `Left`, `failed_stage: "review"`.
  - **runPipeline — review upgraded/unchanged both succeed**: assert the `kind` is recorded in the `stage-complete` event and the result; status still `"planned"` (review gaps never block — there is no build to block).
  - **resume via loadWorkspace**: seed `agents/<id>/adw-state.json` with `status: "planned"`, `completed_stages: ["plan","review"]`, a description, and a spec_path → `loadWorkspace(id)` returns `Left("...already...planned...")` (refused — both stages done). Seed with `status: "running"`, `completed_stages: ["plan"]` → `loadWorkspace` returns `resumeFrom: "review"`; `runPipeline` with `--id` calls only `runSpecReview`, then finalizes `status: "planned"`.
  - **cross-orchestrator handoff assertion** (the crux): seed a workspace as `/adw-plan` would leave it (`status: "planned"`, `completed_stages: ["plan","review"]`, description + spec_path). Then import `loadWorkspace` from `adw-plan-review-build-patch.ts` (the full orchestrator) and assert it does NOT refuse it (returns a `Right` with `resumeFrom: "build"`). This guards the id-based handoff: if someone later adds a `"planned"` refusal to the full orchestrator's `loadWorkspace`, this test fails. (The spec-path handoff is covered by Step 8.)

### Step 8: Unit tests — full-orchestrator spec-path discovery (`test/unit/adw-plan-resume-by-spec.test.ts`)

- This file tests the Step 5 change to `adw-plan-review-build-patch.ts` in isolation. Mirror the mock-deps pattern from `test/unit/adw-pipeline-loop.test.ts` (which already tests the full orchestrator with mocked `runPlan`/`runSpecReview`/`runBuild`/`runTest`/`runPatchReview`). Seed real temp `agents/<id>/adw-state.json` files under a temp AGENTS_DIR; point the orchestrator at it. (The orchestrator reads `AGENTS_DIR` from a module-level const — if that const is not injectable, seed under the real `agents/` with throwaway ids cleaned in `afterEach`, exactly as `test/unit/adw-pipeline.test.ts` does.)
- Cases:
  - **Spec-path input reuses a `"planned"` workspace**: seed `agents/<id>/adw-state.json` with `status: "planned"`, `spec_path: <the spec path>`, `completed_stages: ["plan","review"]`, description. Call `runPipeline(realDeps_or_mockDeps, { specPath: <the spec path> })` (no `--id`). Assert `runPlan` NOT called, `runSpecReview` NOT called, `runBuild` called once → resume at build. Assert the final state id equals the seeded id (no fresh mint), and stderr (or the resume event in `orchestrator/events.jsonl`) records the reuse.
  - **Spec-path input with a `"completed"` workspace → fresh mint**: seed `agents/<id>/adw-state.json` with `status: "completed"`, same spec_path. Call `runPipeline` with the spec path. Assert a fresh id is minted (differs from the seeded id), `runSpecReview` IS called (the existing "rebuild a finished spec" behavior is preserved — no regression), and `runBuild` runs after.
  - **Spec-path input with no prior workspace → fresh mint**: no seeded state for that spec path. Assert fresh id, `runSpecReview` called, `runBuild` called. (Existing behavior, unchanged.)
  - **`--id` takes precedence over discovery**: seed a `"planned"` workspace for the spec, but call `runPipeline` with an explicit `--id <other>`. Assert the explicit id is used, not the discovered one (discovery is skipped when `--id` is set).
  - **Multiple workspaces for one spec → newest wins**: seed two `agents/` dirs for the same spec_path, both `"planned"`, with different ids. Assert the newer one (higher ULID) is discovered and reused. (Mirrors `findWorkspaceBySpecPath`'s documented newest-first behavior; this test guards the composition.)
  - **Free-text description (no spec path) → no discovery**: `runPipeline({ description: "..." })`. Assert a fresh id is minted; discovery is never consulted. (Existing behavior, unchanged.)

### Step 9: Docs — SPECS_INDEX, /adw-implement See also, AGENTS.md/CLAUDE.md

- **`docs/specs/SPECS_INDEX.md`**: add `- **SPEC-064** - /adw-plan — planning-only adw skill (plan → spec-review → revised spec; resume with /adw-implement --resume <id> or /adw-implement docs/specs/SPEC-###.md)` under "ADW Pipeline & Testing"; increment "Total Specs".
- **`.zcode/skills/adw-implement/SKILL.md`**: append to "See also": `- /adw-plan — planning-only entry point (plan → spec-review). Resume its workspace here with /adw-implement --resume <id> OR /adw-implement docs/specs/SPEC-###.md to skip straight to build.`
- **`AGENTS.md`** + **`CLAUDE.md`**: in the "adw Pipeline (Agent-Driven Workflow)" → "Running a pipeline" subsection, add a short note documenting `/adw-plan` as the planning-only entry point and both handoff forms (`--resume <id>` and spec-path). Keep it to 3–4 lines; do not restructure the section.

### Step 10: Validation

- Run every command in "Validation Commands". Every command must exit 0 (or print the expected USAGE/error for the negative `--help`/no-args cases). The typecheck + build + unit tests must all pass with zero regressions.

## Testing Strategy

### Unit Tests

Split across two files.

**`test/unit/adw-plan-reviewspec.test.ts`** (Step 7) — the 2-stage orchestrator. Fully mockable via `PipelineDeps` (`runPlan`, `runSpecReview`), so no real `claude`/`codex` subprocess is spawned. Assert:

- Stage chaining (plan before review; review never runs if plan aborts).
- Spec-path input skips plan.
- Plan-noop (null specPath) aborts before review.
- Resume via `loadWorkspace` skips completed stages.
- Terminal status is **`"planned"`** (the handoff contract) — never `"completed"` on success.
- The id-based handoff: a `"planned"` workspace is accepted by the full orchestrator's `loadWorkspace` and resumes at `"build"`.

**`test/unit/adw-plan-resume-by-spec.test.ts`** (Step 8) — the full-orchestrator discovery change. Uses the full orchestrator's mockable `PipelineDeps` (`runPlan`/`runSpecReview`/`runBuild`/`runTest`/`runPatchReview`) plus seeded real `agents/<id>/adw-state.json` files. Assert:

- Spec-path input reuses a `"planned"` workspace → skips plan+review, resumes at build, no fresh mint.
- Spec-path input with a `"completed"` workspace → fresh mint, spec-review re-runs (no regression to "rebuild a finished spec").
- Spec-path input with no prior workspace → fresh mint.
- `--id` takes precedence over discovery.
- Multiple workspaces for one spec → newest wins.
- Free-text description → no discovery, fresh mint.

### Integration Tests

Not added as a unit test. The end-to-end smoke is manual and now covers **both** handoff forms: `/adw-plan "<small description>"` in tmux, confirm `agents/<id>/adw-state.json` shows `status: "planned"`, then `/adw-implement --resume <id>` (id form) **and** `/adw-implement docs/specs/SPEC-###.md` (spec-path form) — each should start the full pipeline at build (stderr prints `stage 1/5 — plan [SKIPPED...]` and `stage 2/5 — spec-review [SKIPPED...]`, then `stage 3/5 — build`). Documented in Validation Commands as an optional manual check (requires `claude` + `codex` on PATH; takes minutes).

### Edge Cases

- `claude` missing → plan stage `Left` → orchestrator `Left`, `failed_stage: "plan"`, status `"failed"`.
- `codex` missing → review stage `Left` → orchestrator `Left`, `failed_stage: "review"`.
- Free-text description that classifies as a noop (skill writes no spec) → plan returns null specPath → orchestrator aborts with "no spec" (does NOT proceed to review).
- Spec-path input where the file does not exist → the plan stage is skipped (plan isn't invoked), but spec-review will fail to resolve the path → review `Left` → orchestrator `Left`, `failed_stage: "review"`. (Consistent with the existing 3-stage behavior.)
- Resume of a `"planned"` workspace **by this orchestrator** → refused (both stages done). Resume of the same workspace **by the full orchestrator** (via `--id` or spec-path discovery) → accepted, resumes at build. (All three asserted in Steps 7–8.)
- Resume of a `"failed"` workspace mid-pipeline (e.g. review failed) → `resumeFrom: "review"`, re-runs review only.
- `--from-stage review` with `--id` → forces re-running review even if it already completed (matches the 3-stage `--from-stage` semantics).
- **Discovery finds a `"completed"` workspace for the spec** → `loadWorkspace` refuses it → fall through to fresh mint → full pipeline re-runs from spec-review. (The "rebuild a finished spec" behavior is preserved; no regression. Asserted in Step 8.)
- **Discovery finds a `"failed"` workspace for the spec** → `loadWorkspace` returns `Right` (failed is resumable) → resume at the failed stage. (Consistent with existing resume semantics; discovery is just id resolution.)
- **Multiple resumable workspaces for one spec** (e.g. `/adw-plan` run twice) → `findWorkspaceBySpecPath` returns the newest (ULID-sorted). The older ones are left on disk untouched. (Asserted in Step 8.)
- **Embedding the workspace id in the spec file is rejected** (see Notes): discovery reads `agents/*/adw-state.json` every time, so the spec file is never a source of id truth. If a user manually edits the spec between `/adw-plan` and `/adw-implement`, the handoff still works because it doesn't depend on spec contents.

## Acceptance Criteria

1. **Orchestrator exists**: `adws/adw-plan-reviewspec.ts` follows the `parseArgs` → `runPipeline()` → `main()` → `import.meta.main` structure of `adw-plan-reviewspec-build.ts`, accepts `--feature`/`--bug`/`--chore`, `--id`, `--from-stage <plan|review>`, a free-text description, or a spec path, and prints `<id> <spec-path>` on success.
2. **Two stages only**: `STAGE_ORDER` is `["plan","review"]`; `PipelineDeps` has `runPlan` + `runSpecReview` and NO `runBuild`; `realDeps` spawns only `adw-plan.ts` and `adw-spec-review.ts`. The build stage is absent.
3. **Terminal status is `"planned"`**: on a successful run (or successful resume), `agents/<id>/adw-state.json` has `status: "planned"` and `completed_stages: ["plan","review"]` — NOT `"completed"`. On failure, `status: "failed"` with `failed_stage` set.
4. **`--model` is not accepted**: the 2-stage orchestrator has no build stage, so `--model` is not a recognized flag (it falls through to pass-through / is rejected as unexpected). No `modelOverride` field exists on `OrchestratorArgs`.
5. **Spec-path input skips plan**: passing a `SPEC/BUG/CHORE-*.md` path runs only spec-review and seeds `"plan"` into `completed_stages` as skipped (mirrors the 3-stage behavior).
6. **Plan-noop aborts**: if plan returns a null specPath, the orchestrator returns `Left` and does NOT invoke spec-review.
7. **Skill exists and is user-invokable**: `.zcode/skills/adw-plan/SKILL.md` has `user-invocable: true`, `allowed-tools: Bash`, trigger phrases including `/adw-plan`, an invocation protocol that runs `bun adws/adw-launch.ts --script adw-plan-reviewspec.ts $ARGUMENTS`, reports the tmux window, and stops. Its "Handoff to implementation" section documents **both** `/adw-implement --resume <id>` and `/adw-implement docs/specs/SPEC-###.md`.
8. **Id-based handoff works**: a workspace left by `/adw-plan` (`status: "planned"`, `completed_stages: ["plan","review"]`) is accepted by `adw-plan-review-build-patch.ts`'s `loadWorkspace` (NOT refused — only `"completed"` is refused) and resumes at `"build"`. Asserted by a unit test importing `loadWorkspace` from the full orchestrator.
9. **Spec-path handoff works (the core contract)**: `/adw-implement docs/specs/SPEC-###.md` (no `--id`) discovers the `"planned"` workspace for that spec via `findWorkspaceBySpecPath` and resumes at `build` — `runPlan` and `runSpecReview` are NOT called, `runBuild` IS called, and no fresh id is minted. Asserted by `test/unit/adw-plan-resume-by-spec.test.ts`.
10. **"Rebuild a finished spec" preserved (no regression)**: `/adw-implement docs/specs/SPEC-###.md` when the only workspace for that spec is `"completed"` → discovery finds it, `loadWorkspace` refuses it, the orchestrator mints a fresh id and re-runs spec-review + build. The pre-existing behavior is unchanged. Asserted by `test/unit/adw-plan-resume-by-spec.test.ts`.
11. **`--id` takes precedence over discovery**: when both an explicit `--id` and a discoverable workspace exist, the explicit id wins. Asserted by `test/unit/adw-plan-resume-by-spec.test.ts`.
12. **Resume within the 2-stage orchestrator is correct**: `loadWorkspace` refuses a `"planned"` workspace (nothing to resume here); resumes a `"running"`/`"failed"` workspace at the first incomplete stage among plan/review; honors `--from-stage`.
13. **No regressions**: `bun run typecheck:src`, `bun run typecheck:test`, `bun run typecheck` all exit 0; `bun run build` succeeds; `bun run test:unit` passes all existing tests plus the two new test files. The existing 3-stage orchestrator is untouched; the 5-stage orchestrator's change is isolated to workspace-id resolution and its existing tests (`adw-pipeline-loop.test.ts`, etc.) still pass.
14. **Docs updated**: SPECS_INDEX has SPEC-064; `/adw-implement` See also references `/adw-plan` with both handoff forms; AGENTS.md + CLAUDE.md note `/adw-plan` as the planning entry point with both the `--resume <id>` and spec-path handoff.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run typecheck:src` — Source typecheck, zero errors.
- `bun run typecheck:test` — Test typecheck, zero errors.
- `bun run typecheck` — Full project typecheck, zero errors.
- `bun run build` — Build succeeds.
- `bun test test/unit/adw-plan-reviewspec.test.ts` — 2-stage orchestrator unit tests pass (including the id-based handoff test).
- `bun test test/unit/adw-plan-resume-by-spec.test.ts` — Full-orchestrator discovery unit tests pass (spec-path resume, completed-fall-through, `--id` precedence, newest-wins).
- `bun run test:unit` — All unit tests pass, no regressions (existing `adw-pipeline.test.ts`, `adw-pipeline-loop.test.ts`, etc. unaffected — the 5-stage orchestrator's existing tests still pass with the workspace-id resolution change).
- `bun adws/adw-plan-reviewspec.ts --help` — Prints USAGE, exits 0.
- `bun adws/adw-plan-reviewspec.ts` (no args) — Prints usage error to stderr, exits 1.
- `bun adws/adw-plan-reviewspec.ts --from-stage build "<desc>"` — Rejected (`build` is not a stage of this orchestrator), exits 1.

**Optional manual end-to-end smoke (requires `claude` + `codex` on PATH; takes minutes):**
- `/adw-plan "add a one-line banner to the splash screen"` (or `bun adws/adw-launch.ts --script adw-plan-reviewspec.ts "<desc>"`) — launches in tmux; on completion, `cat agents/<id>/adw-state.json` shows `status: "planned"`, `completed_stages: ["plan","review"]`.
- **Id handoff**: `/adw-implement --resume <id>` (or `bun adws/adw-launch.ts --resume <id>`) — stderr prints `stage 1/5 — plan [SKIPPED...]` and `stage 2/5 — spec-review [SKIPPED...]`, then proceeds to `stage 3/5 — build`.
- **Spec-path handoff**: `/adw-implement docs/specs/<the-spec-adw-plan-produced>.md` (no `--id`) — stderr first prints `reusing workspace <id> for <spec>`, then the same SKIPPED plan/review → build sequence. Confirms the spec-path resume path works end-to-end without the user supplying the id.

## Notes

- **Why `status: "planned"` and not `"completed"`.** The full orchestrator's `loadWorkspace` refuses to resume any workspace with `status === "completed"` (it treats that as a terminal, nothing-to-do state). If the 2-stage orchestrator wrote `"completed"`, the handoff would break: `/adw-implement --resume <id>` (and the spec-path discovery path) would refuse with "already completed". `"planned"` is a new status value that means "planning half done, build half pending" — terminal *for the 2-stage pipeline* (its own `loadWorkspace` refuses it), but resumable *by the full pipeline* (whose `loadWorkspace` only refuses `"completed"`). This status choice is what makes the id-based handoff work with no logic change to `loadWorkspace`; the spec-path handoff additionally needs the discovery change in Step 5.
- **Why a new orchestrator file instead of modifying the 3-stage one.** `adw-plan-reviewspec-build.ts` (plan → review → build) is a working, tested pipeline. Removing its build stage in place would break its existing tests and its users. A sibling `adw-plan-reviewspec.ts` (plan → review, terminal) follows the established pattern of one orchestrator file per stage-combination (the repo already has a 3-stage and a 5-stage as siblings). Surgical: the 3-stage file is untouched.
- **Why `--model` is dropped.** `--model` in the 3-/5-stage orchestrators forwards exclusively to the build stage. The 2-stage orchestrator has no build stage, so `--model` has no consumer. Dropping it (rather than accepting-and-ignoring) avoids a misleading flag and keeps `parseArgs` honest. The plan stage uses the claude classifier; spec-review uses codex; neither takes a model override today.
- **Why review gaps never block here.** In the 3-/5-stage pipelines, spec-review `fail` → upgrade always continues to build (review gaps are non-blocking). In the 2-stage pipeline there is no build to continue to; review's outcome (`pass`/`upgraded`/`unchanged`) is recorded and the pipeline finalizes as `"planned"` regardless. The revised spec on disk is the deliverable; the developer reads it before deciding to build.
- **Two handoff forms, one orchestrator change.** The id-based handoff (`/adw-implement --resume <id>`) works through resume mechanics that already exist: `loadWorkspace` only refuses `"completed"`, and `STAGE_ORDER.find(s => !completedStages.includes(s))` over `["plan","review"]` returns `"build"`. The spec-path handoff (`/adw-implement docs/specs/SPEC-###.md`) needs one addition — the full orchestrator didn't previously consult `findWorkspaceBySpecPath` (only the individual dispatchers did), so a spec-path input minted a fresh id and re-ran spec-review. Step 5 lifts the existing, tested `findWorkspaceBySpecPath` helper into the full orchestrator's workspace-id resolution, reusing it unchanged. No new flag on `/adw-implement` is needed — resume already handles the stage-skip; discovery just feeds it the right id.
- **Why the workspace id is NOT embedded in the spec file.** Considered and rejected. (a) The spec is a design document; a workspace id is operational plumbing — coupling them conflates artifacts with state. (b) spec-review upgrades the spec in place (codex rewrites it), so an embedded id could be dropped or mangled and would need explicit preservation logic. (c) Drift: the embedded id goes stale on every re-plan or if `agents/` is cleaned up, whereas discovery reads the source of truth (`agents/*/adw-state.json`) live every time. (d) No perf benefit — `findWorkspaceBySpecPath` scans a handful of workspace dirs reading one JSON field each; there's no O(n) problem to solve. Discovery already exists, is tested (`test/unit/workspace.test.ts`), and is already used by four dispatchers; reusing it is strictly better than a new embed-and-read mechanism.
- **Cross-orchestrator state compatibility.** Both orchestrators read/write the same `agents/<id>/adw-state.json` shape (`adw_id`, `description`, `status`, `agents`, `completed_stages`, `spec_path`, `failed_stage`, `error`). The 2-stage orchestrator writes a subset (no `patch_review_*` fields); the full orchestrator reads only the fields it needs and ignores extras. No schema migration is required. `findWorkspaceBySpecPath` reads only the `spec_path` field, so it works against state files written by either orchestrator.
- **Resume-refusal asymmetry is intentional.** This orchestrator's `loadWorkspace` refuses `"planned"` (both its stages are done — nothing to resume *here*). The full orchestrator's `loadWorkspace` does NOT refuse `"planned"` (it has more stages to run). The unit tests in Steps 7–8 pin both sides of this asymmetry — and the spec-path discovery path — so a future edit to either `loadWorkspace` or the discovery wiring cannot silently break the handoff.
- **Scope of the 5-stage orchestrator change.** Exactly one block in `runPipeline` (workspace-id resolution) plus one import. `parseArgs`, `loadWorkspace`, the stage logic, the retry loop, and `main` are all untouched. The existing `adw-pipeline-loop.test.ts` and `adw-pipeline.test.ts` (for the 3-stage sibling) must still pass unchanged — the discovery branch only activates when `args.specPath` is set without `args.id`, which the existing tests don't exercise (they pass either a description or `--id`). The new `test/unit/adw-plan-resume-by-spec.test.ts` covers the new branch.
- **Out of scope.** No changes to `adw-plan.ts`, `adw-spec-review.ts`, `adw-launch.ts`, the 3-stage orchestrator (`adw-plan-reviewspec-build.ts`), or `findWorkspaceBySpecPath` itself. The 5-stage orchestrator gets exactly the one block + import described in Step 5. No new `package.json` scripts (the skill calls `bun adws/adw-launch.ts` directly, like `/adw-implement`). No ADR required (this is a straightforward sibling orchestrator plus a reuse of an existing helper, not an architectural decision).
