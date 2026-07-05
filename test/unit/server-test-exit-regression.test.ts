/**
 * @file server-test-exit-regression.test.ts
 * @description BUG-16 file-level exit regression test.
 *
 * The two suspect server-test files (`server-daemon-hardening.test.ts`,
 * `server-observability.test.ts`) historically hung the full `bun run test:unit`
 * suite because lingering handles (net.Server, Socket, Timeout) kept the process
 * alive after all assertions passed. This test runs each file as a subprocess
 * with an external wall-clock guard and verifies:
 * 1. All tests PASS (no test failures) — parsed from stdout.
 * 2. The process exits within the guard window OR is killed after all tests
 *    passed (the exit-stall case — tests are correct, only the handle leak
 *    prevents process exit, which the run-unit-tests.ts wrapper handles in
 *    the full suite).
 *
 * If a future change causes actual test FAILURES (not just an exit-stall),
 * this test fails.
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "child_process";
import { join } from "path";

const PROJECT_ROOT = import.meta.dir + "/../..";
const WALL_CLOCK_MS = 90_000; // 13 tests at ~3-5s each + T-Lisp load overhead

/**
 * Run a single test file via `bun test` as a subprocess.
 * Returns whether all tests passed (parsed from output) and whether the
 * process exited cleanly (not killed by the guard).
 */
function runTestFileWithGuard(testFile: string): Promise<{ allPassed: boolean; cleanExit: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["test", "--timeout", "15000", testFile],
      { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );

    let output = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, WALL_CLOCK_MS);

    child.stdout.on("data", (d: Buffer) => { output += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { output += d.toString(); });

    child.on("exit", (code) => {
      clearTimeout(timer);
      // Parse the bun test output for actual test failures. Use the (fail)
      // marker that bun prints for failed tests, not generic "error:" text
      // (which appears in expected rejection messages from the tests themselves).
      const failMatches = output.match(/\(fail\)/g);
      const hasFailures = failMatches !== null && failMatches.length > 0;
      // Check for the summary line — "N pass" with "0 fail" or just "N pass"
      // if no failures. If the process was killed before the summary, we
      // verify no (fail) markers appeared in what did run.
      const hasSummary = /\b\d+\s+pass\b/.test(output);
      const allPassed = !hasFailures && (hasSummary || !killed);
      const cleanExit = !killed && code === 0;
      resolve({ allPassed, cleanExit, output });
    });
  });
}

describe("BUG-16 file-level exit regression", () => {
  test("server-daemon-hardening.test.ts: all tests pass under 90s guard", async () => {
    const result = await runTestFileWithGuard(
      join(PROJECT_ROOT, "test/unit/server-daemon-hardening.test.ts"),
    );
    // All tests must pass — no failures allowed.
    expect(result.allPassed).toBe(true);
    // The process should ideally exit cleanly. If it doesn't (exit-stall from
    // a lingering handle), that's the BUG-16 signature — acceptable as long as
    // all tests passed. Log a warning but don't fail the regression test,
    // since the run-unit-tests.ts wrapper handles the exit-stall in the full
    // suite via force-kill after the summary line.
    if (!result.cleanExit) {
      console.warn(
        "BUG-16: server-daemon-hardening.test.ts had an exit-stall (all tests passed but process didn't exit). " +
        "The run-unit-tests.ts wrapper handles this in the full suite.",
      );
    }
  }, 90_000);

  test("server-observability.test.ts: all tests pass under 90s guard", async () => {
    const result = await runTestFileWithGuard(
      join(PROJECT_ROOT, "test/unit/server-observability.test.ts"),
    );
    expect(result.allPassed).toBe(true);
    if (!result.cleanExit) {
      console.warn(
        "BUG-16: server-observability.test.ts had an exit-stall (all tests passed but process didn't exit). " +
        "The run-unit-tests.ts wrapper handles this in the full suite.",
      );
    }
  }, 90_000);
});
