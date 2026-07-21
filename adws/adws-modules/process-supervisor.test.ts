/**
 * @file process-supervisor.test.ts
 * @description BUG-25 — focused tests for the ownership-aware process supervisor.
 *
 * Covers the Step-5 acceptance criteria:
 *   - a grandchild left behind on successful child exit is reaped (the core fix),
 *   - a SIGTERM-ignoring grandchild is force-killed within the configured bound,
 *   - stdin injection + stdout capture,
 *   - timeout terminates the whole group and reports exitCode 1,
 *   - spawn errors surface as exitCode 1 with a message,
 *   - shutdown() is single-flight / idempotent and never touches unrelated procs,
 *   - adopt() rejects invalid PIDs and reaches a non-detached descendant whose
 *     real PGID differs from its PID.
 *
 * Uses short grace/force windows (100ms/200ms) to keep the suite fast. An
 * afterEach safety net kills any process this file spawned so a failing
 * assertion can never strand a probe process.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "child_process";
import { ProcessSupervisor } from "./process-supervisor.ts";

const isAlive = (pid: number | undefined): boolean => {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Resolve to an exit code, rejecting if the process outlives `timeoutMs`. */
const exitCodeOf = (child: ChildProcess, timeoutMs: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("process did not exit in time")), timeoutMs);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code ?? -1); });
  });

/** Short bun -e program: a detached grandchild that stays alive after child exit. */
const childThatLeavesGrandchild = (grandchild: string): string =>
  [
    "const {spawn}=require('child_process')",
    `const c=spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'})`,
    "process.stdout.write('GC='+c.pid+'\\n')",
    "process.exit(0)",
  ].join(";");

const tracked: number[] = [];
const track = (pid: number): number => { tracked.push(pid); return pid; };
const killSafe = (pid: number): void => {
  try { process.kill(-pid, "SIGKILL"); } catch { /* gone or not a leader */ }
  try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
};
afterEach(() => {
  for (const pid of tracked.splice(0)) killSafe(pid);
});

describe("ProcessSupervisor", () => {
  test("reaps a grandchild left behind on successful child exit", async () => {
    const sup = new ProcessSupervisor(100, 200);
    // Grandchild has no SIGTERM handler → dies on the graceful SIGTERM.
    const res = await sup.run(
      process.execPath,
      ["-e", childThatLeavesGrandchild("setInterval(()=>{},1000)")],
      { timeoutMs: 5_000 },
    );
    expect(res.exitCode).toBe(0);
    const grandchildPid = parseInt(res.stdout.match(/GC=(\d+)/)?.[1] ?? "0", 10);
    track(grandchildPid);
    await wait(300);
    expect(isAlive(grandchildPid)).toBe(false);
    await sup.shutdown();
  });

  test("force-kills a SIGTERM-ignoring grandchild within the bound", async () => {
    const sup = new ProcessSupervisor(100, 200);
    const res = await sup.run(
      process.execPath,
      ["-e", childThatLeavesGrandchild("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)")],
      { timeoutMs: 5_000 },
    );
    expect(res.exitCode).toBe(0);
    const grandchildPid = parseInt(res.stdout.match(/GC=(\d+)/)?.[1] ?? "0", 10);
    track(grandchildPid);
    // grace(100) + force(200) + slack → well under 2s the grandchild must be gone.
    await wait(800);
    expect(isAlive(grandchildPid)).toBe(false);
    await sup.shutdown();
  });

  test("injects stdin and captures stdout", async () => {
    const sup = new ProcessSupervisor(100, 200);
    const res = await sup.run(
      process.execPath,
      ["-e", "process.stdin.on('data',d=>process.stdout.write(d.toString().toUpperCase()))"],
      { stdinData: "hello", timeoutMs: 5_000 },
    );
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("HELLO");
    await sup.shutdown();
  });

  test("timeout terminates the tree and reports exitCode 1", async () => {
    const sup = new ProcessSupervisor(100, 200);
    // Child spawns a long-lived grandchild (printing its pid), then sleeps past
    // the timeout so the supervisor's timeout path must reap both.
    const childCode = [
      "const {spawn}=require('child_process')",
      "const g=spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:'ignore'})",
      "process.stdout.write('G='+g.pid+'\\n')",
      "setInterval(()=>{},10000)",
    ].join(";");
    const res = await sup.run(process.execPath, ["-e", childCode], { timeoutMs: 400 });
    expect(res.exitCode).toBe(1);
    const grandchildPid = parseInt(res.stdout.match(/G=(\d+)/)?.[1] ?? "0", 10);
    track(grandchildPid);
    await wait(300);
    // The whole group (child + grandchild) must be gone after the escalation.
    expect(isAlive(grandchildPid)).toBe(false);
    await sup.shutdown();
  });

  test("spawn error surfaces as exitCode 1 with a message", async () => {
    const sup = new ProcessSupervisor(100, 200);
    const res = await sup.run("/this/does/not/exist/adw-probe-binary", [], {});
    expect(res.exitCode).toBe(1);
    expect(res.stderr.length).toBeGreaterThan(0);
    await sup.shutdown();
  });

  test("shutdown() is single-flight and leaves unrelated processes alone", async () => {
    const sup = new ProcessSupervisor(100, 200);
    // Unrelated process: spawned directly, NOT owned by the supervisor.
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},10000)"], {
      stdio: "ignore",
    });
    track(unrelated.pid!);
    const first = sup.shutdown();
    const second = sup.shutdown();
    expect(first).toBe(second); // memoized: same promise object
    await first;
    await wait(200);
    expect(isAlive(unrelated.pid)).toBe(true); // untouched
    killSafe(unrelated.pid!);
  });

  test("adopt() rejects invalid PIDs", () => {
    const sup = new ProcessSupervisor(100, 200);
    expect(() => sup.adopt(0)).toThrow();
    expect(() => sup.adopt(-1)).toThrow();
    expect(() => sup.adopt(1)).toThrow();
    expect(() => sup.adopt(1.5)).toThrow();
    expect(() => sup.adopt(Number.NaN)).toThrow();
  });

  test("adopt() reaps a non-detached descendant via its resolved PGID (PGID ≠ PID)", async () => {
    const sup = new ProcessSupervisor(100, 200);
    // B is a detached group leader (owned). It spawns D NON-detached, so D's
    // real PGID is B.pid, not D.pid — exactly the "PGID differs from PID" case
    // adopt() exists to handle.
    const bCode = [
      "const {spawn}=require('child_process')",
      "const d=spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:'ignore'})",
      "process.stdout.write('D='+d.pid+'\\n')",
      "setInterval(()=>{},10000)",
    ].join(";");
    const managedB = sup.spawn(process.execPath, ["-e", bCode], { stdio: ["ignore", "pipe", "ignore"] });
    track(managedB.pid);
    let bStdout = "";
    managedB.child.stdout!.on("data", (c: Buffer) => { bStdout += c.toString(); });
    const dPid = parseInt(await new Promise<string>((resolve) => {
      const check = (): void => {
        const m = bStdout.match(/D=(\d+)/);
        if (m && m[1]) resolve(m[1]);
        else setTimeout(check, 20);
      };
      check();
    }), 10);
    track(dPid);
    expect(dPid).toBeGreaterThan(0);
    expect(isAlive(dPid)).toBe(true);

    const adopted = sup.adopt(dPid);
    // resolvePgid should have returned B's group, which differs from D's own pid.
    expect(adopted.pid).toBe(dPid);
    await sup.terminate(adopted);
    await wait(300);
    expect(isAlive(dPid)).toBe(false);
    // B's whole group was signalled (-B.pid), so B is dead too.
    expect(isAlive(managedB.pid)).toBe(false);
    await sup.shutdown();
  });

  test("adopt() of an already-dead pid does not throw", async () => {
    const sup = new ProcessSupervisor(100, 200);
    const shortLived = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const pid = await new Promise<number>((resolve) => shortLived.once("exit", () => resolve(shortLived.pid ?? 0)));
    // pid is now recycled/gone; adopt must not throw and terminate is a no-op.
    const adopted = sup.adopt(pid);
    await sup.terminate(adopted);
    expect(true).toBe(true);
  });
});

describe("runAdwEntrypoint exit codes", () => {
  test("--help path returns 0 through the wrapper", async () => {
    // Exercises the awaited-cleanup finalizer without spawning agents.
    const child = spawn("bun", ["adws/adw-build.ts", "--help"], { stdio: "ignore" });
    track(child.pid!);
    const code = await exitCodeOf(child, 15_000);
    expect(code).toBe(0);
  });
});
