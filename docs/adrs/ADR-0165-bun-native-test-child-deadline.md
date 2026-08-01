# ADR-0165 — Bun-native child deadline for daemon-startup tests (#79)

## Status

Accepted

## Context

`test/unit/server-daemon.test.ts` ("should start tmax server daemon") asserted the
daemon prints `tmax server listening` by shelling out to GNU `timeout`:

```js
execAsync(`TMAX_SOCKET=${socket} timeout 8s bun run src/main.ts --daemon || true`)
```

`timeout` is a GNU coreutils binary absent on stock macOS. The `|| true` absorbed
the shell error and the output assertion failed — leaving the test
**tolerated-red** on the primary development OS. A tolerated-red test erodes the
meaning of "red = real bug" and (per the CHORE-69 diagnosis) is exactly the kind
of suite erosion that lets real regressions hide.

## Decision

Replace the non-portable shell deadline with a **Bun-native child lifecycle**:

- `spawn('bun', ['src/main.ts', '--daemon'], { detached: true, env: { TMAX_SOCKET } })`.
- Resolve on the `tmax server listening` readiness line, or reject after a 10s
  deadline (no external binary).
- **Deterministic teardown** = the daemon's own graceful path: send
  `(editor-quit)` over its socket, poll the socket file away, then fall back to
  SIGTERM → bounded SIGKILL on the **whole process group** (`detached: true` makes
  the child a group leader, so descendants are reaped too — the BUG-25
  process-supervisor pattern).

Chose Bun-native over **skip-on-macOS**: a skip removes coverage on the primary
dev OS entirely; the native deadline preserves it everywhere, avoids coreutils
differences, and guarantees owned-process cleanup.

## Consequences

- The test passes on macOS and Linux; no `timeout`/coreutils dependency.
- Spawned daemon + socket are deterministically reaped (verified: no orphan
  survives the test).
- The detached-group + graceful-quit teardown is a reusable pattern for any
  future "spawn the daemon and assert startup" test.

Spec: [CHORE-69](../specs/CHORE-69-reliable-test-harness.md) (Issue D). Issue: #79.
