/**
 * @file stop-sequence-deps.ts
 * @description #276 — the REAL effects for cli/stop-sequence.ts (the
 * production wiring: TmaxClient over the fixed socket, lsof/ps/kill).
 * Kept separate so the sequence itself stays a pure decision machine.
 *
 * Connection discipline (codex r1): ONE HELD CONNECTION carries
 * identity → graceful shutdown (an owner change between two separate
 * connections could route the shutdown RPC to an unidentified server);
 * connect-refused THROWS (the stale branch) while a connected-but-silent
 * server returns NULL (the unresponsive branch — the socket is left in
 * place); close() closes the HELD client.
 */

import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { TmaxClient } from "../client/rpc-client.ts";
import type { StopDeps } from "./stop-sequence.ts";

export function realStopDeps(socket: string): StopDeps {
  let held: TmaxClient | null = null;

  /** The ONE connection (identity + shutdown share it). Throws when the
   *  connect is REFUSED — the decision machine's stale-socket branch. */
  const connect = async (): Promise<TmaxClient> => {
    if (held) return held;
    const c = new TmaxClient(socket);
    await c.connect(); // refused → throws
    held = c;
    return c;
  };

  return {
    socketExists: () => existsSync(socket),
    identity: async () => {
      try {
        const c = await connect();
        // Connected but silent (the 1s timeout) → NULL — the
        // unresponsive branch; the socket is LEFT IN PLACE.
        const r = await c.sendRequest("server-identity", {}, 1000).catch(() => null);
        // RAW validation, no coercion (codex r4 c1): a string pid
        // ("123") once Number()'d past the sequence's checks and
        // received shutdown — only a true integer pid passes.
        if (!r || typeof r !== "object") return null;
        if (r.mode !== "daemon" && r.mode !== "embedded") return null;
        if (typeof r.pid !== "number" || !Number.isInteger(r.pid) || r.pid <= 0) return null;
        return { mode: r.mode, pid: r.pid };
      } catch (err) {
        // PRESERVE the error kind (codex r2 c2): the Node error's code
        // rides through untouched — the sequence's isRefusal admits
        // ONLY ECONNREFUSED to the stale-socket branch; timeouts and
        // permission errors report without unlinking.
        throw err;
      }
    },
    requestShutdown: async () => {
      // The SAME held connection the identity rode (codex r1 c1).
      const c = await connect();
      await c.sendRequest("shutdown", {}, 1000);
    },
    close: () => {
      const c = held;
      held = null;
      try { c?.close(); } catch { /* dead */ }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    unlinkSocket: () => { try { unlinkSync(socket); return !existsSync(socket); } catch { return false; } },
    recheckRefusal: async () => {
      try { await connect(); return "accepted" as const; } catch (err) {
        if ((err as { code?: string })?.code === "ECONNREFUSED") return "refused" as const;
        throw err; // a DIFFERENT failure — never confirms staleness
      }
    },
    socketGone: () => !existsSync(socket),
    pidsOnSocket: () => {
      // -a INTERSECTS the selections (codex r5): -t -U <path> ORs by
      // default — every OTHER Unix-socket owner on the system appeared
      // as an extra pid, tripping the exactly-one check and refusing
      // to signal a VERIFIED daemon.
      const res = spawnSync("lsof", ["-a", "-t", "-U", socket], { encoding: "utf8" });
      if (res.error || res.status !== 0) return null;
      const pids = (res.stdout ?? "").trim().split("\n").filter(Boolean);
      return pids.length > 0 ? pids : null;
    },
    cmdline: (pid) => {
      const res = spawnSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" });
      if (res.error || res.status !== 0) return null;
      return (res.stdout ?? "").trim() || null;
    },
    signal: (pid, sig) => { process.kill(Number(pid), sig); },
    pidAlive: (pid) => {
      // EPERM means the process EXISTS but is not ours (codex r4 c2):
      // alive — only ESRCH is 'gone'. (The old catch-all made an
      // EPERM-failed SIGTERM report success.)
      try { process.kill(Number(pid), 0); return true; }
      catch (err) { return (err as { code?: string })?.code !== "ESRCH"; }
    },
    // The daemon invocation in BOTH spawn forms: the flag (--daemon) or
    // the daemon ENTRY (source-mode spawns `bun .../src/server/server.ts`
    // with no flag — verify-gate r1: the flag-only match made the dev
    // path's step-5 escalation unreachable).
    isDaemonCmdline: (cmd) => /(--daemon|src[\\/]server[\\/]server\.ts)/.test(cmd),
  };
}
