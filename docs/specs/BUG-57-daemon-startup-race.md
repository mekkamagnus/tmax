# Bug: bin/tmax -e startup latency variable (daemon-readiness race) (#75)

## Description
`bin/tmax -e` could hang >2min because `is_running` calls `tmaxclient --ping`
which has no connect or request timeout. Against a wedged daemon (socket bound
but RPC handler not ready), the ping blocks indefinitely, defeating
`wait_for_daemon`'s bounded poll loop.

## Solution
- `connect()`: 3s connect timeout (socket bound but not accepting → fail fast).
- `sendRequest()`: bounded request timeout (default 30s; ping uses 3s).
- `ping()`: passes 3s timeout so is_running returns quickly.

## Validation
- Healthy daemon: `bin/tmax -e '(+ 1 1)'` → 2 in ~1.5s ✓
- Wedged socket: ping fails in <1s (was indefinite) ✓
- No regression: pre-started daemon returns immediately ✓
