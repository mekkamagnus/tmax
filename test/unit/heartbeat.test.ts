/**
 * @file heartbeat.test.ts
 * @description Unit tests for adws/adws-modules/heartbeat.ts (§B helper).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { withHeartbeat, fmtElapsed, fmtBytes, type HeartbeatClock } from "../../adws/adws-modules/heartbeat.ts";

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "heartbeat-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * A controlled clock + timer that fires callbacks synchronously when advanced.
 * This avoids any real timer dependency in tests.
 */
function makeControlledClock(): HeartbeatClock & { advance(ms: number): void; tickMs: number } {
  let tickMs = 0;
  const callbacks: Array<{ cb: () => void; ms: number; lastFired: number }> = [];
  return {
    now: () => tickMs,
    setInterval: (cb, ms) => {
      const entry = { cb, ms, lastFired: tickMs };
      callbacks.push(entry);
      return entry;
    },
    clearInterval: (handle) => {
      const idx = callbacks.indexOf(handle as { cb: () => void; ms: number; lastFired: number });
      if (idx >= 0) callbacks.splice(idx, 1);
    },
    advance(ms: number) {
      tickMs += ms;
      // Fire any intervals whose time has come (relative to their last fire).
      for (const entry of callbacks) {
        while (tickMs - entry.lastFired >= entry.ms) {
          entry.lastFired += entry.ms;
          entry.cb();
        }
      }
    },
    get tickMs() { return tickMs; },
  };
}

describe("withHeartbeat", () => {
  test("emits N beats for N controlled timer advances", async () => {
    const clock = makeControlledClock();
    const lines: string[] = [];
    let resolveFn: () => void;
    const pending = new Promise<void>((r) => { resolveFn = r; });

    const promise = withHeartbeat(
      { stage: "build", intervalMs: 1000, write: (s) => lines.push(s), clock },
      () => pending,
    );

    clock.advance(1000);
    clock.advance(1000);
    resolveFn!();
    await promise;

    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("[adw] build running");
    expect(lines[0]).toContain("1s elapsed");
    expect(lines[1]).toContain("2s elapsed");
  });

  test("clears interval on resolve", async () => {
    const clock = makeControlledClock();
    const lines: string[] = [];

    await withHeartbeat(
      { stage: "build", intervalMs: 1000, write: (s) => lines.push(s), clock },
      async () => "result",
    );

    // Advancing after completion should not produce any new beats.
    const before = lines.length;
    clock.advance(5000);
    expect(lines.length).toBe(before);
  });

  test("clears interval on reject and re-throws", async () => {
    const clock = makeControlledClock();
    const lines: string[] = [];
    let rejectFn: (e: Error) => void;
    const pending = new Promise<string>((_, rej) => { rejectFn = rej; });

    const promise = withHeartbeat(
      { stage: "build", intervalMs: 1000, write: (s) => lines.push(s), clock },
      () => pending,
    );

    clock.advance(1000);
    rejectFn!(new Error("stage failed"));

    await expect(promise).rejects.toThrow("stage failed");

    // No additional beats after rejection.
    const before = lines.length;
    clock.advance(5000);
    expect(lines.length).toBe(before);
  });

  test("teeFile growth → byte delta in heartbeat line", async () => {
    const clock = makeControlledClock();
    const lines: string[] = [];
    const teeFile = join(tmp, "raw-output.jsonl");
    writeFileSync(teeFile, "x".repeat(100)); // initial content

    let resolveFn: () => void;
    const pending = new Promise<void>((r) => { resolveFn = r; });

    const promise = withHeartbeat(
      { stage: "build", teeFile, intervalMs: 1000, write: (s) => lines.push(s), clock },
      () => pending,
    );

    // Grow the file between beats.
    writeFileSync(teeFile, "x".repeat(100) + "y".repeat(42_000));
    clock.advance(1000);
    resolveFn!();
    await promise;

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("raw-output.jsonl");
    expect(lines[0]).toContain("+41KB");
  });

  test("teeFile absent → elapsed-only line, no crash", async () => {
    const clock = makeControlledClock();
    const lines: string[] = [];
    const teeFile = join(tmp, "nonexistent.jsonl");

    let resolveFn: () => void;
    const pending = new Promise<void>((r) => { resolveFn = r; });

    const promise = withHeartbeat(
      { stage: "review", teeFile, intervalMs: 1000, write: (s) => lines.push(s), clock },
      () => pending,
    );

    clock.advance(1000);
    resolveFn!();
    await promise;

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("[adw] review running");
    expect(lines[0]).toContain("1s elapsed");
    expect(lines[0]).not.toContain("since last beat");
  });

  test("teeFile appears mid-run → handled gracefully", async () => {
    const clock = makeControlledClock();
    const lines: string[] = [];
    const teeFile = join(tmp, "growing.jsonl");

    let resolveFn: () => void;
    const pending = new Promise<void>((r) => { resolveFn = r; });

    const promise = withHeartbeat(
      { stage: "build", teeFile, intervalMs: 1000, write: (s) => lines.push(s), clock },
      () => pending,
    );

    // First beat: file absent → elapsed-only.
    clock.advance(1000);
    // File appears before second beat.
    writeFileSync(teeFile, "data");
    clock.advance(1000);
    resolveFn!();
    await promise;

    expect(lines.length).toBe(2);
    expect(lines[0]).not.toContain("since last beat");
    expect(lines[1]).toContain("since last beat");
  });

  test("write throws → no crash, fn still resolves", async () => {
    const clock = makeControlledClock();

    let resolveFn: (v: string) => void;
    const pending = new Promise<string>((r) => { resolveFn = r; });

    const promise = withHeartbeat(
      {
        stage: "build",
        intervalMs: 1000,
        write: () => { throw new Error("stderr closed"); },
        clock,
      },
      () => pending,
    );

    clock.advance(1000); // triggers write → throws → swallowed
    resolveFn!("done");
    const result = await promise;
    expect(result).toBe("done"); // fn resolved despite write failure
  });

  test("write throws → fn still rejects properly", async () => {
    const clock = makeControlledClock();

    let rejectFn: (e: Error) => void;
    const pending = new Promise<string>((_, rej) => { rejectFn = rej; });

    const promise = withHeartbeat(
      {
        stage: "build",
        intervalMs: 1000,
        write: () => { throw new Error("stderr closed"); },
        clock,
      },
      () => pending,
    );

    clock.advance(1000);
    rejectFn!(new Error("real error"));

    await expect(promise).rejects.toThrow("real error");
  });
});

describe("fmtElapsed", () => {
  test("0ms → 0s", () => {
    expect(fmtElapsed(0)).toBe("0s");
  });

  test("sub-second → rounds to 0s", () => {
    expect(fmtElapsed(500)).toBe("0s");
  });

  test("exactly 30s", () => {
    expect(fmtElapsed(30_000)).toBe("30s");
  });

  test("1m 5s", () => {
    expect(fmtElapsed(65_000)).toBe("1m5s");
  });

  test("4m 12s", () => {
    expect(fmtElapsed(252_000)).toBe("4m12s");
  });

  test(">1h", () => {
    expect(fmtElapsed(3_661_000)).toBe("1h1m");
  });

  test("negative → clamped to 0s", () => {
    expect(fmtElapsed(-100)).toBe("0s");
  });
});

describe("fmtBytes", () => {
  test("0 bytes", () => {
    expect(fmtBytes(0)).toBe("0B");
  });

  test("512 bytes", () => {
    expect(fmtBytes(512)).toBe("512B");
  });

  test("1KB", () => {
    expect(fmtBytes(1024)).toBe("1KB");
  });

  test("42KB", () => {
    expect(fmtBytes(42_000)).toBe("41KB");
  });

  test("1MB", () => {
    expect(fmtBytes(1_048_576)).toBe("1MB");
  });

  test("negative delta (file truncated)", () => {
    const result = fmtBytes(-1024);
    expect(result).toContain("-");
    expect(result).toContain("KB");
  });
});
