# SPEC-233 — Upgrade Bun 1.3.14 → 1.4.4

Issue: #233 — umbrella: pin bump, full gates, behavior-change sweep
Status: implementing
Date: 2026-11-10

## Goal

Move tmax's runtime from Bun 1.3.14 (installed via PATH; the repo currently pins nothing) to Bun 1.4.4, with an explicit repo pin so dev machines and CI resolve the same version, all verification gates green, and the known 1.4 behavior changes audited. This is the umbrella for the `bun-v1.4.4-upgrade` cluster (#235–#245); those land separately on top.

## Design

- **Version pin**: add `.bun-version` containing `1.4.4` and pin `bun-version: 1.4.4` on every `oven-sh/setup-bun@v2` step in `.github/workflows/ci.yml` (5 steps, currently unpinned — local Bun comes via PATH, so nothing constrains CI to the tested runtime today).
- **Local runtime**: `bun upgrade` to 1.4.4 on this machine; rollback path is the versioned installer (`curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`).
- **Lockfile**: `bun install` regenerates `bun.lock` in the 1.4 format; commit it (zero runtime deps, so the diff should be format-only).
- **Behavior sweep** (audit, fix what trips): `toContain()` now `===` (NaN), `resetAllMocks()` drops implementations, `Temporal` defined + `toEqual` by value, fs/dns callback exceptions surface as `uncaughtException` (was `unhandledRejection`), paused-mode `readable.read()` returns one chunk. Audit = grep for the affected APIs + full suite green.
- **Baselines**: test:unit 2,421 tests / 796 s (documented 1.3.14 run; not re-measured — the 1.4.4 unit run took 9:27.90 wall); `bun run build` measured same-session on both runtimes (1.3.14 side-by-side binary): 2.07 s vs 2.88 s on 1.4.4. M-x first-open ~280 ms and per-key 2.85 ms baselines are unchanged (runtime work is the umbrella's children, #234/#236/#238). After-numbers recorded in the ADR.

## Completion criteria

1. `bun --version` reports `1.4.4` locally; `.bun-version` exists containing `1.4.4`; all 5 CI `setup-bun` steps pin `bun-version: 1.4.4`.
2. `bun run typecheck` green (all 4 tsc projects).
3. `bun run build` green (all 3 `bun build --compile` targets produce binaries).
4. `bun run test:unit` green solo (same population as the documented baseline run).
5. `bun run test:integration` green.
6. `bun run test:tmax-use` green solo (fresh `HOME`, stale daemons killed first — per BUG-61/learnings).
7. Behavior sweep documented in the ADR: for each of the six changes, either "no usage found" (grep evidence) or "fixed in <file>".
8. Live smoke on 1.4.4 with the repo-local daemon: `tmax --stop`, daemon start, `tmaxclient --eval` round-trip, embedded Steep start.
9. After-numbers recorded: test:unit wall clock and `bun run build` time on 1.4.4 vs the documented 1.3.14 baselines.
10. `bun.lock` regenerated under 1.4 and committed.

## Pre-existing breakage surfaced by the gate run (2026-11-10)

The first full `test:unit` under 1.4.4 aborted at batch 1 on `vim-dispatch.test.ts:314` ("swaps the visual anchor and changes the selection"). A/B against a side-by-side Bun **1.3.14** binary proved the failure **runtime-independent and deterministic** — and `gh run list` shows CI on `main` has been red since `9d33a96` (#231's push; only #230's was green). #232's deliberate visual-suite update missed this file: line 314 still asserted the old end-exclusive result `"bc"` (`v l o c` on `"abc"` deleting one char); the landed inclusive convention (and real vim) deletes `"ab"` → `"c"`. Corrected the assertion to `"c"` with a SPEC-232 comment — exactly the "position assertions change, no assertion weakened" update SPEC-232 prescribed.

The second run reached batch 37/54 and surfaced the same class in `test-key-bind-enhancements.test.ts:256`/`:270`: both pinned the pre-#231 default visual-`x` command `(visual-delete)`, which #231's flash work replaced with `(vim-visual-delete-flash)` (A/B under 1.3.14: same failure — pre-existing, not a 1.4 behavior change). Both assertions updated to the shipped default. These are fixes to #231/#232 gaps that CI had been reporting since 2026-09-07, not runtime-upgrade fallout.

The same sweep found two more instances outside `test:unit` (again A/B-confirmed under 1.3.14, i.e. pre-existing):

- `test/integration/module-system.test.ts` asserted the pre-#180 `describe-function` shape (data list with the module line at `[1]`) instead of the SPEC-113 helpful-style `*Help*` buffer. Invisible to CI (test:integration is not a CI job). Updated to assert the returned `"*Help*"` buffer name plus `From module: editor/commands/vim-dispatch` in the rendered text.
- Two tmax-use playbooks still assumed end-exclusive visual selections (SPEC-232 gap; this was the CI `test-tmax-use` red job): `eval-04-visual-mode.yaml` expected `"DEF GHI"` where inclusive selection also removes the `D` → `"EF GHI"`; `vim-parity-advanced.yaml` expected `v l l` from col 3 to delete only cols 3–4 (`"row1"`) where inclusive covers cols 3–5 (`"row"`). Both expectations corrected to the landed inclusive convention.

## Out of scope

Everything filed separately under `bun-v1.4.4-upgrade`: socket-lifecycle rework (#235), `--isolate`/`--parallel` (#237/#239), adw `--changed` (#240), CI sharding (#241), `Bun.stringWidth` adoption (#242), `memoryPressure` (#243), compile `--asset` spike (#244), `--retry` policy (#245). Also out of scope: fresh 1.3.14 benchmark runs (baselines are documented).
