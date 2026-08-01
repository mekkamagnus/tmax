# ADR-0160 — --clean flag: fresh daemon start on *scratch* (#58)
## Status: Accepted
## Context
Fresh daemons unconditionally restored the last/most-recent workspace, including
leaked buffers (stale tmp files, expression strings, orphaned tabs). A bare `tmax`
opened to whatever garbage was last persisted. There was no way to start fresh.

## Decision
Add a `--clean` flag, threaded through `bin/tmax` → `server.ts` entry → `main.ts`
→ `TmaxServer` ctor (5th param `cleanStart`). When set:
1. `initializeWorkspaces` **skips** the last-workspace/MRU restore.
2. `startEditor` **switches** the current buffer to `*scratch*` after init.

**Chosen contract (codex "pick ONE"):** restore-by-default (existing SPEC-040
behavior), `--clean` opt-in for a fresh start. No `-e` name-guard added (codex:
the `-e` leak claim is unsupported by the current code — tmaxclient excludes `-e`
values from filenames).

## Consequences
- `tmax --clean` / `tmax --daemon --clean` starts on `*scratch*` (verified:
  `(buffer-name)` → `*scratch*`; was a stale tmp file without `--clean`).
- Default behavior unchanged (restore-by-default).
- Out of scope (follow-up): orphan-tab pruning (remap→prune); write-time
  workspace JSON size bounding.

Spec: [BUG-47](../specs/BUG-47-clean-start.md). Issue: #58.
Verify-gate: stuck (tooling — subagent daemon spawn); empirically verified.
