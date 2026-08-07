# ADR-0182 — test:unit runner: `--continue` mode + stall diagnostics + concurrency cap (#121 / CHORE-082)

## Status

Accepted

## Context

The `test:unit` sweep (#121) was bottlenecked by the runner (`scripts/run-unit-tests.ts`)
in two ways, established by a 3-agent fan-out:

1. **Stop-at-first-failure:** the runner did `if (code !== 0) process.exit(code)` at the
   end of each batch (`:134`), so the sweep could only see ONE failing batch at a time —
   every fix revealed the next hidden failure. This made the sweep O(N) full-suite runs
   instead of 1.
2. **Bare stall diagnostics:** the 120s inactivity timer fired with only "batch N produced
   no output for 120s — failing" + a SIGKILL — no test name, no active-handle dump. So the
   BUG-72 / #122 stall was a black box each time it triggered.
3. **A latent CI-readiness bug:** `cache-save` wrote `~/.config/tmax/backlink-cache.json`
   without `mkdir -p`, so it ENOENT-failed under isolated HOME (CI) but passed on a dev box
   (real `~/.config/tmax/`). And `expectRight` stringified the `AppError` Left as
   `[object Object]`, masking the real error.

## Decision

1. **`--continue` / `TMAX_UNIT_CONTINUE=1` mode (opt-in, default unchanged):** the runner
   records each failing batch + continues through all batches, then reports every failed
   batch index. The sweep (and CI) now sees the WHOLE failing cluster in one run.
2. **Stall diagnostics:** on the inactivity-timer fire, emit the last ~3 lines of combined
   output (the `--dots` stream names the hung test), the batch's file list, + a dump of
   `process._getActiveHandles()` / `_getActiveRequests()` (constructor names) — per the
   BUG-16 learning. BUG-72 / #122 is now a named culprit, not a black box.
3. **`TMAX_UNIT_MAX_CONCURRENCY` cap (opt-in env, default unchanged):** forwards
   `--max-concurrency=N` to `bun test`, bounding the cross-file concurrency stacking that
   contributes to the #122 stall. A mitigation (the per-editor `ensureCoreBindingsLoaded`
   cost is the root cause), not a cure — but a tuning knob for CI.
4. **`cache-save` mkdir:** `mkdirSync(dirname(cacheFilePath), { recursive: true })` before
   the write — CI-ready.
5. **`expectRight` readable errors:** stringify the `AppError` (`type/variant: message`)
   instead of `[object Object]`.

## Consequences

- The sweep methodology is O(1) full-suite runs (with `--continue`) instead of O(N) —
  the whole cluster visible at once.
- BUG-72 / #122 stalls now leave a diagnostic trail (last test + handles) — directly
  enabling CI reproduction + the eventual fix.
- `cache-save` works under isolated HOME (CI-ready); test failures show real error messages.
- The #122 stall's full cure (vim-bindings-smoke editor-count reduction / per-instance
  parse cache) + the 3× no-stall DoD remain CI work — this ADR's runner hardening
  unblocks that diagnosis but does not itself close #122.
