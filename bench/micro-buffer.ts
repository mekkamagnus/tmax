/**
 * @file micro-buffer.ts
 * @description Microbenchmark 1 — buffer edit throughput.
 *
 * Loads a fixture, constructs `TextBufferImpl`, and performs N=1000
 * alternating insert/delete operations at the end of a moving cursor line. Each
 * edit currently triggers `toString()` + `splitLines()` over the whole buffer
 * (RFC-019 Tier 1.1–1.3), so this microbenchmark is the direct measurement
 * target for the upcoming Tier 1 fixes.
 *
 * Warmup: the first `WARMUP` ops run before measurement to absorb JIT cost.
 * Floor: the regression ceiling per size; the harness fails loudly if wall time
 * exceeds it. Baselines are recorded in `bench/README.md`.
 */

import { TextBufferImpl } from "../src/core/buffer.ts";
import type { Range, TextBuffer } from "../src/core/types.ts";
import { Either } from "../src/utils/task-either.ts";
import { fixturePath } from "./fixtures/generate.ts";
import { assertFloor, type BenchResult, type BenchSize } from "./output.ts";

const N = 1000;
const WARMUP = 50;

/**
 * Per-size regression floors in milliseconds. Each is sized to the dev-machine
 * baseline measured during this chore (small ~410–640ms, medium ~5.1–7.7s,
 * large ~25–37.6s depending on whether the bench runs in isolation or as part
 * of the full 9-row suite), rounded up to absorb cross-row GC / JIT pressure.
 * Update via `bun run bench` after a deliberate optimization; see README.
 */
const FLOORS_MS: Record<BenchSize, number> = {
  small: 900,
  medium: 11000,
  large: 50000,
};

function lineLength(b: TextBuffer, line: number): number {
  const r = b.getLine(line);
  if (Either.isLeft(r)) throw new Error(`getLine(${line}) failed: ${r.left}`);
  return r.right.length;
}

function doEdit(b: TextBuffer, i: number, lineCount: number): TextBuffer {
  // Each logical "pair" is an insert followed by its cleanup delete. Pair p
  // operates on line `p % lineCount`. Op i is an insert when i is even, a
  // delete when odd — so the buffer state stays bounded across the run.
  const pairIdx = Math.floor(i / 2);
  const lineIdx = pairIdx % lineCount;
  if (i % 2 === 0) {
    const col = lineLength(b, lineIdx);
    const r = b.insert({ line: lineIdx, column: col }, "X");
    if (Either.isLeft(r)) throw new Error(`insert failed at line ${lineIdx}: ${r.left}`);
    return r.right;
  }
  // Delete the "X" we just inserted at the end of the same line.
  const col = lineLength(b, lineIdx);
  const range: Range = {
    start: { line: lineIdx, column: col - 1 },
    end: { line: lineIdx, column: col },
  };
  const r = b.delete(range);
  if (Either.isLeft(r)) throw new Error(`delete failed at line ${lineIdx}: ${r.left}`);
  return r.right;
}

export async function runBufferBench(size: BenchSize): Promise<BenchResult> {
  const path = await fixturePath(size);
  const content = await Bun.file(path).text();
  const contentBytes = content.length;

  let buffer: TextBuffer = TextBufferImpl.create(content);
  const lineCountR = buffer.getLineCount();
  if (Either.isLeft(lineCountR)) throw new Error(`getLineCount failed: ${lineCountR.left}`);
  const lineCount = lineCountR.right;
  if (lineCount <= 0) throw new Error(`empty fixture: ${path}`);

  // Warmup: prime the JIT without recording timings.
  for (let i = 0; i < WARMUP; i++) {
    buffer = doEdit(buffer, i, lineCount);
  }

  // Reset to a fresh buffer so warmup state doesn't pollute the measurement.
  buffer = TextBufferImpl.create(content);

  const start = Bun.nanoseconds();
  for (let i = 0; i < N; i++) {
    buffer = doEdit(buffer, i, lineCount);
  }
  const end = Bun.nanoseconds();

  const wallNs = end - start;
  const wallMs = wallNs / 1e6;
  const opsPerSec = N / (wallNs / 1e9);
  const bytesPerOp = contentBytes / N;

  return assertFloor({
    name: "buffer",
    size,
    opsPerSec,
    bytesPerOp,
    wallMs,
    floorMs: FLOORS_MS[size],
  });
}
