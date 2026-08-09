/**
 * @file micro-render.ts
 * @description Microbenchmark — frame render path (`captureFrame`).
 *
 * Measures the standalone render function that turns an EditorState into ANSI
 * lines — the per-keystroke repaint cost shared by the Steep frontend and the
 * TUI client (syntax-highlight spans + viewport + status line + tab bar +
 * minibuffer + which-key overlay). This runs every key but was never measured
 * in isolation; it is roughly half the per-key cost.
 *
 * Scales with fixture size (the viewport tokenizes more lines on larger
 * buffers), so a per-size floor applies.
 */

import { makeStartedEditor } from "./editor-harness.ts";
import { captureFrame } from "../src/render/capture-frame.ts";
import { readFileSync } from "fs";
import { fixturePath } from "./fixtures/generate.ts";
import { assertFloor, type BenchResult, type BenchSize } from "./output.ts";

const N = 500;
const WARMUP = 20;
const WIDTH = 80;
const HEIGHT = 24;

/**
 * Per-size regression floor in milliseconds (total budget for N=500 frames).
 * Sized to the baseline measured during CHORE-84 (small ~155ms cold-JIT,
 * medium ~90ms, large ~200ms), rounded up to absorb CI variance.
 */
const FLOORS_MS: Record<BenchSize, number> = {
  small: 250,
  medium: 200,
  large: 350,
};

export async function runRenderBench(size: BenchSize): Promise<BenchResult> {
  const { editor, server } = await makeStartedEditor();
  try {
    const text = readFileSync(await fixturePath(size), "utf8");
    editor.createBuffer("bench", text);
    const state = editor.getState();

    let bytesPerOp = 0;
    for (let i = 0; i < WARMUP; i++) {
      const lines = captureFrame(state, WIDTH, HEIGHT);
      if (bytesPerOp === 0) bytesPerOp = lines.reduce((n, l) => n + l.length, 0);
    }

    const start = Bun.nanoseconds();
    for (let i = 0; i < N; i++) {
      captureFrame(state, WIDTH, HEIGHT);
    }
    const end = Bun.nanoseconds();

    const wallNs = end - start;
    const wallMs = wallNs / 1e6;
    const opsPerSec = N / (wallNs / 1e9);

    return assertFloor({
      name: "render",
      size,
      opsPerSec,
      bytesPerOp,
      wallMs,
      floorMs: FLOORS_MS[size],
    });
  } finally {
    try { await server.shutdown(); } catch { /* best-effort */ }
  }
}
