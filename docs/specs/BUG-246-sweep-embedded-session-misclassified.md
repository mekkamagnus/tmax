# Bug: sweep misclassifies a live embedded-Steep session (`src/main.ts`) as stale-recycled — `--apply` would unlink its live socket

## Bug Description

Observed live (2026-11-11, herdr play session): `bin/tmax /tmp/tmax-play.md`
starts the embedded Steep path — one process `bun …/src/main.ts <file>` that
owns and serves the canonical daemon socket `/tmp/tmax-<uid>/server` (verified:
`bin/tmaxclient --eval '(+ 40 2)'` → `42` against it). `bin/tmax --sweep`
(dry-run) then classified that live process as:

```
pid 17338  kind=stale-recycled  age=59s  socket=/tmp/tmax-501/server
```

Per `reapCandidate` (`src/server/sweep.ts`), stale-recycled pids are NOT
signalled, but their **lock + socket files are removed**. So
`tmax --sweep --apply` on a machine with a live embedded session unlinks the
socket that process is actively serving: subsequent clients get ENOENT, and the
next `tmax` start sees a free-looking socket while the old process still
listens.

## Problem Statement

Process identity for the sweep is decided solely by `TMAX_DAEMON_RE`
(`src/server/sweep.ts:92`):

```
/\bbun\b.*(?:src\/server\/server\.ts|bin\/tmax\b)/
```

Two blind spots, both binding the daemon socket:

1. `bun …/src/main.ts <file>` — the embedded-Steep path (`bin/tmax <file>`
   execs `bun src/main.ts …`; observed live above).
2. `…/dist/tmax …` — the #244 single binary (ADR-0271); it runs WITHOUT a
   `bun` prefix at all (code inspection; not yet reproduced live).

Because the RE misses these, `discover()` never adds them as live candidates
(`livePids`), so their lock falls to branch 2 → `classifyStaleLock` → pid is
alive → `stale-recycled` → lock + socket removed from under the live process.

Additionally, `canonicalPids()` (lsof owners of the canonical socket) is
consulted ONLY to sub-classify processes that already matched the RE — a live
owner of the canonical socket can still fall into the stale-lock path.

## Solution Statement

Two complementary changes in `src/server/sweep.ts` (identity stays in this one
module):

1. **Extend `TMAX_DAEMON_RE`** to recognize the embedded and compiled-binary
   launch shapes:
   - `src/main.ts` joins the bun-prefixed alternatives;
   - a standalone alternative for `dist/tmax` (no `bun` in the compiled
     binary's command line), with a trailing word boundary so `dist/tmaxclient`
     can never match (same exclusion the RE documents for `bin/tmaxclient`).
2. **Seed live candidates from socket ownership**: in `discover()`, a process
   that owns the canonical socket is a live candidate even if the RE has not
   learned its command shape (`canonical.has(entry.pid)`). `classifyLiveDaemon`
   already returns `canonical-live` for it → kept without `--force`, SIGTERM +
   cleanup with `--force --apply` (the documented force semantic).

Empirical pre-check (macOS, this host): `lsof -t -a -U <socket-path>` lists
ONLY the listener — a connected client process does NOT appear — so seeding
cannot promote clients to reap candidates.

## Steps to Reproduce

1. `bin/tmax /tmp/some-file.md` (embedded Steep; process `bun src/main.ts …`).
2. `bin/tmax --sweep` → the session's pid appears as `kind=stale-recycled`.
3. (Do NOT run `--apply` on a session you want to keep — pre-fix it would
   unlink the live socket.)

## Completion Criteria

- [ ] `isTmaxDaemonCommand` matches `bun …/src/main.ts <file>` and
      `…/dist/tmax <file>` (both with and without a leading bun for dist).
- [ ] Gate round 1: entrypoint alternatives end in a suffix-proof boundary —
      `bun src/main.tsx`, `bun run build --entry src/main.tsx`,
      `bun --watch src/main.ts.bak`, and `bun src/server/server.tsx` are all
      REJECTED (the regex decides process signaling; a lookalike entrypoint
      reparented to init would otherwise be reaped as an orphan), while
      `bun src/main.ts --init-file …` / `bun src/server/server.ts --socket …`
      still match. (The pre-existing `server.ts` suffix hole is hardened by
      the same token in this diff.)
- [ ] `isTmaxDaemonCommand` still rejects `bun bin/tmaxclient`, the bash
      launcher `bash …/bin/tmax`, the TUI client, unrelated commands, and
      additionally `…/dist/tmaxclient` (word boundary).
- [ ] Regression (the live repro): a live process with command
      `bun src/main.ts /tmp/f.md` holding a lock, with `canonicalPids`
      reporting it as the socket owner, is classified `canonical-live`;
      `--apply` (no force) keeps it and removes NO files.
- [ ] Structural guard: a canonical-socket owner whose command matches NOTHING
      in the RE is still `canonical-live` and kept under `--apply`.
- [ ] Non-canonical embedded session (custom socket) recognized via the RE
      with a live parent → `owned` → kept under `--apply`.
- [ ] Existing sweep behavior unchanged: the stale-recycled test (unrelated
      live pid + lock) still removes only files and never signals.
- [ ] New tests red before the fix, green after (mutation-proven).
- [ ] `bun run typecheck` clean; `bun run test:unit` green.

## Relevant Files

- `src/server/sweep.ts` — `TMAX_DAEMON_RE`, `discover()` (the fix)
- `test/unit/server-sweep.test.ts` — new cases alongside the existing BUG-29 suite

## Notes

- Live end-to-end re-verification (run the embedded session, then `--sweep`
  dry-run and confirm `canonical-live`) is part of the landing check; it runs
  against a THROWAWAY file/session, never the user's live editor.
- `dist/tmax` blind spot was code-inspection only; if a compiled binary is
  handy, one dry-run sweep against it is a bonus check, not a gate.

Status: RESOLVED pending CI green — implemented at issue-246 (47e8f33 +
29edce0 + advisory token); typecheck clean, unit suite 3,599/0, verify-gate
PASS on retry 1 (round 1 caught a real suffix over-match: `bun src/main.tsx`
classified as a daemon — fixed with `(?![\w.])` boundaries).
