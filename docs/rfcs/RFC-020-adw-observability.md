# RFC-020: adw Pipeline Observability — Live Console Visibility

**Status:** Proposed
**Date:** 2026-06-21
**Related:** [SPEC-062-adw-observability](../specs/SPEC-062-adw-observability.md) (the chosen C+B subset), [RFC-019](RFC-019-performance-audit.md) (unrelated, sibling technical audit), [ADR-0094](../adrs/ADR-0094-adw-pipeline-architecture.md) (adw architecture)

## Summary

When an adw pipeline runs in a tmux window, the operator sees almost nothing between stage boundaries. The orchestrator prints one line per stage start and one per stage complete; a build can silently take 10–30 minutes with **zero** console output, making it impossible to tell a busy run from a hung one. This RFC catalogues seven observability improvements (A–G) identified during a tracing pass from `adw-launch.ts` → orchestrator → child stage → `claude` subprocess, ranks them by impact and cost, and records which subset (C + B) was accepted for implementation in [SPEC-062](../specs/SPEC-062-adw-observability.md). The rest are documented as candidates so they aren't lost.

This RFC is **not approved for implementation as a whole**; SPEC-062 is the implementation contract for the chosen subset. The remaining items (A, D, E, F, G) are deferred candidates to be revisited after the subset lands and is observed in real runs.

## Motivation

### Two operator questions that are currently unanswerable

1. **"What is the pipeline doing right now?"** During a healthy build, the operator sees:
   ```
   adw-plan-review-build-patch: stage 3/4 — build
   ```
   …then nothing for 10–30 minutes. The build stage dispatches `claude -p /implement` via `adws-modules/builder.ts`, which tees stream-json to `agents/{id}/builder/raw-output.jsonl` (good — survives crashes) but never surfaces any of it to the console. The orchestrator's `spawnStage` (`adw-plan-review-build-patch.ts:347`) inherits the child's stderr, but the child only emits ~3 lifecycle lines (start/dispatch/result) with a giant silent gap between dispatch and result.

2. **"Is it alive or hung?"** There is no heartbeat anywhere in the pipeline. The orchestrator awaits each `spawnStage` promise with zero time-awareness. A busy-silent stage and a stage hung on a dead gateway (a real risk — see the `glm-5.2[1m]` hang note in `adws-modules/agent.ts:28-31`) are indistinguishable for as long as the run is left unattended. The only recovery today is to attach, suspect a hang, and `Ctrl-C`.

### Why the silence exists — the two chokepoints

Tracing the visibility path end-to-end surfaced two independent root causes:

**Chokepoint 1 — `runCapture` swallows `claude`'s stderr entirely.** In `adw-build.ts:195-197`:
```js
child.stderr.on("data", (chunk) => { stderr += ... });  // buffered, never shown
```
On the success path (`:204`) `stderr` is discarded — it's only consulted in the `Either.left(...)` failure branch. But `claude` runs with `--verbose --output-format stream-json`, so its verbose progress stream goes to **stderr** (the comment at `adws-modules/builder.ts:127-130` even says so). During a healthy build the operator sees nothing because the one stream with live progress is buffered and thrown away. The same `runCapture` shape exists in `adw-plan.ts` (feeding `agent.ts`), so every claude-driven stage is equally silent.

**Chokepoint 2 — no time-awareness in the orchestrator.** `spawnStage` (`adw-plan-review-build-patch.ts:347-361`) is a bare `spawn` + `await close`. No timer, no proof-of-life signal. The orchestrator has no way to report "still running, 4m elapsed, output grew 128KB" because it never looks at the clock or the tee file.

A useful corollary: `raw-output.jsonl` is unreadable as-is — it's stream-json (`{"type":"assistant",...}`), so `tail -f` gives a wall of JSON, not "claude is editing src/foo.ts."

## Design

Seven improvements (A–G), grouped by what operator question they answer and where in the stack they live. Each is described in enough detail to become its own CHORE if adopted later.

### What's the pipeline doing? (live action narration)

#### C — Filtered tool-use tee in `runCapture`
**Where:** `adw-build.ts` `runCapture`, mirrored in `adw-plan.ts`'s equivalent. Also reusable by reviewer/patch-review capture paths.
**What:** Parse each stdout JSON line as it's teed and print only the high-signal subset:
```
[build] Edit src/editor/editor.ts
[build] Bash: bun run typecheck:src
[build] Grep "gapBuffer"
```
Filter: keep `tool_use` **name** + its key input (file path / command / pattern); skip every assistant `text` delta (the thinking/narration), skip `tool_result` bodies, skip token counts. Same density as glancing at a colleague's tmux — roughly 5–30 short lines/min depending on activity, all action, no prose.
**Cost:** ~45 min, reusable across all stages.
**Accepted for implementation in SPEC-062.**

#### A — Tee `claude`'s raw stderr to the console
**Where:** same `runCapture` handlers in `adw-build.ts` / `adw-plan.ts`.
**What:** In the `child.stderr.on("data")` handler, also write to `process.stderr`. One added line per stage's `runCapture`. Keep buffering for the failure-message path.
**Cost:** ~5 min, 2–3 files.
**Rejected for SPEC-062** — naive A clutters. `claude`'s `--verbose` stderr **is** the thinking stream (every text delta, tool-use event, token count), which is exactly the "all the thinking" the operator said they don't want. A's value (claude's own error/rate-limit messages) is recoverable later as a one-line stderr filter that only forwards lines matching `/error|rate limit|429|overloaded/i` — high signal, ~0 lines in the normal case. Recorded here as an optional add-on.

#### G — Plain-text `agents/{id}/live.log`
**Where:** each stage's `appendEvent` boundary, new sibling file.
**What:** Stages append human-readable lines (not JSON) here as they progress, so `tail -f` gives a readable stream separate from the machine-readable `events.jsonl`.
**Cost:** ~15 min; overlaps heavily with C. Defer until C is observed in practice — if C is enough, G is redundant.

### Is it still breathing? (proof of life)

#### B — Orchestrator heartbeat around each `spawnStage`
**Where:** `adw-plan-review-build-patch.ts`, wrapping each `deps.runX(...)` call.
**What:** A `setInterval` (every 15–30s) that prints one line:
```
[adw] build running — 4m12s elapsed, raw-output.jsonl +128KB since last beat
```
Cleared on resolve. The byte-count delta is proof of life: growth = the claude subprocess is still writing, even if no tool_use crossed the C filter this beat. Directly answers "is it stalled."
**Cost:** ~20 min, one file.
**Accepted for implementation in SPEC-062.**

#### E — Stall detection / watchdog in `spawnStage`
**Where:** `adw-plan-review-build-patch.ts` `spawnStage`.
**What:** If the child produces zero stdout AND zero file growth on its `raw-output.jsonl` for N minutes, kill it and fail the stage with a clear `stalled (no activity for Nm)` message instead of hanging forever. Turns infinite hangs into recoverable failures — the resume machinery in `loadWorkspace` already handles mid-run recovery.
**Cost:** ~30 min, one file; needs a tunable threshold. Defer until the heartbeat from B has been observed across a few real runs — the right N is easier to pick after seeing normal throughput. The risk is a too-aggressive N killing legitimate long thinks; B makes that risk observable before E is tuned.

### How do I check on a run without taking over the tmux pane?

#### D — `bun adws/adw-status.ts` dashboard
**Where:** new `adws/adw-status.ts` script.
**What:** Finds the most recent `agents/{id}/adw-state.json` (or takes `--id`), reads `status` / `completed_stages` / `patch_review_iterations`, tails the last line of each agent's `events.jsonl`, and shows current stage + elapsed since last event. Lets the operator check on a run from any terminal without `tmux attach`.
**Cost:** ~1–2 hrs. Best standalone follow-up after C+B land.

#### F — Rename the tmux window to reflect the stage
**Where:** orchestrator → `tmux rename-window` on each stage transition.
**What:** `adw-01ABC: build (3/4, iter 2)` visible in the tmux status bar without attaching.
**Cost:** ~10 min. Low-impact polish; useful only when the operator has the tmux session's status bar visible.

## Alternatives Considered

### "Just tee everything raw and let the operator scroll"
Rejected (this is A unfiltered). The operator explicitly asked for high-level updates, not all the thinking. Unfiltered stderr tee is the noisy option; the value is in the *filter*, which is C. A is retained only as a candidate for a narrow error-line filter.

### "Build a full TUI dashboard instead"
Rejected as the first step. D (`adw-status.ts`) covers the "check from another terminal" need at a fraction of the cost. A full TUI is a larger investment that's better motivated once D's plain-text output is observed to be insufficient.

### "Add stall detection (E) before the heartbeat (B)"
Rejected ordering. E's threshold is a guess without B's observation data. Land B first, watch a few runs, then tune E against measured throughput. E's risk (killing legitimate long thinks) is invisible until B makes normal throughput visible.

### "Do all of A–G at once"
Rejected. The operator asked for "high-level updates," which C + B deliver directly. The others are either clutter (A raw), polish (F, G), deferred-for-data (E), or standalone follow-ups (D). Landing C+B first and observing real runs is the cheapest way to learn which of the rest are actually needed.

## Phased Plan

```
Phase 1 (this RFC's implementation contract): SPEC-062 — C (filtered tee) + B (heartbeat).
  Verify: a real adw-build run shows one filtered tool_use line per action
  and one heartbeat line every 15–30s with byte-growth proof of life.

Phase 2 (candidates, revisit after observing Phase 1 in real runs):
  D — adw-status.ts dashboard (check runs without attaching tmux).
  E — stall watchdog in spawnStage (tuned against Phase-1 throughput data).
  A — narrow stderr filter (error/rate-limit lines only) if claude-side
       errors are being missed.
  F, G — polish, only if Phase 1 + D leave a real gap.
```

## Non-Goals

- **Changing the on-disk event/state contract.** `events.jsonl` and `adw-state.json` stay machine-readable JSON; the new output is console-only. G (`live.log`) would be the one exception if adopted, and it would be additive, not a replacement.
- **Changing the stage subprocess protocol.** The `<id> <spec-path>` stdout contract and the `--id`/`ADW_ORCHESTRATED` env contract stay as-is. C and B are observability layered on top, not protocol changes.
- **Replacing the `claude` CLI or the stream-json format.** C parses stream-json defensively (malformed lines skipped); it does not depend on claude's exact schema beyond the `tool_use` event shape.

## Open Questions

1. **Heartbeat cadence (15s vs 30s).** SPEC-062 picks a default; the right number depends on typical stage length, which is easier to measure once B is live. Make it a constant, easy to tune.
2. **Byte-growth source for B.** `raw-output.jsonl` is the obvious proof-of-life file for build/plan/review, but patch-review may not tee the same way — confirm each stage's tee target when implementing B, and degrade gracefully (omit the byte delta) when there's no known tee file.
3. **Whether C's filter should be configurable.** A future `--verbose` flag could widen the filter to include `text` deltas. Not in scope for Phase 1; the default stays action-only.
4. **Whether E and B should share the same activity signal.** E's watchdog and B's heartbeat both want "did the subprocess produce output recently?" — they should read the same byte-growth counter when E is built, to avoid two independent notions of liveness.

## Status & Trigger

**Phase 1 (C + B) approved for implementation in [SPEC-062](../specs/SPEC-062-adw-observability.md).** Phase 2 candidates (A, D, E, F, G) are documented here and revisited after SPEC-062 lands and the operator has watched real runs with the new output. No CHORE is pre-filed for Phase 2; each becomes its own CHORE when motivated by observed need.
