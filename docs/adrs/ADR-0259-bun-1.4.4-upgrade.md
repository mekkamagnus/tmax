# Upgrade the runtime to Bun 1.4.4 (from 1.3.14, unpinned)

## Status

Accepted (2026-11-10) — implements #233 / SPEC-233. Umbrella for the `bun-v1.4.4-upgrade` cluster (#235–#245).

## Context

The repo ran Bun 1.3.14 by accident of PATH — no `.bun-version`, and the five `oven-sh/setup-bun@v2` steps in CI pinned no version, so CI resolved "latest" independently of whatever a developer had installed. Bun 1.4 (runtime rewritten in Rust) brings idle-CPU and memory reductions relevant to the long-running daemon, JSC speedups on tmax's hot paths (RegExp, string ops, Map/Set, JSON, hex `Buffer.from`), PTY/tty fixes under `src/core/pty.ts`, and ARMv8.0/aarch64 fixes relevant to the mekkapi host. 1.4.4 also carries security fixes that 1.3.14 lacks. These claims are sourced from the official release notes: https://bun.com/blog/bun-v1.4 (v1.4 announcements) and the 1.4.x patchnotes under https://github.com/oven-sh/bun/releases.

## Decision

**Pin Bun 1.4.4 everywhere and switch to it.** `.bun-version` (`1.4.4`) is the source of truth; every CI `setup-bun` step pins `bun-version: 1.4.4` explicitly (belt-and-braces — the pin in the file and the pin in the workflow must agree). Rollback is the versioned installer: `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"` plus reverting the two pin files.

Behavior-change audit (Bun 1.4 vs 1.3, swept 2026-11-10): `toContain()` now `===` — 1,292 uses, none with `NaN`; `resetAllMocks()` — zero uses; `Temporal` — zero uses; fs/dns exceptions → `uncaughtException` — zero `unhandledRejection` handlers exist; paused-mode `readable.read()` — no paused-mode reads (the `.read()` hits are async stream-reader loops); lockfile — `bun install` under 1.4.4 produced **no diff** (zero runtime deps).

## Consequences

- Gates under 1.4.4: **CI run [42690060877](https://github.com/mekkamagnus/tmax/actions/runs/42690060877) green on `issue-233` (all 5 jobs, incl. `test-tmax-use` — main's red job since `9d33a96`)**; locally: typecheck (4 projects, 25s) ✅; build (3 `bun build --compile` targets, 2.9s vs 2.1s on 1.3.14 — the Rust compile step is slightly slower per target, immaterial for a dev/CI step) ✅; test:unit solo ✅ (3,543 tests, all 54/54 batches, 0 fail per batch, 9:27.90 wall — the documented 1.3.14 baseline run was 2,421 tests / 796s on 2026-08-22; the population has since grown through landed work (#230, #231, #232, …), both runs cover the full current suite); test:integration ✅ (82/82, 12.9s); test:tmax-use solo ✅ (62/62 playbooks+tests, 333.18s). Both build timings taken same-session on this machine (1.3.14 via the side-by-side binary, 2026-11-10).
- Live smoke on 1.4.4: `tmax --stop` → `tmax --daemon` (socket up in <10s) → `tmaxclient --eval '(+ 1 2)'` ⇒ `3`, `tmax -e '(editor-mode)'` ⇒ `normal`, `(length (buffer-text))` ⇒ `30` (all rc=0); `tmax --stop` clean; embedded Steep (`bun src/main.ts <file>`) entered the alternate screen, rendered the file with cursor highlight, stayed alive 4s+, exited cleanly on SIGTERM — no lingering processes.
- Children of this umbrella (#235–#245) now have the runtime their flags/semantics require; `--isolate` (#237) is the next domino, then `--parallel` (#239, needs per-worker socket namespacing).
- CI no longer floats: every job resolves the exact runtime the gates were run against.
