/**
 * @file micro-e2e.ts
 * @description Microbenchmark 3 — end-to-end daemon keystroke throughput.
 *
 * Spawns a fresh daemon (via `tmax-use/src/instance.ts`), opens a fixture,
 * sends N=200 keystrokes through the JSON-RPC socket, and measures wall time.
 * Each key exercises the full keystroke path: RPC serialize → buffer edit →
 * viewport re-tokenize → repaint. This is the most RFC-019-sensitive of the
 * three microbenchmarks: Tier 1 buffer fixes should move this number the most.
 *
 * Daemon lifecycle is owned by `TmaxInstance` — we never invoke
 * `bin/tmax --stop` because we use an isolated socket path.
 */

import { promises as fs, existsSync } from "fs";
import { TmaxInstance } from "../tmax-use/src/instance.ts";
import { TaskEither, Either } from "../src/utils/task-either.ts";
import { fixturePath } from "./fixtures/generate.ts";
import { assertFloor, type BenchResult, type BenchSize } from "./output.ts";

const N = 200;

/**
 * Per-size regression floor in milliseconds. End-to-end throughput is
 * dominated by per-key socket round-trip latency (each keypress opens a
 * fresh socket; ~10–15ms per key on the dev machine). Floors are sized to
 * the baseline measured during this chore (small ~2400ms, medium ~5140ms,
 * large ~30800ms), rounded up ~30–40% for CI variance.
 */
const FLOORS_MS: Record<BenchSize, number> = {
  small: 3500,
  medium: 7000,
  large: 40000,
};

/** Build a representative keystroke sequence: mostly cursor moves, occasional insert+escape cycles. */
function buildKeystrokes(n: number): readonly string[] {
  const out: string[] = new Array(n);
  const moves = ["j", "l", "h", "k"];
  let i = 0;
  while (i < n) {
    // Every 6th slot starts a 3-key insert cycle: i → char → Esc.
    if (i % 6 === 0 && i + 3 <= n) {
      out[i] = "i";
      out[i + 1] = "x";
      out[i + 2] = "\x1b";
      i += 3;
      continue;
    }
    out[i] = moves[i % moves.length]!;
    i += 1;
  }
  return out;
}

/** Estimated bytes-per-keystroke: serialized JSON-RPC request size for one `keypress`. */
function estimateBytesPerKeystroke(): number {
  const sample = JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "keypress",
    params: { key: "j" },
  }) + "\n";
  return sample.length;
}

function isolatedSocketPath(): string {
  const uid = process.getuid?.() ?? 501;
  return `/tmp/tmax-${uid}/bench-${process.pid}-${Date.now()}/server`;
}

async function unwrap<T>(task: TaskEither<unknown, T>, label: string): Promise<T> {
  const r = await task.run();
  if (Either.isLeft(r)) {
    throw new Error(`${label} failed: ${JSON.stringify(r.left)}`);
  }
  return r.right as T;
}

export async function runE2EBench(size: BenchSize): Promise<BenchResult> {
  const fixture = await fixturePath(size);
  const socketPath = isolatedSocketPath();

  const instance = await unwrap(
    TmaxInstance.launch({ socketPath }),
    "TmaxInstance.launch",
  );

  try {
    const client = instance.client;
    await unwrap(client.open(fixture), "client.open");
    const keys = buildKeystrokes(N);

    const start = Bun.nanoseconds();
    await unwrap(client.keys(keys), "client.keys");
    const end = Bun.nanoseconds();

    const wallNs = end - start;
    const wallMs = wallNs / 1e6;
    const opsPerSec = N / (wallNs / 1e9);
    const bytesPerOp = estimateBytesPerKeystroke();

    return assertFloor({
      name: "e2e",
      size,
      opsPerSec,
      bytesPerOp,
      wallMs,
      floorMs: FLOORS_MS[size],
    });
  } finally {
    // Always tear down the daemon we spawned, even on failure. Idempotent.
    try {
      await instance.close().run();
    } catch { /* best-effort */ }
    try {
      if (existsSync(socketPath)) await fs.unlink(socketPath);
    } catch { /* fine */ }
  }
}
