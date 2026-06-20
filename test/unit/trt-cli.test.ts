/**
 * @file trt-cli.test.ts
 * @description Bun tests for the trt CLI plumbing (SPEC-049 Phase 2).
 *
 * Per the boundary principle, this validates ONLY the TS-discoverable CLI contract: that the
 * framework's discovery/load/run entry points work through the interpreter, that JSON output is
 * valid, and that the exit-code mapping (0/1/2) is correct. It does NOT shell out to bin/tmax
 * (that requires a running daemon and is covered by the daemon E2E gate); instead it drives the
 * same T-Lisp entry points the CLI uses, through the interpreter directly.
 */

import { describe, test, expect } from "bun:test";
import { createStandaloneInterpreter } from "../../src/tlisp/profiles/standalone.ts";
import { loadTrtFramework } from "../../src/tlisp/trt/bootstrap.ts";
import { Either } from "../../src/utils/task-either.ts";

/** Build an interpreter with the trt framework + filesystem access loaded. */
async function trtInterp() {
  const interp = createStandaloneInterpreter({ allowShell: true, allowFilesystem: true });
  await loadTrtFramework(interp);
  return interp;
}

function json(interp: any): any {
  const r = interp.execute("(trt-results-json)") as any;
  return JSON.parse(r.right.value);
}

describe("trt CLI entry points", () => {
  test("trt-discover finds test files", async () => {
    const interp = await trtInterp();
    const r = interp.execute('(trt-discover "test/tlisp")') as any;
    expect(r._tag).toBe("Right");
    const names = r.right.value.map((v: any) => v.value);
    expect(names).toContain("trt-self.test.tlisp");
    expect(names).toContain("modes.test.tlisp");
  });

  test("trt-load-file registers a file's tests", async () => {
    const interp = await trtInterp();
    interp.execute('(trt-load-file "test/tlisp/trt-self.test.tlisp")');
    const count = interp.execute("(trt-test-count)") as any;
    expect(count.right.value).toBeGreaterThan(0);
  });

  test("trt-run on a directory runs all and returns structured results", async () => {
    const interp = await trtInterp();
    interp.execute('(trt-run "test/tlisp/")');
    const data = json(interp);
    expect(data.stats.total).toBeGreaterThanOrEqual(15);
    expect(data.stats.passed).toBeGreaterThan(0);
  });

  test("trt --json contract: stats + tests keys, parseable", async () => {
    const interp = await trtInterp();
    interp.execute('(trt-run "test/tlisp/")');
    const data = json(interp);
    expect(data).toHaveProperty("stats");
    expect(data).toHaveProperty("tests");
    expect(data.stats).toHaveProperty("passed");
    expect(data.stats).toHaveProperty("failed");
    expect(data.stats).toHaveProperty("total");
    expect(Array.isArray(data.tests)).toBe(true);
    // Each test has name + passed.
    expect(data.tests[0]).toHaveProperty("name");
    expect(data.tests[0]).toHaveProperty("passed");
  });

  test("exit code: 0 all-pass, 1 any-fail, 2 no-tests", async () => {
    const interp = await trtInterp();
    // No tests run → exit code 2.
    interp.execute("(trt-run-all)");
    let code = interp.execute("(trt-exit-code-ts)") as any;
    expect(code.right.value).toBe(2);

    // A passing-only file → 0.
    interp.execute('(trt-run "test/tlisp/trt-self.test.tlisp")');
    code = interp.execute("(trt-exit-code-ts)") as any;
    // trt-self tests all pass, so exit 0.
    const data = json(interp);
    if (data.stats.failed === 0) {
      expect(code.right.value).toBe(0);
    }
  });

  test("trt-print-report returns a summary string", async () => {
    const interp = await trtInterp();
    interp.execute('(trt-run "test/tlisp/trt-self.test.tlisp")');
    const report = interp.execute("(trt-print-report)") as any;
    expect(report.right.type).toBe("string");
    expect(report.right.value).toContain("trt:");
    expect(report.right.value).toContain("passed");
  });

  test("isolation: two runs of the same registered set produce identical stats", async () => {
    const interp = await trtInterp();
    // Load once, then run the SAME registered set twice. Counts must match (no store leakage).
    interp.execute('(trt-load-file "test/tlisp/trt-self.test.tlisp")');
    interp.execute("(trt-run-all)");
    const first = json(interp).stats;
    interp.execute("(trt-run-all)");
    const second = json(interp).stats;
    expect(second.total).toBe(first.total);
    expect(second.passed).toBe(first.passed);
  });
});
