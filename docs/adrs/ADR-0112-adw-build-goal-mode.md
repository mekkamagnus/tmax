# adw Build Stage `/goal` Mode — In-Session Iteration Loop

## Status

Accepted — implemented (CHORE-40); BUG-23 typecheck-gate interaction fixed.

## Context

The adw build stage dispatched a single `claude -p /implement <spec>` per attempt, and the orchestrator's external retry loop (build → test → patch-review → rebuild) spawned a **fresh claude session** for each retry. For large specs — CHORE-39 (7-phase functional editor rewrite, 44 api files, 336-line spec) — three build retries delivered only ~30% of the spec. Each retry re-read the spec, re-explored the codebase, and re-established plan state, wasting context and API budget on **re-discovery overhead**.

Claude Code's `/goal` command provides an internal loop: claude keeps working autonomously, running validation commands and fixing failures within a single session, retaining accumulated context. Smoke-tested on Claude Code v2.1.195 (captures at `agents/goal-smoke-2026-06-27/`): `/goal` dispatches headless with `-p --dangerously-skip-permissions --output-format stream-json`, loops internally across assistant turns, and exits 0 on both goal-met and goal-exhausted outcomes.

**Key smoke-test findings that shaped the design:**
- Exit 0 on both outcomes — so the CLI's `--max-turns` (which exits nonzero at the limit) is the **wrong** tool. Exhaustion is signaled only by a marker string in the final `result` event.
- The marker text appears in the prompt echo and Claude's reasoning earlier in the log. A whole-file grep produces false positives — the marker must be parsed from the `result` event's `.result` string **only**.
- `subtype:"success"` appears even on exhaustion, so `subtype` alone is not a goal-met signal.

## Decision

Add a `/goal` mode to the adw build stage that lets claude iterate within one session, while keeping the orchestrator's external retry loop as a fallback. Two layers with distinct roles:

- **Inner layer (Claude's `/goal` loop):** fast, context-retaining within one session. Bounded by `GOAL_TURN_LIMIT` (50) and the context window. The prompt embeds the instruction to run `/implement <specPath>` then continue until the goal condition is satisfied, with a clause to emit the `ADW_GOAL_EXHAUSTED` marker after the turn limit.
- **Outer layer (orchestrator retry loop):** slow, context-losing but carries the patch-review audit between iterations. On `goal-exhausted`, it narrows the next goal (`Continue from the current repository state...`) so the next session re-orients cheaply. After two consecutive `goal-exhausted` outcomes with no deterministic `RetryProgressSnapshot` improvement (diff fingerprint, failing validation count, unresolved patch-review count), it falls back to plain `/implement`.

**Mechanism:**
- A spec may declare `goal: "..."` in YAML frontmatter, or the operator passes `--goal <condition>`. `adws/adws-modules/spec-frontmatter.ts` is the single dependency-free parser for the `goal` field; it rejects malformed/unquoted `: ` values with a typed `SpecFrontmatterError` (the same bug class that broke 7 skill files in June 2026).
- `builder.buildImplementPrompt(specPath, goalCondition?)` constructs the prompt as a single argv element (never a shell string), preserving quotes/multiline content.
- Goal outcome is classified `goal-met` / `goal-exhausted` / `goal-error` by `classifyGoalOutcome()`, parsing **only** the final `result` event. The richer `goalStatus` crosses the subprocess boundary through a JSON sidecar at `agents/<id>/build-outcome.json` (not stdout — stdout stays `<id> <specPath>` for backward compat).
- Cost guardrail `MAX_GOAL_COST_USD`: noninteractive `claude -p` has no graceful early-stop channel, so the cap is enforced as a between-attempt guard (observed cost above the cap marks the outcome `goal-exhausted` with `goal-cost-exceeded`).

**BUG-23 (ADR-0108 interaction):** ADR-0108 (a)'s hard `typecheck:src` gate kills a build directly on compile failure. This is correct for classic `/implement` (a compile error means the LLM did something fundamentally wrong). **But it breaks the two-layer model for `goal-exhausted` builds** — when `/goal` exits exhausted, the tree is *expected* to be partially-refactored; a typecheck failure means "Claude didn't finish," not "structurally broken." If the gate hard-fails, patch-review never runs and the outer retry that CHORE-40 exists to enable is dead.

Fix: `shouldSkipTypecheckGate(gateOk, goalStatus)` skips the gate **only** on `goal-exhausted` (partial work proceeds to patch-review). `goal-met` / `goal-error` / classic builds still hard-fail (ADR-0108 (a) holds) — `goal-met` hard-fails because Claude's self-reported "green" is unreliable (the CHORE-39 exhausted summary claimed "tree is green" but the gate found failures).

## Consequences

**Easier:**
- A single claude session delivers more work per attempt on large specs than the orchestrator's fresh-session retry — avoiding re-discovery overhead is the core win.
- The two-layer model makes the handoff between layers explicit and observable (`goal-exhausted` events, narrowed retry goals, deterministic progress snapshots), eliminating the risk of silently looping an identical `/goal` session that exhausts at the same point.
- Backward compatible — specs without a `goal` and no `--goal` flag behave exactly as before.

**More difficult / open:**
- `/goal` requires Claude Code v2.1.139+ and the hooks system; unavailability (workspace trust, `disableAllHooks`, managed hooks) is detected from the build subprocess's raw error substrings and surfaced as `goal-error` with `goal-unavailable`.
- A 50-turn `/goal` run can cost 5–10× a single `/implement`. Operators enabling `--goal` on expensive models should set `MAX_GOAL_COST_USD`.
- Heartbeat integration (`goal_turn`, `goal_cost_usd` fields) is intentionally out of scope; Stop-hook events are not emitted to stream-json, so `goal_turn` must come from the assistant-message count, deferred to a follow-up after RFC-023.
- The `goalStatus` field is a new concept threaded through three layers (builder `BuildResult` → adw-build `BuildOutcome` → orchestrator `BuildOutcome`); the sidecar is the boundary contract.
