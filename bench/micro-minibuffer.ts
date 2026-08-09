/**
 * @file micro-minibuffer.ts
 * @description Microbenchmark — M-x minibuffer candidate-build path.
 *
 * Measures `(command-completion-refresh)` — the REAL M-x candidate build:
 * `callable-command-details` (enumerate) + `filter command-detail-interactive-p`
 * + `mapcar command-detail-candidate`. This is the full "enumeration +
 * filtering" the per-keystroke minibuffer path runs (spec Task 1), and it is
 * the BUG-78 hot path: baseline is ~280ms/call (the enumeration is ~15ms; the
 * T-Lisp string-name filter/mapcar dominates the rest). This is the number
 * per-session caching (#182 / BUG-78) must beat, and CHORE-84 wires it as a
 * regression floor so the optimization can't silently regress.
 *
 * Size-independent (the candidate set does not depend on a buffer) and
 * expensive (~280ms/call), so it is measured ONCE and cached — the runner
 * dispatches it per-size but each call returns the same cached row.
 */

import { makeStartedEditor } from "./editor-harness.ts";
import { Either } from "../src/utils/task-either.ts";
import { assertFloor, type BenchResult, type BenchSize } from "./output.ts";

// Each refresh is ~280ms; N is kept modest so a routine `bench` run stays
// tractable (the bench measures the candidate-build, not thousands of ops).
const N = 50;
const WARMUP = 3;

/**
 * Regression floor in milliseconds (total budget for N=50 refreshes). Sized to
 * the baseline measured during CHORE-84 (~280ms/call → ~14000ms for N=50),
 * rounded up ~60% to absorb CI / first-load JIT variance.
 */
const FLOOR_MS = 22_000;

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
