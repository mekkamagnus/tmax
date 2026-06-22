/**
 * @file micro-tlisp.ts
 * @description Microbenchmark 2 — T-Lisp eval throughput.
 *
 * Evaluates a small representative command N=10,000 times against a fresh
 * `TLispInterpreterImpl`. Each evaluation exercises the full parse → eval
 * pipeline (RFC-019 Tier 2.3 parse cache, Tier 2.6 tokenizer regexes).
 *
 * The workload mirrors `src/editor/handlers/normal-handler.ts:48` — the kind
 * of small repeated command the keystroke path fires on every key.
 *
 * The `size` parameter is ignored (the workload is identical across sizes);
 * it is kept for uniform dispatch through the runner.
 */

import { TLispInterpreterImpl } from "../src/tlisp/interpreter.ts";
import { Either } from "../src/utils/task-either.ts";
import { assertFloor, type BenchResult, type BenchSize } from "./output.ts";

const N = 10_000;
const WARMUP = 50;

/**
 * Regression floor in milliseconds. The T-Lisp eval workload is size-
 * independent, so a single floor covers all three sizes. Sized to the
 * baseline measured during this chore (first-load JIT can push small to
 * ~360ms; subsequent sizes ~90–130ms), rounded up to absorb CI variance.
 */
const FLOOR_MS = 500;

/**
 * Representative small command. `setq` is an eager builtin; the quoted
 * variable name keeps the form simple. `(+ 1 1)` exercises arithmetic +
 * the parse pipeline. `progn` returns the second form (`x`) so the result
 * is well-defined and cheap to check.
 */
const COMMAND = '(progn (setq "x" (+ 1 1)) x)';

/** Estimated serialized size of the command, in bytes (input cost per op). */
const BYTES_PER_OP = COMMAND.length;

export function runTLispBench(_size: BenchSize): BenchResult {
  const interp = new TLispInterpreterImpl();

  // Warmup: prime the JIT and the parser internals without recording timings.
  for (let i = 0; i < WARMUP; i++) {
    const r = interp.execute(COMMAND);
    if (Either.isLeft(r)) throw new Error(`warmup execute failed: ${JSON.stringify(r.left)}`);
  }

  const start = Bun.nanoseconds();
  for (let i = 0; i < N; i++) {
    const r = interp.execute(COMMAND);
    if (Either.isLeft(r)) throw new Error(`execute failed at i=${i}: ${JSON.stringify(r.left)}`);
  }
  const end = Bun.nanoseconds();

  const wallNs = end - start;
  const wallMs = wallNs / 1e6;
  const opsPerSec = N / (wallNs / 1e9);

  return assertFloor({
    name: "tlisp",
    size: _size,
    opsPerSec,
    bytesPerOp: BYTES_PER_OP,
    wallMs,
    floorMs: FLOOR_MS,
  });
}
