/**
 * @file adw-process-cleanup.test.ts
 * @description BUG-25 — runner-level regression for process-tree cleanup.
 *
 * Drives each ADW runner's env-gated cleanup probe end-to-end:
 *   - success mode: a child exits 0 while a SIGTERM-ignoring grandchild lingers;
 *     the top-level cleanup must reap it before the runner exits 0.
 *   - signal mode: SIGTERM mid-run must yield exit 143 and reap every emitted
 *     child/grandchild PID.
 *
 * Pass/fail oracle = the unique probe marker: every spawned probe process
 * carries it in its argv, so `ps -Ao command=` either finds survivors (FAIL) or
 * not (PASS). Machine-wide counts are diagnostic; the marker is unique per test
 * process so concurrent test files never observe each other's probes.
 *
 * The probe path replaces the runner's `main` (ADW_PROCESS_CLEANUP_PROBE), so
 * this exercises the shared `runAdwEntrypoint` finalizer + supervisor wiring
 * shared by all 11 runners without invoking real Claude/Codex/GitHub.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "child_process";

const RUNNERS = [
  "adw-build",
  "adw-launch",
  "adw-patch-review",
  "adw-plan-review-build-patch",
  "adw-plan-reviewspec-build",
  "adw-plan-reviewspec",
  "adw-plan",
  "adw-spec-review",
  "adw-status",
  "adw-test",
  "adw-watchdog",
];

// Unique per test process → no collision with concurrent test files.
const MARKER = `adw-process-cleanup-probe-${process.pid}`;

const spawned: ChildProcess[] = [];
afterEach(() => {
  for (const child of spawned.splice(0)) {
    try { child.kill("SIGKILL"); } catch { /* gone */ }
  }
});

const countMarkers = (): number => {
  const res = spawnSync("ps", ["-Ao", "command="], { encoding: "utf8" });
  if (res.error) return 0;
  return res.stdout.split("\n").filter((line) => line.includes(MARKER)).length;
};

const waitForZeroMarkers = async (timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (countMarkers() === 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return countMarkers() === 0;
};

const exitCodeOf = (child: ChildProcess, timeoutMs: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("runner did not exit in time")), timeoutMs);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code ?? -1); });
  });

const launchProbe = (runner: string, mode: "success" | "signal"): ChildProcess => {
  const child = spawn("bun", [`adws/${runner}.ts`], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ADW_PROCESS_CLEANUP_PROBE: mode,
      ADW_PROCESS_CLEANUP_PROBE_MARKER: MARKER,
    },
  });
  spawned.push(child);
  return child;
};

/** Wait until the probe announces its emitted PIDs (child + grandchild live). */
const waitForProbeAnnounce = (child: ChildProcess, timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("probe did not announce")), timeoutMs);
    child.stdout!.once("data", () => { clearTimeout(timer); resolve(); });
    child.once("exit", () => reject(new Error("probe exited before announcing")));
  });

describe("ADW runner process-tree cleanup (BUG-25)", () => {
  describe.each(RUNNERS)("success probe — %s", (runner) => {
    test("exits 0 and reaps the lingering grandchild", async () => {
      const child = launchProbe(runner, "success");
      const code = await exitCodeOf(child, 20_000);
      expect(code).toBe(0);
      expect(await waitForZeroMarkers(5_000)).toBe(true);
    });
  });

  describe.each(RUNNERS)("signal probe — %s", (runner) => {
    test("SIGTERM yields exit 143 and reaps every descendant", async () => {
      const child = launchProbe(runner, "signal");
      await waitForProbeAnnounce(child, 10_000);
      // Let the grandchild (ignoring SIGTERM) actually start.
      await new Promise((r) => setTimeout(r, 300));
      expect(countMarkers()).toBeGreaterThan(0); // survivors exist before cleanup
      child.kill("SIGTERM");
      const code = await exitCodeOf(child, 20_000);
      expect(code).toBe(143);
      expect(await waitForZeroMarkers(5_000)).toBe(true);
    });
  });
});
