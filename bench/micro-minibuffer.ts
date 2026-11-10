/**
 * @file micro-minibuffer.ts
 * @description Microbenchmark — M-x minibuffer candidate-build path.
 *
 * Measures `(command-completion-refresh)` — the M-x candidate build:
 * `callable-command-details` (enumerate) + `filter command-detail-interactive-p`
 * + `mapcar command-detail-candidate`. Pre-#182 the uncached build was ~280ms;
 * post-#182 (BUG-78) it is cached per-session, invalidated only on module load.
 *
 * The bench warmup populates the cache, so the timed loop measures the REALISTIC
 * cached path (~1ms for N=50, ~16–21µs/call measured 2026-11-10; ~85ms for
 * N=50 at #182 time) — the M-x experience a user gets. A cache regression (or
 * accidental cache-bust) drops back to the uncached build, now ~8ms/call
 * post-#234 (was ~280ms at BUG-78 time — #238 re-profile), i.e. ~400ms for
 * N=50, failing the tightened 100ms floor 4× over (#238 / ADR-0268).
 *
 * Size-independent (the candidate set does not depend on a buffer) and the
 * build is cached after warmup, so it is measured ONCE — the runner
 * dispatches it per-size but each call returns the same cached row.
 */

import { makeStartedEditor } from "./editor-harness.ts";
import { Either } from "../src/utils/task-either.ts";
import { assertFloor, type BenchResult, type BenchSize } from "./output.ts";

const N = 50;
const WARMUP = 3;

/**
 * Regression floor in milliseconds (total budget for N=50 cached refreshes).
 * Measured 2026-11-10 (#238): cached path ~1ms for N=50 (~16–21µs/call) —
 * the floor is ~100× that to absorb CI / cold-JIT variance. A full cache-bust
 * regression lands at ~400ms (50 × ~8ms post-#234), failing this 4× over;
 * at the old 400ms floor a bust sat exactly ON the pass boundary
 * (`wallMs <= floorMs` passes), so the floor was tightened 400→100 (#238 /
 * ADR-0268).
 */
const FLOOR_MS = 100;

const EXPR = "(command-completion-refresh)";

/** Cached single measurement (candidate-build is size-independent). */
let cached: BenchResult | null = null;

async function measureOnce(): Promise<BenchResult> {
  const { editor, server } = await makeStartedEditor();
  try {
    const interp = editor.getInterpreter();

    for (let i = 0; i < WARMUP; i++) {
      const r = interp.execute(EXPR);
      if (Either.isLeft(r)) throw new Error(`warmup failed: ${JSON.stringify(r.left)}`);
    }

    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) {
      const r = interp.execute(EXPR);
      if (Either.isLeft(r)) throw new Error(`failed at i=${i}: ${JSON.stringify(r.left)}`);
    }
    const end = Bun.nanoseconds();

    const wallNs = end - start;
    const wallMs = wallNs / 1e6;
    const opsPerSec = N / (wallNs / 1e9);

    return assertFloor({
      name: "minibuffer",
      size: "small",
      opsPerSec,
      bytesPerOp: 0, // not meaningful — the metric is candidate-builds/sec
      wallMs,
      floorMs: FLOOR_MS,
    });
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}

export async function runMinibufferBench(size: BenchSize): Promise<BenchResult> {
  if (!cached) cached = await measureOnce();
  return cached.size === size ? cached : { ...cached, size };
}
