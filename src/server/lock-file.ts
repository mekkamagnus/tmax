/**
 * @file src/server/lock-file.ts
 * @description Shared lock-file primitives (issue #11). The readLock parsing
 *   (file read + JSON.parse + null-on-failure) was duplicated in server.ts
 *   and sweep.ts with divergent return types. This module exports the raw
 *   parsing primitive; each consumer wraps it in its own type.
 *   lockPathFor is shared (both need the `.lock` suffix).
 *   isProcessAlive/writeLock/tryAcquireLock stay in their consumers (sweep.ts
 *   uses an injected kill for testability; writeLock/tryAcquireLock are
 *   server.ts-only).
 */
import { readFileSync } from "fs";

/** Append `.lock` to a socket path to get its lock-file path. */
export function lockPathFor(socketPath: string): string {
  return socketPath + ".lock";
}

/**
 * Read + JSON-parse a lock file. Returns the raw record, or null if the file
 * is missing or unparseable. Each caller wraps the result in its own typed
 * shape (server.ts: LockData; sweep.ts: LockEntry).
 */
export function readLockRaw(path: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
