# Bug: daemon restores the persisted workspace on startup, polluting playbook runs (non-hermetic)

## Goals

- Make every tmax-use playbook **hermetic**: stale buffers/state from prior runs never leak into a new run.
- Allow buffer-counting playbooks (e.g. `eval-24`) to pass against the user's real HOME, not only under an isolated HOME.

## Completion Criteria (Definition of Done)

- [ ] A playbook that opens a fixed set of files is unaffected by buffers left in `~/.config/tmax/workspaces/default.json` from a previous run.
- [ ] tmax-use isolates the workspace per playbook (a fresh `TMAX_WORKSPACE_DIR` and/or `HOME`, mirroring how it already isolates the socket), OR the daemon's workspace-restore is sandboxed/disabled under tmax-use.
- [ ] `eval-24-next-previous-buffer.yaml` passes against the **real** HOME (currently fails there, passes only with isolated HOME).
- [ ] No stale `eval-NN-*` test buffers accumulate in `~/.config/tmax/workspaces/default.json` after a full `test:tmax-use` run.

## Bug Description

The daemon restores buffers from `~/.config/tmax/workspaces/default.json` on startup (workspace persistence). When tmax-use drives the daemon against the real HOME, those restored buffers include leftovers from earlier playbook runs, so the live buffer set is not what the playbook expects.

Concrete reproducer: `eval-24-next-previous-buffer.yaml` opens three files (A/B/C) and asserts the recency cycle `C→B→A→C`. With the real HOME it **FAILS** at `next-buffer from A wraps to C` because a 4th stale buffer (a leftover `eval-28-src.txt`) was restored, breaking the 3-buffer wrap. With an isolated `HOME=$(mktemp -d)` it **PASSES** (5.86s). Same code, same feature — only the restored workspace differs.

## Problem Statement

Workspace persistence is a user feature (survive restarts), but it makes the daemon non-hermetic for testing. tmax-use appears to isolate the socket but not the workspace, so cross-run state leaks in and turns buffer-counting playbooks flaky. This compounds BUG-60 (the readiness race) to produce the suite-wide flakiness.

## Solution Statement

tmax-use should launch each playbook's daemon with an isolated workspace directory (fresh temp `TMAX_WORKSPACE_DIR` per run, the same way it already allocates a unique socket), so the daemon never restores foreign buffers. Investigate whether the runner already sets `HOME` (the `embedded-save.tmax-use.ts` comment claims "isolated HOME + unique socket") and, if so, why the daemon path still restored the real workspace — the daemon may read `~/.config/tmax` from a different env source. Either thread the isolated dir through to the daemon or disable workspace-restore when `TMAX_WORKSPACE_DIR` points at a sandbox.

## Relevant Files

- `tmax-use/src/instance.ts` — HOME/workspace setup alongside the socket allocation.
- `src/server/` (or `src/core` workspace code) — workspace restore on daemon startup; the `~/.config/tmax/workspaces/default.json` path.
- `tmax-use/playbooks/eval-24-next-previous-buffer.yaml` — the failing-against-real-HOME / passing-against-isolated-HOME reproducer.

## Severity / Notes

- **Priority:** medium. A direct cause of playbook flakiness; pairs with BUG-60. Lower than BUG-60 because a clean HOME is a usable workaround for now.
