# ADR-0126 — Shared defaultSocketPath() helper (BUG-30 / #10)
## Status: Accepted
## Context: 5 sites computed /tmp/tmax-<uid>/server independently with inconsistent uid resolution (SUDO_UID vs getuid ?? 501 vs userInfo). Under sudo, daemon (SUDO_UID) and clients (getuid=root) diverged.
## Decision: Single defaultSocketPath() in src/core/socket-path.ts. resolveUid() honors SUDO_UID (daemon's original semantics). All 5 sites use it (3 corrected to honor SUDO_UID; drift fixed).
## Consequences: SUDO_UID now honored everywhere (behavior change for remote-editor.ts, instance.ts, client.ts — they matched the daemon). typecheck clean; socket-path tests pass.
