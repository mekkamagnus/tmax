/**
 * @file micro-startup.ts
 * @description Microbenchmark — module-load / `startEditor()` wall time.
 *
 * Measures the cost of loading every core `.tlisp` file and registering all
 * editor primitives — the user-visible first-impression latency. startEditor is
 * async and size-independent, so the workload averages N full
 * create→start→shutdown cycles and caches a single measurement; the runner
 * dispatches it per-size but each call returns the same cached row.
 */

import { Editor } from "../src/editor/editor.ts";
import { TerminalIOImpl } from "../src/core/terminal.ts";
import { FileSystemImpl } from "../src/core/filesystem.ts";
import { TmaxServer } from "../src/server/server.ts";
import { isolateHome } from "./editor-harness.ts";
import { assertFloor, type BenchResult, type BenchSize } from "./output.ts";

const N = 5;

/**
 * Regression floor in milliseconds for one startEditor cycle. Sized to the
 * baseline measured during CHORE-84 (~1490ms averaged over 5 cycles), rounded
 * up ~65% to absorb CI variance.
 */
const FLOOR_MS = 2500;

/** Cached single measurement (startup is size-independent — measured once). */
let cached: BenchResult | null = null;

async function measureOnce(): Promise<BenchResult> {
  isolateHome();
  let totalNs = 0;
  for (let i = 0; i < N; i++) {
    const editor = new Editor(new TerminalIOImpl(true), new FileSystemImpl());
    const server = new TmaxServer(undefined, true, editor, undefined, true);
    const start = Bun.nanoseconds();
    await server.startEditor();
    const end = Bun.nanoseconds();
    totalNs += end - start;
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
  const wallNs = totalNs / N;
  const wallMs = wallNs / 1e6;
  const opsPerSec = 1000 / wallMs; // startups per second
  // Record against the first size dispatched; other sizes relabel below.
  return assertFloor({
    name: "startup",
    size: "small",
    opsPerSec,
    bytesPerOp: 0, // not meaningful — the metric is ms-to-first-edit
    wallMs,
    floorMs: FLOOR_MS,
  });
}

export async function runStartupBench(size: BenchSize): Promise<BenchResult> {
  if (!cached) cached = await measureOnce();
  // Same measurement, relabeled for the requested size row.
  return cached.size === size ? cached : { ...cached, size };
}
