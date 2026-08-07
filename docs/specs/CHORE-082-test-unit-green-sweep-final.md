# Chore: test:unit green sweep — final hardening (#121 / CHORE-082)

## Chore Description
The `test:unit` sweep (#121) has cleared all *deterministic* failures under the real `bun run test:unit` invocation — the `<M-x>` tokenizer staleness, the `write-file-content` async fs asymmetry, and the save.tlisp + trt/assertions.tlisp module-env binding (BUG-74/#126) are all fixed (3 fixes landed: `5233870`, `7356870`). A 3-agent fan-out (catalog-all / #122-stall / runner-analysis) established:

- **Zero deterministic failures remain** under `bun run test:unit` (real HOME). All 205 non-adw files pass.
- **One latent CI-readiness bug:** `cache-save` writes `~/.config/tmax/backlink-cache.json` without `mkdir -p` on the parent — ENOENT under isolated HOME (`HOME=$(mktemp -d)`, i.e. CI). Passes on a dev box (real `~/.config/tmax/` exists). Plus `test/helpers/editor-fixture.ts` `expectRight` does `String(result.left)` on an `AppError`, masking the real error as `[object Object]`.
- **#122 stall root cause CONFIRMED:** `ensureCoreBindingsLoaded` — every `editor.start()` runs a synchronous 570-line T-Lisp eval (~200ms solo, 3–5s under batch concurrency). vim-bindings-smoke's 99 editors × that exceeds the 120s inactivity gap. A per-instance-safe fix exists (the forbidden global-memo is NOT needed), but the 3× no-stall DoD is CI-scale.
- **The runner stops at the first failing batch** (`scripts/run-unit-tests.ts:134`) — so the sweep historically saw one failure at a time. A `--continue` mode + better stall diagnostics would unblock the methodology + #122 diagnosis.

This chore lands the surgical, low-risk hardening: the cache-save mkdir fix, the `expectRight` error-stringify fix, and three runner improvements (`--continue` mode, stall diagnostics that name the test + dump active handles, and a `--max-concurrency` cap to mitigate the #122 stall). The #122 *full* cure (vim-bindings-smoke editor-count reduction / AST parse cache) + the 3× no-stall verification is explicitly out of scope here — it is CI work tracked in #122.

## Relevant Files
Use these files to resolve the chore:

- **`src/editor/tlisp-api.ts`** (~lines 1426, 1443-1452) — `cache-save`/`cache-load`: add `mkdirSync(dirname(cacheFilePath), { recursive: true })` before `writeFileSync` so it works under isolated HOME (CI). The latent ENOENT.
- **`test/helpers/editor-fixture.ts:286`** — `expectRight`: stringify the `AppError` properly (it has a `.message`/`.type`/`.variant`) instead of `String(result.left)` → `[object Object]`.
- **`scripts/run-unit-tests.ts`** — the runner: (a) `--continue`/`TMAX_UNIT_CONTINUE` mode (don't `process.exit` on first failing batch; report all); (b) stall diagnostics on the 120s inactivity fire (name the last `--dots` output + the batch's files + dump `process._getActiveHandles()`/`_getActiveRequests()`); (c) pass `--max-concurrency` (cap, e.g. 4) to `bun test` to mitigate the #122 stacking.
- **`test/unit/markdown-spec-039.test.ts`** — the latent-failure canary (passes after the cache-save mkdir fix under isolated HOME).

### New Files
None.

## Step by Step Tasks

### Fix `cache-save` ENOENT under isolated HOME

- In `src/editor/tlisp-api.ts`, before the `cache-save` `writeFileSync(cacheFilePath, …)`, ensure the parent dir exists: `mkdirSync(dirname(cacheFilePath), { recursive: true })` (guard the import — `dirname` from `node:path`, `mkdirSync` from `node:fs`).
- Confirm `cache-load` is already tolerant (read-miss returns gracefully — it should be, since the dev-box test passes).

### Fix `expectRight` error masking

- In `test/helpers/editor-fixture.ts` `expectRight`, replace `String(result.left)` with a proper stringify of the `AppError` (e.g. `` `${result.left.type}/${result.left.variant}: ${result.left.message}` ``), so future failures show the real message (e.g. the ENOENT) instead of `[object Object]`.

### Add the runner `--continue` mode

- In `scripts/run-unit-tests.ts`, add `const CONTINUE = process.env.TMAX_UNIT_CONTINUE === "1" || process.argv.includes("--continue");`.
- Change the batch loop (line ~132) to: on a non-zero batch, if `!CONTINUE` exit as today; else record the failure + continue. At the end, report all failed batch indices + exit non-zero if any failed. (Default behavior unchanged.)

### Add stall diagnostics to the inactivity timer

- In the inactivity-timer fire block (~line 107-114), include: the last ~3 lines of combined output (names the stalling test via `--dots`), the batch's file list, and a dump of `process._getActiveHandles()` / `process._getActiveRequests()` (constructor names) — per the BUG-16 learning. Keep the SIGKILL.

### Mitigate the #122 stall with a concurrency cap

- In `runBatch`, add `--max-concurrency=<N>` (e.g. 4) to the `bun test` args. This bounds the cross-file stacking that triggers the #122 stall. (A mitigation, not a cure — the full cure + 3× verification is #122's CI scope.)

## Validation Commands
Execute every command to validate the chore is complete with zero regressions:

- `bun run typecheck` — clean (src + test + tmax-use + bench).
- `bun test test/unit/markdown-spec-039.test.ts --timeout 8000` — passes (the latent cache-save canary), AND re-run with `HOME=$(mktemp -d)` to confirm the isolated-HOME ENOENT is fixed.
- `bun test test/unit/editor-api-registry.test.ts test/unit/module-system.test.ts --timeout 8000` — no regression to the API surface / module system.
- `TMAX_UNIT_CONTINUE=1 bun run test:unit` (or `bun scripts/run-unit-tests.ts --continue`) — the runner now runs ALL batches + reports all failures (not stopping at the first). Confirm it no longer exits at the first failing batch. (Note: the BUG-72 intermittent stall may still fire — that's #122; the `--continue` + diagnostics are the point here.)
- A representative daemon/save playbook still green: `HOME=$(mktemp -d) bin/tmax-use test tmax-use/playbooks/eval-28-write-file.yaml --reporter term`.

## Notes
- **#121's exit-0 is still gated on #122** (the BUG-72 intermittent stall). This chore lands everything that CAN be done inline: the deterministic failures are already fixed; this adds the latent CI-readiness fix + the runner hardening that makes the sweep + #122 diagnosable. The #122 full cure (vim-bindings-smoke editor-count reduction, the highest-leverage fix) + the 3× consecutive no-stall DoD verification are CI work — tracked in #122, whose root cause is now confirmed (`ensureCoreBindingsLoaded` cumulative cost) with per-instance-safe fix options identified.
- The runner's `--continue` mode is the key methodological unlock: future sweeps (and CI) see the WHOLE failing cluster in one run, not one-at-a-time.
- The stall diagnostics (last `--dots` test + handle dump) turn the #122 stall from a black box ("batch N no output") into a named culprit — directly enabling the CI reproduction.
- Investigated by a 3-agent fan-out (catalog-all / #122-stall / runner-analysis); findings cross-confirmed.
