/**
 * @file stop-sequence-deps.ts
 * @description #276 — the REAL effects for cli/stop-sequence.ts (the
 * production wiring: TmaxClient over the fixed socket, lsof/ps/kill).
 * Kept separate so the sequence itself stays a pure decision machine.
 */

import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { TmaxClient } from "../client/rpc-client.ts";
import type { StopDeps } from "./stop-sequence.ts";

export function realStopDeps(socket: string): StopDeps {
  return {
    socketExists: () => existsSync(socket),
    identity: async () => {
      const c = new TmaxClient(socket);
      try {
        await c.connect();
        // 1s timeout — an unresponsive daemon must not hang --stop.
        const r = await c.sendRequest("server-identity", {}, 1000);
        return { mode: r.mode as "daemon" | "embedded", pid: Number(r.pid) };
      } catch {
        throw new Error("refused");
      }
      // NOTE: close() is the CALLER's job (the sequence closes after the
      // graceful RPC); on the throw path the client is dead anyway.
    },
    requestShutdown: async () => {
      const c = new TmaxClient(socket);
      await c.connect();
      await c.sendRequest("shutdown", {}, 1000);
    },
    close: () => { try { new TmaxClient(socket).close(); } catch { /* dead */ } },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    unlinkSocket: () => { try { unlinkSync(socket); } catch { /* best-effort */ } },
    recheckConnect: async () => {
      const c = new TmaxClient(socket);
      try {
        await c.connect();
        c.close();
        return true;
      } catch {
        return false;
      }
    },
    socketGone: () => !existsSync(socket),
    pidsOnSocket: () => {
      const res = spawnSync("lsof", ["-t", "-U", socket], { encoding: "utf8" });
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
      try { process.kill(Number(pid), 0); return true; } catch { return false; }
    },
    isDaemonCmdline: (cmd) => cmd.includes("--daemon"),
  };
}
