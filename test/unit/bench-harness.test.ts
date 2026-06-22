/**
 * @file bench-harness.test.ts
 * @description Unit tests for the pure pieces of the bench harness.
 *
 * Verifies that the buffer and T-Lisp microbenchmarks return well-formed
 * `BenchResult` objects, and that the floor/summarize/format helpers behave.
 * Does NOT start a real daemon — `runE2EBench` is intentionally excluded; its
 * live path is covered by `bun run bench`.
 *
 * Absolute timings are deliberately not asserted here — those vary by machine
 * and belong in the harness floors, not the unit test.
 */
import { describe, test, expect } from "bun:test";
import { runBufferBench } from "../../bench/micro-buffer.ts";
import { runTLispBench } from "../../bench/micro-tlisp.ts";
import {
  assertFloor,
  formatResults,
  summarize,
  type BenchResult,
} from "../../bench/output.ts";

function isFinitePositive(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function isFiniteNonNegative(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

describe("bench-harness output helpers", () => {
  test("assertFloor marks slow injected result as failed", () => {
    const slow = assertFloor({
      name: "fake",
      size: "small",
      opsPerSec: 10,
      bytesPerOp: 8,
      wallMs: 500,
      floorMs: 100,
    });
    expect(slow.passed).toBe(false);
  });

  test("assertFloor marks fast injected result as passed", () => {
    const fast = assertFloor({
      name: "fake",
      size: "small",
      opsPerSec: 10_000,
      bytesPerOp: 8,
      wallMs: 10,
      floorMs: 100,
    });
    expect(fast.passed).toBe(true);
  });

  test("summarize counts pass/fail across a mixed set", () => {
    const r1: BenchResult = {
      name: "x", size: "small", opsPerSec: 1, bytesPerOp: 1, wallMs: 1, floorMs: 10, passed: true,
    };
    const r2: BenchResult = {
      name: "x", size: "medium", opsPerSec: 1, bytesPerOp: 1, wallMs: 100, floorMs: 10, passed: false,
    };
    const r3: BenchResult = {
      name: "x", size: "large", opsPerSec: 1, bytesPerOp: 1, wallMs: 1, floorMs: 10, passed: true,
    };
    expect(summarize([r1, r2, r3])).toEqual({ passed: 2, failed: 1 });
  });

  test("formatResults renders a non-empty table containing name + size", () => {
    const r: BenchResult = {
      name: "buffer", size: "medium", opsPerSec: 1234, bytesPerOp: 200, wallMs: 5, floorMs: 100, passed: true,
    };
    const out = formatResults([r]);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("buffer");
    expect(out).toContain("medium");
    expect(out).toContain("PASS");
  });
});

describe("bench-harness microbenchmarks return well-formed results", () => {
  test("runBufferBench returns a well-formed BenchResult for the small fixture", async () => {
    const r = await runBufferBench("small");
    expect(r.name).toBe("buffer");
    expect(r.size).toBe("small");
    expect(isFinitePositive(r.opsPerSec)).toBe(true);
    expect(isFiniteNonNegative(r.bytesPerOp)).toBe(true);
    expect(isFiniteNonNegative(r.wallMs)).toBe(true);
    expect(isFinitePositive(r.floorMs)).toBe(true);
    expect(typeof r.passed).toBe("boolean");
  });

  test("runTLispBench returns a well-formed BenchResult", () => {
    const r = runTLispBench("small");
    expect(r.name).toBe("tlisp");
    expect(r.size).toBe("small");
    expect(isFinitePositive(r.opsPerSec)).toBe(true);
    expect(isFinitePositive(r.bytesPerOp)).toBe(true);
    expect(isFiniteNonNegative(r.wallMs)).toBe(true);
    expect(isFinitePositive(r.floorMs)).toBe(true);
    expect(typeof r.passed).toBe("boolean");
  });
});
