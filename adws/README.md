# adws/ — Agent-Driven Workflow Pipeline

The **adw** package automates the full software-development cycle: **plan → spec-review → build → test → patch-review**, with a build↔patch retry loop. Each stage is a TypeScript dispatcher that spawns an LLM CLI (`claude -p` for build/test/patch-review, `codex exec` for spec-review) as a subprocess. Stages share one workspace id (`agents/{adw-id}/`) with event streams for observability.

## Pipeline overview

```
                         ┌─────────────────────────────────────────┐
                         │          adw-plan-review-build-patch    │  ← the full orchestrator
                         │                                         │
   description ─►  plan  ►  review  ►  build  ►  test  ►  patch-review
   (free text)    /feature   (codex)   (claude   (bun    (claude -p
   or spec-path   /bug                 -p /impl  test)   audit vs ACs)
   or --id        /chore               ement)            └─► pass | gaps
                                                                  │
                                                         gaps ──► loop back to build
                                                          │         (up to --max-retries, default 3)
                                                          └► after retries: release to completed
                                                             with patch_review_verdict: "gaps"
```

**Stages:**

| Stage | Dispatcher | LLM | What it does |
|-------|-----------|-----|--------------|
| **plan** | `adw-plan.ts` | `claude -p` (classifier) + skill | Classifies the description as feature/bug/chore, dispatches to the matching skill (`/feature`, `/bug`, `/chore`), which writes a spec to `docs/specs/`. **Skipped** when the input is an existing spec path. |
| **review** | `adw-spec-review.ts` | `codex exec` | Reviews the spec for implementability. If issues are found, upgrades the spec in place. Verdict: `pass` / `upgraded` / `unchanged` / `fail`. |
| **build** | `adw-build.ts` | `claude -p /implement` | Implements the spec against its acceptance criteria. Edits the working tree directly. |
| **test** | `adw-test.ts` | `claude -p` (resolve loop) + `bun test` | Runs `bun run test:unit` then `bun run test:tmax-use`. On failure, dispatches a focused resolve per failing test, then reruns. **Unit gates e2e** — if unit fails, e2e is skipped. 2-iteration resolve loop per track. Verdict: `pass` / `gaps`. |
| **patch-review** | `adw-patch-review.ts` | `claude -p` (audit) + `bun test` (gates) | Audits the build's working-tree diff against the spec's acceptance criteria. Runs typecheck + unit as gates first. Verdict: `pass` / `gaps`. |

**On GAPS:** the orchestrator loops back to build → test → patch-review, up to `--max-retries` (default 3). After the retry bound, the pipeline releases to `completed` with `patch_review_verdict: "gaps"` in the state file.

## Running a pipeline

### The easy way (via the launcher)

```bash
# Full pipeline from a description (plan runs first, creates a spec):
bun adws/adw-launch.ts "add a URL bar to the status line"

# Full pipeline on an existing spec (plan is skipped):
bun adws/adw-launch.ts docs/specs/SPEC-067-vim-parity-implementation.md

# Classify explicitly:
bun adws/adw-launch.ts --bug "unit suite hangs at ~750 tests"

# Resume an interrupted run:
bun adws/adw-launch.ts --resume <workspace-id>
```

`adw-launch.ts` runs the orchestrator in a detached tmux window inside the `tmax` session (created if missing), so long-running pipelines (30–90 min) survive terminal disconnects and agent session timeouts. The launcher returns immediately.

### Package.json shortcuts

```bash
bun run adw          # = bun adws/adw-launch.ts  (description/spec-path as next arg)
bun run adw:resume   # = bun adws/adw-launch.ts --resume
```

### The direct way (bypassing the launcher)

Each orchestrator can be invoked directly (no tmux, runs in foreground):

```bash
# Full pipeline:
bun adws/adw-plan-review-build-patch.ts docs/specs/SPEC-067-vim-parity-implementation.md

# Plan + review only (stops at "planned"):
bun adws/adw-plan-reviewspec.ts "add a feature"

# Plan + review + build (no test/patch-review):
bun adws/adw-plan-reviewspec-build.ts "add a feature"

# A single stage in isolation:
bun adws/adw-build.ts docs/specs/SPEC-067-vim-parity-implementation.md
bun adws/adw-test.ts docs/specs/SPEC-067-vim-parity-implementation.md
bun adws/adw-patch-review.ts docs/specs/SPEC-067-vim-parity-implementation.md
bun adws/adw-spec-review.ts docs/specs/SPEC-067-vim-parity-implementation.md
bun adws/adw-plan.ts "add a feature"
```

## Orchestrators vs. stage dispatchers

**Orchestrators** own the pipeline state (`agents/{id}/adw-state.json`), sequence the stages, and run the retry loop:

| Orchestrator | Stages | When to use |
|-------------|--------|-------------|
| `adw-plan-review-build-patch.ts` | plan → review → build → test → patch-review | **The default.** Full end-to-end. This is what `adw-launch.ts` runs. |
| `adw-plan-reviewspec-build.ts` | plan → review → build | When you want to implement but not audit (e.g. fast iteration). |
| `adw-plan-reviewspec.ts` | plan → review | When you want a reviewed spec but will implement manually. |

**Stage dispatchers** run a single stage. Useful for isolated runs, debugging, or when an orchestrator stage crashed and you want to re-run just that stage (via `--id`):

| Dispatcher | Stage | Output |
|-----------|-------|--------|
| `adw-plan.ts` | plan | `<id> <spec-path>` |
| `adw-spec-review.ts` | review | `<id> <pass\|upgraded\|unchanged> <spec-path>` |
| `adw-build.ts` | build | `<id> <spec-path>` |
| `adw-test.ts` | test | `<id> <pass\|gaps> <spec-path>` |
| `adw-patch-review.ts` | patch-review | `<id> <pass\|gaps> <spec-path>` |

All dispatchers share the same stdout contract: `<id> <verdict?> <spec-path>` on success, so the orchestrator can parse the result programmatically.

## The watchdog (disabled by default)

`adw-watchdog.ts` is a long-lived monitor that auto-resumes parked adw workspaces and alarms on live-but-stuck orchestrators. It implements SPEC-066's two-layer design:

- **Layer 1 (in-process):** `stall-detector.ts` wraps each stage's subprocess spawn; if the tee-file shows no growth for 5 min, it SIGKILLs the child process group and surfaces it as a stage error the retry loop handles.
- **Layer 2 (external):** `adw-watchdog.ts` polls `agents/*/adw-state.json` every 60s, classifies each workspace (healthy / stale-dead / stale-alive / not-running), and auto-resumes stale-dead ones (up to 3/24h) or alarms on stale-alive ones (desktop notification, no auto-kill).

**⚠️ Disabled by default** (ADR-0106). The watchdog's resume logic resumes ANY stale workspace, including days-old abandoned ones, which caused unintended pipeline runs on day one. Pass `--watchdog` to `adw-launch.ts` to opt in, or run it directly:

```bash
bun adws/adw-watchdog.ts --once          # single scan + print (dry run, no actions)
bun adws/adw-watchdog.ts --poll-ms 60000 # long-lived monitor
```

Re-enabling by default requires a resume-allowlist or max-age cutoff (see ADR-0106).

## Workspace artifacts

All stages share one workspace id (`agents/{adw-id}/`). The id is a 10-char Crockford Base32 ULID-timestamp.

```
agents/{id}/
├── adw-state.json              # pipeline state (status, spec_path, completed_stages, orchestrator_pid)
├── orchestrator/events.jsonl   # stage transitions (start, stage-complete, loop-retry, error)
├── planner/                    # plan stage
│   ├── events.jsonl
│   └── raw-output.jsonl
├── reviewer/                   # spec-review stage
│   ├── events.jsonl
│   └── raw-output.jsonl
├── upgrader/                   # spec-review upgrade (if issues found)
│   └── events.jsonl
├── builder/                    # build stage
│   ├── events.jsonl
│   └── raw-output.jsonl
├── tester/                     # test stage
│   ├── events.jsonl
│   ├── raw-output.jsonl
│   ├── unit-resolve-it*.jsonl  # per-failing-test resolve logs
│   ├── e2e-resolve-it*.jsonl
│   └── results.json            # normalized TestStageResult (verdict, counts, iterations)
└── patch-reviewer/             # patch-review stage
    ├── events.jsonl
    ├── raw-output.jsonl
    ├── gather.md               # the full diff + spec for the auditor
    └── verdict.json            # pass | gaps
```

## Modules (`adws-modules/`)

Each stage dispatcher delegates its LLM interaction to a dependency-injected module. Modules import no `child_process` directly — they use injected `run` / `runRaw` / `runCapture` functions, making them fully unit-testable with mocks.

| Module | Stage | Role |
|--------|-------|------|
| `agent.ts` | plan | Classifies the description via `claude -p` and dispatches to the matching skill. |
| `reviewer.ts` | review | The codex interface — reviews and optionally upgrades the spec. |
| `builder.ts` | build | The `claude -p /implement` interface — parses stream-json, tees output. |
| `tester.ts` | test | Runs unit + e2e tracks, owns the 2-iteration resolve loop, writes `results.json`. |
| `patch-reviewer.ts` | patch-review | Runs gates (typecheck + unit), gathers the diff, audits via `claude -p`. |
| `stall-detector.ts` | (watchdog L1) | `withStallWatch` — monitors tee-file growth, kills on 5-min stall. |
| `heartbeat.ts` | (shared) | `withHeartbeat` — periodic stderr lines reporting elapsed time + byte growth. |
| `live-filter.ts` | (shared) | Stream-json line filter for real-time dispatcher output shaping. |
| `tmux-launcher.ts` | (launcher) | Runs adw scripts in a detached tmux window. |
| `workspace.ts` | (shared) | Spec-anchored workspace discovery (find a workspace by spec path). |

## Resume semantics

Every orchestrator and stage dispatcher accepts `--id <workspace-id>` to resume an interrupted run:

1. Reads `agents/{id}/adw-state.json`.
2. Auto-detects which stages already completed (via `completed_stages` and/or the presence of stage event files).
3. Resumes at the first incomplete stage.

`--from-stage <stage>` overrides auto-detection, forcing resume to start at a specific stage (skipping earlier ones even if incomplete). Requires `--id`.

State persists after each stage, so resume is always correct — even if the orchestrator was killed mid-run. There is no mid-stage resume (the resolve loop inside the test stage is not checkpointed internally); re-running the whole stage on resume is acceptable.

## Testing the adw package itself

Unit tests live alongside the dispatchers and in `test/unit/`:

```bash
# adw-specific unit tests:
bun test test/unit/adw-pipeline.test.ts test/unit/adw-pipeline-loop.test.ts \
  test/unit/adw-test.test.ts test/unit/adw-watchdog.test.ts \
  test/unit/adw-plan-reviewspec.test.ts test/unit/adw-plan-resume-by-spec.test.ts \
  adws/adw-right-bracket-h.test.ts

# Full project suite (includes the above + everything else):
bun run test:unit
```

The pipeline tests (`adw-pipeline*.test.ts`) use `mkdtempSync` temp dirs — they do not write to the real `agents/` directory (ADR-0105).

## Architecture references

- **ADR-0094** — adw pipeline architecture (the original 4-stage design)
- **ADR-0101** — adw-test pipeline stage (5-stage, unit gates e2e)
- **ADR-0104** — test-stage wall-clock timeout + process-tree kill
- **ADR-0106** — watchdog resume-all gap (disabled by default)
- **SPEC-061** — tmax-use (the e2e runner the test stage exercises)
- **SPEC-066** — the watchdog spec
