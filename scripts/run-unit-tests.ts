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
// Ceiling for the whole suite: ~1900 tests; with 60s per-test headroom the
// realistic worst case is ~12-15 min, so 20 min is a safe "genuinely hung" line.
const HARD_TIMEOUT_MS = 1_200_000;

const args = ["test", "--timeout", String(PER_TEST_TIMEOUT_MS), "test/unit/", ...process.argv.slice(2)];
const child = spawn("bun", args, { stdio: ["ignore", "pipe", "pipe"] });

let stdout = "";
let stderr = "";
let sawSummary = false;

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
});
child.stderr.on("data", (chunk: Buffer) => {
  const text = chunk.toString();
  stderr += text;
  process.stderr.write(text);
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
const graceTimer = setInterval(() => {
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
