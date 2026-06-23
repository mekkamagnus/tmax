# Watchdog Resume-All Gap — Disabled by Default on Day One

## Status

Accepted

## Context

SPEC-066 implemented a two-layer watchdog for pipeline stall/crash recovery (ADR-0106 is not to be confused with the ADR that doesn't exist for SPEC-066 itself — the watchdog implementation landed and its pipeline passed). The watchdog's Layer 2 (`adw-watchdog.ts`) was designed to scan `agents/*/adw-state.json` for stale-dead workspaces and auto-resume them.

On day one of production use (2026-06-23), the watchdog was auto-launched by `adw-launch.ts` alongside the SPEC-066 pipeline. Within minutes of SPEC-066 completing, the watchdog began **blindly resuming every stale-dead workspace in `agents/`** — including old, abandoned workspaces from prior sessions (SPEC-057, SPEC-059, SPEC-060, SPEC-061) that had been `failed` for days. These were specs no one had asked to re-run.

The watchdog was doing exactly what its design specified: `classifyWorkspace` found workspaces with `status != running` and no live `orchestrator_pid`, classified them as `stale-dead`, and the `takeAction` logic auto-resumed them (up to the 3/24h resume cap per workspace). The problem is that **most stale-dead workspaces are stale-dead for a reason** — the spec was abandoned, the build kept failing, or it was a test fixture. Blindly resuming all of them creates unbounded, unintended pipeline runs.

Concretely, the watchdog spawned 4 unintended orchestrator processes in ~30 minutes, each of which:
- Dirtied the working tree (concurrent builds editing the same files)
- Consumed LLM API budget (`claude -p` / `codex exec` calls on specs no one wanted)
- Created zombie workspaces that further confused status checks
- Risked corrupting work via concurrent tree edits

This is a **design gap in SPEC-066**, not an implementation bug. The watchdog's resume logic is mechanically correct but semantically unsafe: it treats "stale-dead" as "should be resumed" without distinguishing "freshly crashed, worth retrying" from "days-old abandoned, leave alone."

## Decision

**Disable the watchdog auto-launch by default.** The watchdog code stays (it passed its pipeline, it's correct in isolation), but `adw-launch.ts` no longer starts it unless explicitly requested:

- `noWatchdog` default flipped from `false` to `true` (watchdog OFF unless `--watchdog` is passed).
- `--watchdog` flag added as the explicit opt-in.
- `--no-watchdog` still accepted (now redundant but kept for clarity/docs).

This is a **safety hold**, not a permanent rejection. The watchdog is sound architecture; its resume-target selection is what's unsafe. Re-enabling requires fixing the resume-allowlist gap (see Consequences).

## Consequences

**Easier:** No more unintended pipeline runs. The working tree is only edited by pipelines a human explicitly launched. No zombie orchestrators consuming API budget or dirtying the tree. Status checks on `agents/` reflect only real, human-initiated work.

**Harder:** The stall/crash detection Layer 1 (in-process `withStallWatch` in `spawnStage`) still works — a hung `claude -p` subprocess is still killed within 5.5 min. But Layer 2 (external recovery of a parked/crashed orchestrator) is now dormant. A crashed orchestrator sits idle until a human notices and runs `--resume`, exactly as it did before SPEC-066. The watchdog's value (auto-recovery from the 3h17m / 8h dead-gap patterns observed on BUG-16) is lost until the resume gap is fixed.

**Re-enabling requires a follow-up.** The watchdog's `classifyWorkspace` / `takeAction` logic needs one of:
- **Resume allowlist:** only auto-resume workspaces explicitly flagged for auto-recovery (e.g. a `auto_resume: true` field in `adw-state.json`, set by `adw-launch.ts` when the human starts the pipeline). Old workspaces without the flag are left alone.
- **Max-age cutoff:** only auto-resume workspaces created within the last N hours (e.g. 6h). Days-old abandoned workspaces are ignored.
- **Both (recommended):** the allowlist handles "this specific run should auto-recover" and the max-age handles "don't touch anything from yesterday."

Either fix is a small change to `adw-watchdog.ts`'s `takeAction` function (add a condition before the `tmux new-window` spawn). Once landed and tested, flip `noWatchdog` back to `false` (default ON) and the watchdog's full value returns. File this as a follow-up spec/bug.

**Related:** SPEC-066 (the watchdog spec — its implementation is correct, this ADR addresses a runtime deployment decision), ADR-0101 (the test stage that motivated the watchdog by exposing the stall/crash patterns), the BUG-16 / SPEC-063 runs where 11 hours of idle wall-clock were lost to silent stalls (the watchdog's intended value proposition).
