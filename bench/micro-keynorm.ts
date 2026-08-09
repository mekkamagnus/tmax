/**
 * @file micro-keynorm.ts
 * @description Microbenchmark — per-key normalization + dispatch overhead.
 *
 * Drives `editor.handleKey` in-process for N keys (alternating j/k/l/h so the
 * cursor oscillates without hitting buffer bounds). This is the editor's
 * per-key cost — normalizeKey + mode dispatch + handler + cheap cursor edit —
 * isolated from the daemon/socket round-trip that `micro-e2e` adds on top. It
 * is the in-process answer to "why does the editor feel like it's dragging on
 * every keystroke?" The baseline (CHORE-84) is ~22–25ms/key — well above the
 * long-term sub-1ms target — so the floor is set at the current reality and
 * will FAIL-pass-forward as per-key work is eliminated.
 */

import { makeStartedEditor } from "./editor-harness.ts";
import { readFileSync } from "fs";
import { fixturePath } from "./fixtures/generate.ts";
import { assertFloor, type BenchResult, type BenchSize } from "./output.ts";

// Each handleKey is ~10–20ms (the per-key cost this bench exists to surface),
// so N is kept modest to keep routine `bench` runs under a few seconds per size.
const N = 300;
const WARMUP = 30;
const KEYS = ["j", "k", "l", "h"] as const;

/**
 * Per-size regression floor in milliseconds (total budget for N=300 keys).
 * The baseline measured during CHORE-84 is ~22–25ms/key (small ~6600ms,
 * medium ~7700ms, large ~7450ms) — much higher than the sub-1ms target, which
 * is exactly the "dragging on every keystroke" cost this bench surfaces.
 * Floors are set ~60% above the baseline so optimization (e.g. dropping
 * per-key retokenization) shows as PASS while regressions FAIL.
 */
const FLOORS_MS: Record<BenchSize, number> = {
  small: 10_000,
  medium: 12_000,
  large: 12_000,
};

export async function runKeynormBench(size: BenchSize): Promise<BenchResult> {
  const { editor, server } = await makeStartedEditor();
  try {
    const text = readFileSync(await fixturePath(size), "utf8");
    editor.createBuffer("bench", text);

    for (let i = 0; i < WARMUP; i++) {
      await editor.handleKey(KEYS[i % KEYS.length]!);
    }

    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) {
      await editor.handleKey(KEYS[i % KEYS.length]!);
    }
    const end = Bun.nanoseconds();

    const wallNs = end - start;
    const wallMs = wallNs / 1e6;
    const opsPerSec = N / (wallNs / 1e9);

    return assertFloor({
      name: "keynorm",
      size,
      opsPerSec,
      bytesPerOp: 1, // one key (1 byte) per op
      wallMs,
      floorMs: FLOORS_MS[size],
    });
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}
