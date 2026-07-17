#!/usr/bin/env bun
/**
 * @file run-unit-tests.ts
 * @description Wrapper for `bun test test/unit/` that force-exits after the
 *              summary line prints.
 *
 * Problem: some unit tests start a TmaxServer whose process-level signal
 * handlers / unreffed timers keep the bun event loop alive after every test has
 * passed. Under the cumulative load of the full suite this prevents the process
 * from exiting, so `bun run test:unit` hangs even though all tests passed
 * (BUG-16). bun has no `--forceExit` flag in this version.
 *
 * Fix: run `bun test` as a child, stream its stdout/stderr through, and watch
 * for the summary line (`Ran N tests across M files`). Once it appears, we know
 * every test ran — force-kill the child (preserving its exit code) and exit.
 * If a test genuinely hangs (no summary within the hard timeout), the wrapper
 * reports failure instead of masking it.
 *
 * Usage: bun scripts/run-unit-tests.ts [extra bun-test args]
 */
import { spawn } from "child_process";

// Per-test timeout: the suite is ~1900 tests and under full-suite CPU load some
// tests (server startup, socket RPC, debounced auto-save) take far longer than
// their isolated runtime. 60s gives headroom without masking genuine hangs.
const PER_TEST_TIMEOUT_MS = 60_000;
// Ceiling for the whole suite: ~3000 tests across ~200 files. Under load the
// suite takes ~13-15 min; 20 min catches a genuinely hung process.
const HARD_TIMEOUT_MS = 1_200_000;
// BUG-16: inactivity timer — if the child produces NO output for this long, a
// test is blocked mid-suite (not an exit-stall, which happens after the summary).
// Server tests under load can have 30-60s gaps between output lines during slow
// socket setup; 120s catches a genuine block without false-positives.
const INACTIVITY_TIMEOUT_MS = 120_000;

// Allow the caller to pass a specific test path; default to the full unit dir
// EXCLUDING adw-* tests (they spawn real LLM subprocesses and belong in
// test:integration, not test:unit — they block the suite under concurrent
// pipeline load; see BUG-16 scope-closure docs).
import { readdirSync } from "fs";
import { join } from "path";

function buildTestArgs(): string[] {
  const explicitTarget = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("-"));
  if (explicitTarget) {
    return ["test", "--timeout", String(PER_TEST_TIMEOUT_MS), explicitTarget, ...flags];
  }
  // Default: all test/unit/*.test.ts EXCEPT adw-* (LLM-subprocess integration tests)
  const unitDir = join(import.meta.dir, "..", "test", "unit");
  const allFiles = readdirSync(unitDir)
    .filter((f) => f.endsWith(".test.ts") && !f.startsWith("adw-"))
    .map((f) => join("test/unit", f));
  // --dots emits one character per completed test, giving a steady output
  // stream. The default reporter is bursty (file-level results); under the
  // ~800s full suite a slow file cluster can create a >120s stdout gap even
  // while tests are passing, which would falsely trip the mid-suite-hang
  // inactivity timer below. With --dots + the per-test timeout, the longest
  // plausible output gap is ~PER_TEST_TIMEOUT_MS, comfortably under 120s, so
  // the inactivity timer still catches a genuine hang.
  return ["test", "--dots", "--timeout", String(PER_TEST_TIMEOUT_MS), ...allFiles, ...flags];
}

const args = buildTestArgs();
const child = spawn("bun", args, { stdio: ["ignore", "pipe", "pipe"] });

let stdout = "";
let stderr = "";
let sawSummary = false;
let lastActivityMs = Date.now();

// Stream output through so the caller sees live progress.
child.stdout.on("data", (chunk: Buffer) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
  // The summary line bun prints once all tests in all files have run, e.g.
  // "Ran 1692 tests across 100 files. [70.64s]" — presence means every file
  // executed and the only thing left is the (stuck) event-loop drain.
  if (!sawSummary && /\bRan \d+ tests? across \d+ files?\b/.test(text)) {
    sawSummary = true;
  }
  // Reset the inactivity timer on every output chunk.
  lastActivityMs = Date.now();
});
child.stderr.on("data", (chunk: Buffer) => {
  const text = chunk.toString();
  stderr += text;
  process.stderr.write(text);
  lastActivityMs = Date.now();
});

// Hard ceiling: if no summary ever appears, a test is genuinely hanging — fail.
const hardTimer = setTimeout(() => {
  if (!sawSummary) {
    process.stderr.write(
      `\nrun-unit-tests: no summary after ${Math.round(HARD_TIMEOUT_MS / 1000)}s — a test is hanging, not an exit-stall. Failing.\n`,
    );
    child.kill("SIGKILL");
    process.exit(1);
  }
}, HARD_TIMEOUT_MS);
hardTimer.unref();

child.on("exit", (code) => {
  clearTimeout(hardTimer);
  // Natural exit — respect the real code.
  process.exit(code ?? 1);
});

// Once the summary has printed, the tests are done; if the child hasn't exited
// on its own within a short grace window, force-kill it (BUG-16 exit-stall).
// Also check for mid-suite inactivity (BUG-16 mid-test block).
const graceTimer = setInterval(() => {
  // BUG-16 mid-test block: if no output for INACTIVITY_TIMEOUT_MS and we
  // haven't seen the summary, a test is blocked. Kill and fail loudly.
  if (!sawSummary && Date.now() - lastActivityMs > INACTIVITY_TIMEOUT_MS) {
    process.stderr.write(
      `\nrun-unit-tests: no output for ${Math.round(INACTIVITY_TIMEOUT_MS / 1000)}s and no summary — mid-suite hang (BUG-16). Failing.\n`,
    );
    child.kill("SIGKILL");
    process.exit(1);
  }

  if (sawSummary) {
    // Give bun a moment to flush + exit naturally; if still alive, force it.
    setTimeout(() => {
      if (!child.killed) {
        process.stderr.write(
          "\nrun-unit-tests: all tests reported; force-exiting stuck event loop (BUG-16).\n",
        );
        child.kill("SIGKILL");
      }
    }, 2000).unref();
    clearInterval(graceTimer);
  }
}, 500);
graceTimer.unref();
