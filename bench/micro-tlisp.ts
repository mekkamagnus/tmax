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
 * independent, so a single floor covers all three sizes. Re-baselined
 * 2026-08-15 (CHORE-85/#188): the original 500ms floor was set on a faster
 * machine; on this host (2017 i7-7920HQ, esp. under sustained load) the same
 * code measures 626–1113ms (3× idle runs; also FAILS at the commits where it
 * previously passed — machine drift, not a code regression; the 50M-iteration
 * JS calibration loop runs ~3–5× slower than modern silicon). New floor:
 * ~1.5× the observed worst idle run, still tight enough to catch a real
 * interpreter regression.
 */
const FLOOR_MS = 1_400;

/**
 * Representative small command. `defvar` binds `x`, then `setq` mutates it
 * (setq is a special form / alias of set!, so the name is an unevaluated
 * symbol — BUG-31). `(+ 1 1)` exercises arithmetic + the parse pipeline.
 * `progn` returns the second form (`x`) so the result is well-defined and
 * cheap to check.
 */
const COMMAND = '(progn (defvar x 0) (setq x (+ 1 1)) x)';

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
