/**
 * @file src/core/socket-path.ts
 * @description Single source of truth for the canonical daemon socket path
 *   (BUG-30 / issue #10). All daemon/client sites import this instead of
 *   computing `/tmp/tmax-<uid>/server` independently — the uid resolution
 *   was inconsistent (SUDO_UID vs getuid vs userInfo) causing daemon/client
 *   mismatches under sudo.
 */
import { userInfo } from "os";

/**
 * Resolve the uid for the socket path. Honors `SUDO_UID` (when tmax is run
 * under sudo, the socket belongs to the real invoking user, not root) — this
 * matches the daemon's original behavior and is now shared by ALL sites.
 */
export function resolveUid(): string {
  return process.env.SUDO_UID || String(userInfo().uid);
}

/**
 * The canonical daemon socket path: `TMAX_SOCKET` env if set, else
 * `/tmp/tmax-<uid>/server` using {@link resolveUid}.
 */
export function defaultSocketPath(): string {
  return process.env.TMAX_SOCKET || `/tmp/tmax-${resolveUid()}/server`;
}
