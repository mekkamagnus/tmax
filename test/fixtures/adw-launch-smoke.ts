#!/usr/bin/env bun
/**
 * adw-launch-smoke.ts — harmless smoke fixture for the adw-launch live tmux test.
 *
 * Used ONLY by the live integration smoke test (Task 6 in SPEC-060). Does NOT
 * launch any real adw pipeline or call any LLM tooling — it is a no-op script
 * whose only job is to (a) write a marker file proving it ran with the expected
 * args, (b) signal `tmux wait-for -S <signal>` so the test driver can
 * synchronize, and (c) sleep long enough for `tmux list-windows -t tmax` to
 * observe the window before tmux closes it on exit.
 *
 * Invocation:
 *   bun test/fixtures/adw-launch-smoke.ts --marker <path> --signal <name> [payload...]
 *
 * The payload (everything after --marker/--signal) is recorded in the marker
 * file so the test can verify quoted args were preserved end-to-end through
 * adw-launch's shell construction.
 *
 * Exit 0 after the sleep.
 */
import { writeFileSync } from "fs";
import { spawn } from "child_process";

const argv = process.argv.slice(2);

// Parse fixture-only flags (--marker, --signal) before the payload starts.
// Payload starts at the first non-flag positional or unknown flag.
let marker = "";
let signal = "";
let i = 0;
while (i < argv.length) {
  const a = argv[i]!;
  if (a === "--marker") {
    marker = argv[++i] ?? "";
    i++;
  } else if (a === "--signal") {
    signal = argv[++i] ?? "";
    i++;
  } else {
    break;
  }
}
const payload = argv.slice(i);

// Write marker file with payload + timestamp + pid. The test driver checks this
// file's contents after `tmux wait-for <signal>` unblocks.
writeFileSync(
  marker,
  JSON.stringify({ args: payload, ts: new Date().toISOString(), pid: process.pid }, null, 2) + "\n",
);

// Signal readiness. `tmux wait-for -S <channel>` is level-triggered: any future
// `tmux wait-for <channel>` (without -S) returns immediately once this fires.
// Awaiting the spawn's exit ensures the signal is delivered before we sleep.
if (signal) {
  await new Promise<void>((resolve) => {
    const child = spawn("tmux", ["wait-for", "-S", signal], { stdio: "ignore" });
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
}

// Sleep 30s so the test driver can observe the adw-smoke window via
// `tmux list-windows -t tmax` before this script exits and tmux closes the
// window. (remain-on-exit is not enabled on the tmax session by default.)
await new Promise((r) => setTimeout(r, 30_000));
process.exit(0);
