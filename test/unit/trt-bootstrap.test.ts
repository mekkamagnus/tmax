/**
 * @file trt-bootstrap.test.ts
 * @description Bun tests validating the TS spine of the self-hosted trt framework (SPEC-049).
 *
 * Per the boundary principle, this bun test covers ONLY the TS layer: the bootstrap loader, the
 * bridge builtins, and the pure result store (results.ts). The framework itself (deftest, runner,
 * assertions) is T-Lisp and is tested by test/tlisp/trt-self.test.tlisp. This file does NOT
 * re-test T-Lisp behavior — that would be circular (a bun harness re-asserting what the
 * interpreter does).
 *
 * What this proves:
 *   - loadTrtFramework() brings the framework up (no throw, builtins registered).
 *   - The result store records pass/fail with the right shape.
 *   - toTLispValue / toJson serialize correctly for the AI-observable contract (AC #3).
 *   - The exit-code mapping is correct (AC: 0/1/2).
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createStandaloneInterpreter } from "../../src/tlisp/profiles/standalone.ts";
import { loadTrtFramework } from "../../src/tlisp/trt/bootstrap.ts";
import { resetResultStore, getResultStore, toTLispValue, toJson, runExitCode, passResult, failResult, emptyRunResult } from "../../src/tlisp/trt/results.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("trt bootstrap (TS spine)", () => {
  test("loadTrtFramework loads without error and registers builtins", async () => {
    const interp = createStandaloneInterpreter({ allowShell: true });
    await expect(loadTrtFramework(interp)).resolves.toBe(true);
    // The bridge builtins should now resolve (not be undefined).
    const r = interp.execute("(trt-results-json)") as any;
    expect(r._tag).toBe("Right");
    // Fresh store → valid empty JSON.
    const parsed = JSON.parse(r.right.value);
    expect(parsed.stats.total).toBe(0);
    expect(parsed.tests).toEqual([]);
  });

  test("deftest + trt-run-all record a passing test in the store", async () => {
    const interp = createStandaloneInterpreter({ allowShell: true });
    await loadTrtFramework(interp);
    interp.execute('(deftest "bootstrap-pass" () (should-equal 1 1))');
    interp.execute("(trt-run-all)");
    const r = interp.execute("(trt-results-json)") as any;
    const data = JSON.parse(r.right.value);
    expect(data.stats).toEqual({ passed: 1, failed: 0, total: 1, durationMs: expect.any(Number) });
    expect(data.tests[0].name).toBe("bootstrap-pass");
    expect(data.tests[0].passed).toBe(true);
  });

  test("a failing test is recorded and the run continues", async () => {
    const interp = createStandaloneInterpreter({ allowShell: true });
    await loadTrtFramework(interp);
    interp.execute('(deftest "bp" () (should-equal 1 1))');
    interp.execute('(deftest "bf" () (should-equal 1 2))');
    interp.execute('(deftest "bp2" () (should-be-truthy t))');
    interp.execute("(trt-run-all)");
    const r = interp.execute("(trt-results-json)") as any;
    const data = JSON.parse(r.right.value);
    // All three ran despite the middle failure.
    expect(data.stats.total).toBe(3);
    expect(data.stats.passed).toBe(2);
    expect(data.stats.failed).toBe(1);
    const failed = data.tests.find((t: any) => !t.passed);
    expect(failed.name).toBe("bf");
    expect(failed.error).toContain("should-equal");
  });
});

describe("trt result store (pure)", () => {
  beforeEach(() => resetResultStore());

  test("records pass and fail with correct shape", () => {
    getResultStore().record(passResult("a", 5));
    getResultStore().record(failResult("b", "boom", 3));
    const run = getResultStore().getRunResult();
    expect(run.stats).toEqual({ passed: 1, failed: 1, total: 2, durationMs: 8 });
    expect(run.tests[0]).toEqual({ name: "a", passed: true, durationMs: 5 });
    expect(run.tests[1]).toEqual({ name: "b", passed: false, error: "boom", durationMs: 3 });
  });

  test("toJson produces parseable JSON with stats + tests", () => {
    getResultStore().record(passResult("x", 1));
    const json = toJson(getResultStore().getRunResult());
    const parsed = JSON.parse(json);
    expect(parsed.stats.passed).toBe(1);
    expect(parsed.tests[0].name).toBe("x");
  });

  test("toTLispValue produces a list headed by trt-results", () => {
    getResultStore().record(passResult("x", 1));
    const v = toTLispValue(getResultStore().getRunResult());
    expect(v.type).toBe("list");
    const head = (v.value as any[])[0];
    expect(head.type).toBe("symbol");
    expect(head.value).toBe("trt-results");
  });

  test("runExitCode maps correctly: 0 all-pass, 1 any-fail, 2 empty", () => {
    expect(runExitCode(emptyRunResult())).toBe(2);
    const passRun = { stats: { passed: 2, failed: 0, total: 2, durationMs: 0 }, tests: [] };
    expect(runExitCode(passRun)).toBe(0);
    const failRun = { stats: { passed: 1, failed: 1, total: 2, durationMs: 0 }, tests: [] };
    expect(runExitCode(failRun)).toBe(1);
  });
});
