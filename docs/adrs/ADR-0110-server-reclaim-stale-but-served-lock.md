# Server Reclaims a Live-But-Not-Serving Daemon Lock

## Status

Accepted

## Context

`tmax` runs as a daemon listening on a Unix socket, guarded by a filesystem lock
that records the owning pid + intended socket path (`src/server/server.ts`,
`acquireSocket`). The startup sequence is:

1. Probe the socket path — if a live daemon answers `ping`, throw (already
   running). Otherwise remove any stale socket file.
2. Atomically acquire the lock.
3. If the lock is held, check whether it is stale: if the recorded pid is alive,
   the socket path matches, **and** the socket file still exists, throw
   "starting"; otherwise treat the lock as stale, remove it, and retry.

The bug, observed as a hung daemon during the full test suite: a daemon process
could be **alive (pid still running) but no longer serving** — its socket file
disappeared (e.g. a crash mid-shutdown, an external cleanup, or a lost temp dir).
Step 1 above had already removed the socket file as "stale," so by step 3 the
socket file was absent. The old guard was:

```ts
// pre-fix — threw "starting" whenever the holder pid was alive + paths matched
if (existing && isProcessAlive(existing.pid) && existing.socketPath === this.socketPath) {
  throw new Error(`Daemon starting (pid ${existing.pid}) at ${this.socketPath}`);
}
```

This check **did not verify the socket was actually serving**. So a live-but-
zombie daemon deadlocked every subsequent `tmax` invocation: the lock was held by
an alive pid with a matching path, so startup refused to proceed, yet nothing was
listening — the client hung forever on `connect()`. A `kill -9` of the zombie pid
was the only recovery.

## Decision

Tighten the stale-lock guard in `acquireSocket` so a lock is considered
**live and worth honoring** only when the daemon is *actually serving*, not
merely *alive*. The guard now additionally requires:

1. `existsSync(this.socketPath)` — the socket file is still present, **and**
2. `await this.probeDaemon()` — a live daemon actually responds to a `ping`
   within 500ms.

We only reach this branch when the socket file is already absent (step 1 would
have thrown if a serving daemon answered the probe). So a lock whose holder is
"alive" with no socket is, by construction, a zombie that lost its socket. The
fix reclaims it — removes the stale lock and retries acquisition — rather than
deadlocking:

```ts
// post-fix — honor the lock only if the daemon is provably serving
if (
  existing &&
  isProcessAlive(existing.pid) &&
  existing.socketPath === this.socketPath &&
  existsSync(this.socketPath) &&
  await this.probeDaemon()
) {
  throw new Error(`Daemon starting (pid ${existing.pid}) at ${this.socketPath}`);
}
// Stale lock (dead pid, wrong path, or live-but-not-serving) — reclaim.
removeFile(lockPath);
```

`probeDaemon` already existed (used at step 1); the fix reuses it rather than
introducing a new liveness primitive.

## Consequences

**Easier:** A hung/zombie daemon with a missing socket no longer deadlocks
startup — `tmax` reclaims the stale lock and starts a fresh daemon. This
eliminates the manual `kill -9` recovery path and the full-suite hangs it caused.
The reuse of the existing `probeDaemon` keeps the change to the guard predicate
alone (no new I/O primitive).

**Harder:** This **inverts a prior safety assumption.** Before, an alive pid with
a matching path was sufficient to defer; now it is not. There is a narrow race:
if a *legitimately starting* daemon (slow to bind its socket, e.g. under heavy
load) has written its lock but not yet its socket within 500ms, a concurrent
`acquireSocket` will reclaim that lock and two daemons may briefly race to bind.
In practice startup binds the socket within milliseconds of acquiring the lock,
and the lock is acquired *before* the bind (not after), so the window is the
bind duration — small. The 500ms `probeDaemon` timeout is the existing ceiling
and is not changed here; it is a tunable constant if the race ever bites. The
fix is also a behavioral change for anyone who relied on the old "alive pid ⇒
defer" contract.

**Related:** [ADR-0103](ADR-0103-server-test-socket-leak-fix.md) (socket/lock
lifecycle and `forceShutdown` cleanup — same resource family), BUG-16 (the test-
suite hang that motivated the shared lifecycle helpers).
