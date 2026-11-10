# ADR-0273: Sweep identity includes the embedded path and canonical-socket ownership

- **Status**: Accepted (verify-gate PASS on retry 1; landed pending CI green)
- **Date**: 2026-11-11
- **Issue**: [#246](https://github.com/mekkamagnus/tmax/issues/246)
- **Spec**: [BUG-246](../specs/BUG-246-sweep-embedded-session-misclassified.md)

## Context

BUG-29's sweep decides process identity solely from the command line
(`TMAX_DAEMON_RE`), then sub-classifies with lsof canonical-socket ownership.
The RE knew two shapes — the source daemon (`bun …/src/server/server.ts`) and
the installed-binary form (`bun …/bin/tmax`). Two socket-binding launch paths
were blind spots:

- the **embedded-Steep** path `bun …/src/main.ts <file>` (`bin/tmax <file>`
  execs it; observed live classifying as `stale-recycled`), and
- the **#244 compiled binary** `…/dist/tmax <file>` (no `bun` prefix at all).

Because `discover()` builds its live-candidate set only from RE matches, a live
embedded session holding a lock fell to the stale-lock branch →
`classifyStaleLock` → pid alive → `stale-recycled` → `--sweep --apply` unlinks
the lock + the socket the live process is serving (clients then get ENOENT and
the next start sees a free-looking socket while the old listener survives).

## Decision

Two complementary changes, both confined to `src/server/sweep.ts`:

1. **RE extension** — identity now also matches `bun …/src/main.ts` (bun arm)
   and `…/dist/tmax` (a standalone alternative with no bun requirement, since
   the compiled binary's command line contains no `bun`). The trailing `\b`
   keeps `dist/tmaxclient` excluded, mirroring the documented `bin/tmaxclient`
   exclusion.
2. **Canonical-owner seeding** — `discover()` treats a process owning the
   canonical socket (`canonical.has(pid)`, the existing lsof dep) as a live
   candidate even when the RE has not learned its command shape.
   `classifyLiveDaemon` then yields `canonical-live`: kept without `--force`,
   SIGTERM + cleanup with `--force --apply` (the documented force semantic).
   This makes the issue's invariant structural: *a live socket owner can never
   fall into the stale-lock path*, for any future launch path.

Safety pre-check (empirical, this host): `lsof -t -a -U <socket-path>` lists
**only the listener** — a connected client process does not appear — so
seeding cannot promote clients into reap candidates.

## Alternatives considered

- **RE extension only**: would fix the two named paths but leave the class of
  bug open — the next launch shape (renamed entrypoint, relocated binary)
  regresses identically. Rejected as the sole fix.
- **Seeding only**: would protect the canonical socket but not custom-socket
  (`TMAX_SOCKET`) embedded sessions; those still need command identity.
  Rejected as the sole fix.

## Consequences

- `src/main.ts` processes are now sweep-visible like any daemon: a reparented
  embedded session (terminal closed) is an `orphan` reap candidate — correct,
  it holds a socket no client can reach; one with a live parent is `owned` →
  kept.
- `--sweep --force --apply` now also reaps a live embedded session owning the
  canonical socket — the intended force semantic, previously impossible.
- Non-canonical `dist/tmax` binaries: classified by parentage (`owned`/`orphan`)
  like source daemons on custom sockets.

## Verification

Gate history: round 1 **GAPS** — the new `src/main\.ts` alternative lacked a
trailing boundary, so `bun src/main.tsx` (a stock Bun/React entrypoint name)
classified as a tmax daemon; a reparented such process would be SIGKILLed as
an orphan by `--apply`, violating the module's PID-reviewed-only signalling
contract. Fixed with a suffix-proof `(?![\w.])` boundary on BOTH entrypoint
alternatives — plain `\b` is insufficient (`main.ts.bak` still has a word
boundary at the dot) — plus rejection tests. Retry 1 **PASS** (verifier
independently re-proved red/green via three mutations). Retry-1 advisory
adopted: `dist/tmax` got the same `(?![\w.])` (`bun test dist/tmax.test.ts`
would otherwise over-match).

- New tests in `test/unit/server-sweep.test.ts` (4): RE matches + the
  `dist/tmaxclient` boundary; the live repro (`bun src/main.ts` + canonical →
  canonical-live, `--apply` keeps everything); the structural guard
  (unrecognized command + canonical ownership → kept); non-canonical embedded
  with live parent → `owned` → kept. Mutation-proven: base `sweep.ts` fails
  exactly these 4 (14 pass / 4 fail), fix passes 18/18.
- Existing 14 sweep tests unchanged and green (incl. the stale-recycled
  never-signal pin).
- Live on-host dry-run after the fix: the repro pid (a real embedded session,
  `bun src/main.ts /tmp/tmax-play.md`) reports `kind=canonical-live`,
  `0 candidate(s) would be swept` — previously `stale-recycled`.
- `bun run typecheck` clean; `bun run test:unit` 3,599 / 0 fail.
