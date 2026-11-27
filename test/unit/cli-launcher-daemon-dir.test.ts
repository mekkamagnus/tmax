/**
 * @file cli-launcher-daemon-dir.test.ts
 * @description #353 — ensureDaemon must remove its `tmax-daemon-start.*`
 *  temp DIRECTORY on both exit paths. It used to remove only the log file,
 *  leaving one empty directory behind per daemon start (172 measured on
 *  2026-11-24).
 *
 * Both tests drive the REAL ensureDaemon against this run's private
 * TMAX_SOCKET (every test run carries one; the suite skips this file when it
 * is unset, so a bare run can never start a daemon on the user's default
 * socket). The success path spawns a real daemon and kills it afterwards by
 * the pid recorded in the socket's lock file. The failure path blocks the
 * bind by placing a directory at the socket path, so the child exits
 * immediately and waitForDaemon exhausts its poll budget.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __internals } from "../../src/cli/launcher.ts";

const { SOCKET, ensureDaemon } = __internals;

/** Count of this run's leftover daemon-start directories (exact prefix). */
const startDirCount = (): number =>
  readdirSync(tmpdir()).filter((n) => n.startsWith("tmax-daemon-start.")).length;

/** Read the pid the serving daemon recorded in ${SOCKET}.lock, if any. */
const lockPid = (): number | undefined => {
  try {
    const raw = JSON.parse(readFileSync(`${SOCKET}.lock`, "utf8")) as { pid?: unknown };
    return typeof raw.pid === "number" ? raw.pid : undefined;
  } catch {
    return undefined;
  }
};

/** Kill the daemon this test spawned (by lock pid) and clear its files. */
const stopSpawnedDaemon = (): void => {
  const pid = lockPid();
  if (pid !== undefined && pid > 0) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
  for (const p of [SOCKET, `${SOCKET}.lock`]) {
    try { rmSync(p, { force: true }); } catch { /* best-effort */ }
  }
};

describe("#353: ensureDaemon removes its start-log directory", () => {
  test.skipIf(!process.env.TMAX_SOCKET)("success path: directory removed once the daemon answers", async () => {
    const before = startDirCount();
    try {
      await ensureDaemon({ initFile: "", cleanStart: false });
      expect(startDirCount()).toBe(before);
      // The daemon actually came up on the private socket (otherwise this
      // test proved nothing — the early-return path creates no directory).
      const pid = lockPid();
      expect(pid).toBeGreaterThan(0);
    } finally {
      stopSpawnedDaemon();
    }
    expect(startDirCount()).toBe(before);
  }, 30_000);

  test.skipIf(!process.env.TMAX_SOCKET)("failure path: log reported, directory removed, exit 1", async () => {
    const before = startDirCount();
    // A directory at the socket path makes the daemon child's bind fail
    // immediately, so waitForDaemon exhausts its 5s budget.
    mkdirSync(SOCKET);
    const origExit = process.exit;
    const codes: number[] = [];
    (process as unknown as { exit: (c?: number) => never }).exit = ((code?: number) => {
      codes.push(code ?? 0);
      throw new Error(`exit ${code}`);
    }) as never;
    try {
      await expect(ensureDaemon({ initFile: "", cleanStart: false })).rejects.toThrow(/exit 1/);
      expect(codes).toEqual([1]);
      expect(startDirCount()).toBe(before);
    } finally {
      (process as unknown as { exit: typeof process.exit }).exit = origExit;
      rmSync(SOCKET, { recursive: true, force: true });
      stopSpawnedDaemon();
    }
  }, 30_000);
});
