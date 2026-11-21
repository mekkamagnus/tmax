import { describe, test, expect } from "bun:test";
import { runStopSequence, STOP_LINES, type StopDeps } from "../../src/cli/stop-sequence.ts";

/**
 * @file stop-sequence.test.ts
 * @description #276 — the `--stop` sequence, row by row: every state in
 * the issue's 8-row output matrix (embedded NEVER signaled — the original
 * repro; unresponsive → no unlink; owner-changed/pid-reuse → not
 * signaling) plus the boundary replacements (a mid-start daemon on
 * recheck; the verification triple failing at each leg).
 */

type Mut = Partial<StopDeps>;

const base: StopDeps = {
  socketExists: () => true,
  identity: async () => ({ mode: "daemon", pid: 100 }),
  requestShutdown: async () => {},
  close: () => {},
  sleep: async () => {},
  unlinkSocket: () => {},
  recheckConnect: async () => false,
  socketGone: () => true,
  pidsOnSocket: () => ["100"],
  cmdline: () => "/usr/local/bin/tmax --daemon",
  signal: () => {},
  pidAlive: () => false,
  isDaemonCmdline: (cmd) => cmd.includes("--daemon"),
};

const run = (m: Mut = {}) => runStopSequence({ ...base, ...m });
const row = (r: { rows: { stream: string; line: string }[]; exitCode: number }) => r.rows[0]!;

describe("#276 — the 8-row output matrix", () => {
  test("0) socket ABSENT → stdout 'Daemon not running', exit 0", async () => {
    const o = await run({ socketExists: () => false });
    expect(row(o)).toEqual({ stream: "stdout", line: STOP_LINES.notRunning });
    expect(o.exitCode).toBe(0);
  });

  test("1) exists + refused + recheck still refused → unlink → 'Stale socket removed', exit 0", async () => {
    let unlinked = false;
    const o = await run({
      identity: async () => { throw new Error("refused"); },
      recheckConnect: async () => false,
      unlinkSocket: () => { unlinked = true; },
    });
    expect(row(o)).toEqual({ stream: "stdout", line: STOP_LINES.staleRemoved });
    expect(o.exitCode).toBe(0);
    expect(unlinked).toBe(true);
  });

  test("1b) refused but the RECHECK connects (a mid-start daemon) → proceeds to identity", async () => {
    const o = await run({
      identity: async () => { throw new Error("refused"); },
      recheckConnect: async () => true,
      // The post-recheck path re-asks identity: answer embedded.
      socketExists: () => true,
      requestShutdown: async () => {},
      socketGone: () => true,
    });
    // (identity threw once; the sequence treats the accepted recheck as
    // connected and asks again via safeIdentity — the second ask is the
    // deps' identity; our throw-everything mock makes it unresponsive,
    // which IS the correct row for connected-but-silent.)
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.unresponsive });
    expect(o.exitCode).toBe(1);
  });

  test("2) connected, identity NO REPLY (1s) → stderr unresponsive, NO unlink, exit 1", async () => {
    let unlinked = false;
    const o = await run({
      identity: async () => null,
      unlinkSocket: () => { unlinked = true; },
    });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.unresponsive });
    expect(o.exitCode).toBe(1);
    expect(unlinked).toBe(false); // the socket is left in place
  });

  test("3) EMBEDDED → stdout embedded row, exit 1, NEVER signaled (the original repro)", async () => {
    let signaled = false;
    const o = await run({
      identity: async () => ({ mode: "embedded", pid: 42 }),
      signal: () => { signaled = true; },
    });
    expect(row(o)).toEqual({ stream: "stdout", line: STOP_LINES.embedded });
    expect(o.exitCode).toBe(1);
    expect(signaled).toBe(false);
  });

  test("4) daemon, graceful shutdown, socket gone → 'Daemon stopped', exit 0", async () => {
    let rpc = false;
    const o = await run({ requestShutdown: async () => { rpc = true; }, socketGone: () => true });
    expect(row(o)).toEqual({ stream: "stdout", line: STOP_LINES.stopped });
    expect(o.exitCode).toBe(0);
    expect(rpc).toBe(true);
  });

  test("5) survives + verification triple passes + SIGTERM works → '(SIGTERM)', exit 0", async () => {
    let signaled = "";
    const o = await run({
      socketGone: () => false,
      // The step-5 re-identity: same daemon.
      signal: (pid) => { signaled = pid; },
    });
    expect(row(o)).toEqual({ stream: "stdout", line: STOP_LINES.stoppedSigterm });
    expect(o.exitCode).toBe(0);
    expect(signaled).toBe("100");
  });

  test("5b) survives SIGTERM → stderr 'Warning: daemon did not stop', exit 1", async () => {
    const o = await run({ socketGone: () => false, pidAlive: () => true });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.survived });
    expect(o.exitCode).toBe(1);
  });
});

describe("#276 — the verification triple (replacement at each boundary)", () => {
  test("identity changed on revalidation → not signaling", async () => {
    let asked = 0;
    const o = await run({
      socketGone: () => false,
      identity: async () => ({ mode: asked++ === 0 ? "daemon" : "embedded", pid: 100 }),
    });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.ownerChanged });
  });

  test("lsof unusable → not signaling", async () => {
    const o = await run({ socketGone: () => false, pidsOnSocket: () => null });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.ownerChanged });
  });

  test("lsof finds TWO pids → not signaling", async () => {
    const o = await run({ socketGone: () => false, pidsOnSocket: () => ["100", "200"] });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.ownerChanged });
  });

  test("pid mismatch (identity pid ≠ lsof pid) → not signaling (pid reuse)", async () => {
    const o = await run({ socketGone: () => false, identity: async () => ({ mode: "daemon", pid: 999 }) });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.ownerChanged });
  });

  test("cmdline missing (pid gone) → not signaling", async () => {
    const o = await run({ socketGone: () => false, cmdline: () => null });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.ownerChanged });
  });

  test("REPLACEMENT daemon (re-identity pid ≠ the original) → not signaling", async () => {
    let asked = 0;
    const o = await run({
      socketGone: () => false,
      identity: async () => ({ mode: "daemon", pid: asked++ === 0 ? 100 : 777 }),
      pidsOnSocket: () => ["777"],
      cmdline: () => "/usr/local/bin/tmax --daemon",
    });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.ownerChanged });
  });

  test("cmdline is NOT the tmax daemon (an unrelated process) → not signaling", async () => {
    const o = await run({ socketGone: () => false, cmdline: () => "/usr/sbin/cfprefsd" });
    expect(row(o)).toEqual({ stream: "stderr", line: STOP_LINES.ownerChanged });
  });
});
