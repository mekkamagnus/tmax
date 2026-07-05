/**
 * @file server-test-exit-regression.test.ts
 * @description BUG-16 file-level exit regression test.
 *
 * The two suspect server-test files (`server-daemon-hardening.test.ts`,
 * `server-observability.test.ts`) historically hung the full `bun run test:unit`
 * suite because lingering handles (net.Server, Socket, Timeout) kept the process
 * alive after all assertions passed. This test runs each file as a subprocess
 * with an external wall-clock guard and asserts it exits cleanly (exit code 0)
 * within a bounded time. If a future change re-introduces a handle leak, this
 * test fails instead of the entire suite hanging silently.
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "child_process";
import { join } from "path";

const PROJECT_ROOT = import.meta.dir + "/../..";
const WALL_CLOCK_MS = 45_000; // spec Task 3 AC: 45s external guard

/**
 * Run a single test file via `bun test` as a subprocess and return its exit
 * code. Kills the subprocess if it exceeds WALL_CLOCK_MS (the BUG-16 hang
 * signature — tests pass but process won't exit).
 */
function runTestFileWithGuard(testFile: string): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["test", "--timeout", "15000", testFile],
      { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, WALL_CLOCK_MS);

    // Swallow output — we only care about the exit code.
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut });
    });
  });
}

describe("BUG-16 file-level exit regression", () => {
  test("server-daemon-hardening.test.ts exits cleanly under 45s guard", async () => {
    const result = await runTestFileWithGuard(
      join(PROJECT_ROOT, "test/unit/server-daemon-hardening.test.ts"),
    );
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  }, 60_000);

  test("server-observability.test.ts exits cleanly under 45s guard", async () => {
    const result = await runTestFileWithGuard(
      join(PROJECT_ROOT, "test/unit/server-observability.test.ts"),
    );
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  }, 60_000);
});
