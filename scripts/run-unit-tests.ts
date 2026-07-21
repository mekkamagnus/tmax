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
 * If a test genuinely hangs (no output within the inactivity timeout), the
 * wrapper reports failure instead of masking it.
 *
 * Usage: bun scripts/run-unit-tests.ts [extra bun-test args]
 */
import { spawn } from "child_process";

// Per-test timeout: the suite is ~1900 tests and under full-suite CPU load some
// tests (server startup, socket RPC, debounced auto-save) take far longer than
// their isolated runtime. 60s gives headroom without masking genuine hangs.
const PER_TEST_TIMEOUT_MS = 60_000;
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

// Keep cross-file contention low enough that test-local 20s/60s deadlines
// remain meaningful on loaded developer machines. Five files still amortize
// startup while avoiding the starvation seen when all ~200 files shared one
// Bun process (BUG-16).
const FILES_PER_BATCH = 5;

function buildTestBatches(): string[][] {
  const explicitTarget = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("-"));
  if (explicitTarget) {
    return [["test", "--timeout", String(PER_TEST_TIMEOUT_MS), explicitTarget, ...flags]];
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
  const batches: string[][] = [];
  for (let i = 0; i < allFiles.length; i += FILES_PER_BATCH) {
    batches.push([
      "test", "--dots", "--timeout", String(PER_TEST_TIMEOUT_MS),
      ...allFiles.slice(i, i + FILES_PER_BATCH),
      ...flags,
    ]);
  }
  return batches;
}

function runBatch(args: string[], index: number, total: number): Promise<number> {
  return new Promise((resolve) => {
    process.stdout.write(`\nrun-unit-tests: batch ${index + 1}/${total}\n`);
    const child = spawn("bun", args, { stdio: ["ignore", "pipe", "pipe"] });
    let combined = "";
    let sawSummary = false;
    let forcedAfterSummary = false;
    let lastActivityMs = Date.now();
    let graceTimeout: ReturnType<typeof setTimeout> | undefined;

    const onOutput = (chunk: Buffer, stream: NodeJS.WriteStream): void => {
      const text = chunk.toString();
      combined += text;
      stream.write(text);
      lastActivityMs = Date.now();
      if (!sawSummary && /\bRan \d+ tests? across \d+ files?\b/.test(combined)) {
        sawSummary = true;
        graceTimeout = setTimeout(() => {
          if (child.exitCode === null) {
            forcedAfterSummary = true;
            process.stderr.write("\nrun-unit-tests: batch reported; force-exiting stuck event loop (BUG-16).\n");
            child.kill("SIGKILL");
          }
        }, 2000);
      }
    };

    child.stdout.on("data", (chunk: Buffer) => onOutput(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => onOutput(chunk, process.stderr));

    const inactivityTimer = setInterval(() => {
      if (!sawSummary && Date.now() - lastActivityMs > INACTIVITY_TIMEOUT_MS) {
        process.stderr.write(
          `\nrun-unit-tests: batch ${index + 1} produced no output for ${Math.round(INACTIVITY_TIMEOUT_MS / 1000)}s — failing.\n`,
        );
        child.kill("SIGKILL");
      }
    }, 500);

    child.on("error", (error) => {
      process.stderr.write(`run-unit-tests: failed to spawn batch: ${error.message}\n`);
    });
    child.on("exit", (code) => {
      clearInterval(inactivityTimer);
      if (graceTimeout) clearTimeout(graceTimeout);
      if (forcedAfterSummary) {
        resolve(/\b[1-9]\d* fail\b/.test(combined) ? 1 : 0);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

const batches = buildTestBatches();
for (let i = 0; i < batches.length; i++) {
  const code = await runBatch(batches[i]!, i, batches.length);
  if (code !== 0) process.exit(code);
}
process.stdout.write(`\nrun-unit-tests: ${batches.length} batches passed\n`);
