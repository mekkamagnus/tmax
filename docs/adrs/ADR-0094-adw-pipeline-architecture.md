# adw Pipeline Architecture — Agent-Driven Workflow

## Status

Accepted

## Context

Editor development lacked an automated pipeline for turning a feature description into a reviewed, implemented, and audited change. Each step (planning a spec, reviewing it, implementing it, auditing the implementation) was manual, requiring the developer to invoke separate tools (`/feature`, `adw-spec-review.ts`, `/implement`) and track state by hand. Long-running LLM calls (10–60 min each) were killed by agent tool-call timeouts (~10 min), and interrupted runs couldn't resume.

## Decision

Build the **adw (Agent-Driven Workflow) pipeline** — a set of TypeScript dispatchers and orchestrators that chain LLM-driven stages via subprocess composition:

1. **Individual dispatchers** (`adws/adw-*.ts`):
   - `adw-plan.ts` — description → spec (via `claude -p /feature|/bug|/chore`)
   - `adw-spec-review.ts` — spec → reviewed spec (via `codex exec`)
   - `adw-build.ts` — spec → implementation (via `claude -p /implement`)
   - `adw-patch-review.ts` — implementation → audit verdict (via `claude -p --json-schema`)
   - Each shares a common structure: `parseArgs` → `runX()` (the callable pipeline core) → `main()` → `import.meta.main` guard. Each accepts `--id <workspace>` for orchestrated mode and `ADW_ORCHESTRATED=1` env var for state-ownership delegation.

2. **LLM interface modules** (`adws/adws-modules/`):
   - `agent.ts` (classify + dispatch for plan)
   - `reviewer.ts` (review + upgrade for spec-review)
   - `builder.ts` (ensureAvailable + build for implement)
   - `patch-reviewer.ts` (gather + gates + audit for patch-review)
   - `workspace.ts` (spec-anchored workspace discovery)
   - `tmux-launcher.ts` (detached tmux window management)
   - Each is dependency-injected (`AgentDeps`, `BuilderDeps`, etc.), unit-testable, no CLI.

3. **Orchestrators**:
   - `adw-plan-reviewspec-build.ts` — 3-stage (plan → review → build), subprocess composition, shared workspace id, `--id`/`--from-stage` resume with auto-detection + checkpoint persistence.
   - `adw-plan-review-build-patch.ts` — 4-stage adding patch-review with a build↔patch-review retry loop (max 3 iterations).
   - `adw-launch.ts` — tmux launcher CLI that runs any dispatcher in a detached `tmax` tmux window.

4. **Shared workspace model**: one `adw_id` per spec. All stages write events under `agents/{id}/{agent}/events.jsonl`; the orchestrator owns the sole `agents/{id}/adw-state.json`. Spec-anchored discovery (`findWorkspaceBySpecPath`) reuses existing workspaces. Checkpoint writes after each stage ensure resume correctness.

## Consequences

**Easier:** A feature description can run through the full pipeline automatically. Resume works across interruptions (tmux + `--id`). Each stage's logs are isolated per agent. The pipeline is fully composable (orchestrators spawn children as subprocesses — zero coupling to internal APIs).

**Harder:** The pipeline takes 30–90 min end-to-end. The tmux launcher is required for runs longer than ~10 min. State management (checkpoint, resume, mid-loop counter) adds complexity. The `agents/` directory accumulates workspace dirs over time.

**Related:** ADR-0098 (FP foundations — `TaskEither`/`match`), ADR-0095 (browse-url — first feature run through the pipeline), SPEC-057/059/060 (adw specs), RFC-017 (agent activity log).
