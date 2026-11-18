/**
 * @file sweep-reap-escalation.test.ts
 * @description Issue #251 — REAL-process reproduction: a detached orphan that
 * traps SIGTERM must actually die under `runSweep --apply` (escalation to
 * SIGKILL), and the reaped verdict must be honest (no false "reaped" while
 * the process lives, no zombie misread).
 */

import { describe, test, expect } from "bun:test";
import { spawn, spawnSync } from "child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { runSweep } from "../../src/server/sweep.ts";

/** True when `ps` still lists the pid (any state). */
function psLists(pid: number): boolean {
  const res = spawnSync("ps", ["-p", String(pid), "-o", "pid="], { encoding: "utf8" });
  return res.status === 0 && !!res.stdout.trim();
}

/** The pid's ps STAT field (e.g. "Ss", "Z"). */
function psStat(pid: number): string {
  const res = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  return res.stdout.trim();
}

/** Spawn a detached child that TRAPS SIGTERM and stays alive until SIGKILL. */
function spawnSigtermTrapper(scriptDir: string): number {
  const script = join(scriptDir, "ignore-sigterm.ts");
  writeFileSync(script, `process.on("SIGTERM", () => { /* ignore */ });\nsetInterval(() => {}, 1000);\n`);
  const child = spawn(process.execPath, [script], { detached: true, stdio: "ignore" });
  child.unref();
  return child.pid!;
}

/** Wait until ps shows the pid, up to ~2s (spawn latency). */
async function waitUntilListed(pid: number): Promise<void> {
  for (let i = 0; i < 40 && !psLists(pid); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("Sweep reap escalation (issue #251) — real processes", () => {
  test("a SIGTERM-trapping orphan is actually killed (SIGKILL escalation)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tmax-sweep-251-"));
    const pid = spawnSigtermTrapper(dir);
    try {
      await waitUntilListed(pid);
      expect(psLists(pid)).toBe(true);

      const report = await runSweep({
        apply: true,
        force: false,
        uid: userInfo().uid,
        // Inject discovery so ONLY our trapper is a candidate (real kill/now/sleep).
        deps: {
          ps: () => [{ pid, ppid: 1, command: "bun src/server/server.ts" }],
          canonicalPids: () => new Set<number>(),
          graceMs: 300,
        },
      });

      expect(report.candidates.map((c) => c.kind)).toContain("orphan");
      expect(report.reaped).toContain(pid);

      // THE issue's assertion: the process must actually be gone shortly
      // after the sweep reports success (allow a moment for init to reap).
      let gone = false;
      for (let i = 0; i < 40; i++) {
        if (!psLists(pid) || psStat(pid).startsWith("Z")) { gone = true; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(gone).toBe(true);
    } finally {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
  }, 20000);

  test("an unkillable-by-SIGTERM verdict is honest when the pid survives", async () => {
    // Simulated: kill('SIGKILL') is refused (EPERM-like). reapPid must NOT
    // report reaped for a live process — the sweep's core promise.
    const dir = mkdtempSync(join(tmpdir(), "tmax-sweep-251b-"));
    const pid = spawnSigtermTrapper(dir);
    try {
      await waitUntilListed(pid);
      const report = await runSweep({
        apply: true,
        force: false,
        uid: userInfo().uid,
        deps: {
          ps: () => [{ pid, ppid: 1, command: "bun src/server/server.ts" }],
          canonicalPids: () => new Set<number>(),
          graceMs: 100,
          // SIGTERM and SIGKILL both "refused" (throw) — the process lives.
          kill: (target, sig) => {
            if (sig === 0) return; // liveness probe: process answers
            throw new Error(`EPERM (simulated) pid ${target} sig ${String(sig)}`);
          },
        },
      });
      expect(report.reaped).not.toContain(pid);
      expect(psLists(pid)).toBe(true); // still alive — verdict must reflect it
    } finally {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
  }, 20000);
});
