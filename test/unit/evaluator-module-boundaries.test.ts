/**
 * @file evaluator-module-boundaries.test.ts
 * @description CHORE-44 Change 4 AC4.7 — static boundary test proving
 * `TLispEvaluator` in `src/tlisp/evaluator.ts` is now a thin facade +
 * trampoline owner rather than the home of module/test/function-call
 * IMPLEMENTATION bodies.
 *
 * The extracted modules:
 *   - `src/tlisp/evaluator/module-forms.ts`  — provide/require/featurep/
 *     current-module/defmodule/require-module + loadModuleFromDisk.
 *   - `src/tlisp/evaluator/test-forms.ts`    — deftest/deftest-async/
 *     deftest-suite/suite-setup/suite-teardown/setup/teardown/deffixture/
 *     use-fixtures.
 *   - `src/tlisp/evaluator/function-calls.ts` — macro expansion detection,
 *     coverage mark, tracing enter/exit helpers.
 *   - `src/tlisp/evaluator/form-shapes.ts`    — pure form-shape validators.
 *   - `src/tlisp/evaluator/special-form-dispatch.ts` — single form classification.
 *
 * The evaluator STILL owns: the trampoline (`TailCall`/`isTailCall`/
 * `createTailCall` + the drive loops in `eval`/`evalAsync`), `evalList`/
 * `evalListAsync` dispatch, `evalFunctionCall`/`evalFunctionCallAsync`
 * orchestration (including tail-call emission), the public `eval`/
 * `evalAsync` methods, and the per-instance state (registries, debug,
 * coverage).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const EVALUATOR_PATH = require("path").resolve(__dirname, "../../src/tlisp/evaluator.ts");
const evaluatorSource = readFileSync(EVALUATOR_PATH, "utf8");

describe("CHORE-44 Change 4 AC4.7 — evaluator.ts is a facade + trampoline owner", () => {
  test("the three handler extraction modules exist", () => {
    for (const file of [
      "src/tlisp/evaluator/module-forms.ts",
      "src/tlisp/evaluator/test-forms.ts",
      "src/tlisp/evaluator/function-calls.ts",
      "src/tlisp/evaluator/form-shapes.ts",
      "src/tlisp/evaluator/special-form-dispatch.ts",
    ]) {
      const path = require("path").resolve(__dirname, "../..", file);
      expect(() => readFileSync(path, "utf8")).not.toThrow();
    }
  });

  test("evaluator.ts imports the extracted handler functions", () => {
    // Module forms.
    expect(evaluatorSource).toContain("evalProvideForm");
    expect(evaluatorSource).toContain("evalFeaturepForm");
    expect(evaluatorSource).toContain("evalRequireForm");
    expect(evaluatorSource).toContain("evalCurrentModuleForm");
    expect(evaluatorSource).toContain("evalDefmoduleForm");
    expect(evaluatorSource).toContain("evalRequireModuleForm");
    // Test forms.
    expect(evaluatorSource).toContain("evalDeftestForm");
    expect(evaluatorSource).toContain("evalDeftestAsyncForm");
    expect(evaluatorSource).toContain("evalDeftestSuiteForm");
    expect(evaluatorSource).toContain("evalDeffixtureForm");
    expect(evaluatorSource).toContain("evalUseFixturesForm");
    // Function-call helpers.
    expect(evaluatorSource).toContain("tryMacroExpansion");
    expect(evaluatorSource).toContain("markFunctionCoverage");
    expect(evaluatorSource).toContain("traceEnter");
    expect(evaluatorSource).toContain("traceExit");
  });

  test("evaluator.ts no longer contains the provide/require handler IMPLEMENTATION bodies", () => {
    // The provide/require/featurep handlers were inline blocks that
    // called `this.moduleRegistry.provideFeature(feature)` directly. After
    // extraction, the evaluator just delegates — the implementation
    // (provideFeature call + the "Required feature not available" error
    // construction) lives in module-forms.ts.
    //
    // Assert the inline body markers are gone from evaluator.ts while the
    // delegation calls are present.
    expect(evaluatorSource).not.toMatch(/this\.moduleRegistry\.provideFeature/);
    expect(evaluatorSource).not.toMatch(/Required feature not available/);
  });

  test("evaluator.ts no longer contains the defmodule body (register/setLoading calls)", () => {
    // The defmodule handler used to call `this.moduleRegistry.setLoading`
    // and `this.moduleRegistry.register` inline. After extraction those
    // calls live only in module-forms.ts.
    expect(evaluatorSource).not.toMatch(/this\.moduleRegistry\.setLoading/);
    expect(evaluatorSource).not.toMatch(/this\._moduleRegistry\.setLoading/);
  });

  test("evaluator.ts no longer contains the require-module body (Circular module dependency)", () => {
    expect(evaluatorSource).not.toMatch(/Circular module dependency detected/);
  });

  test("evaluator.ts no longer contains the deftest handler implementation", () => {
    // The deftest handler body had `this.testRegistry.set(testName, ...)`
    // inline. After extraction the evaluator only delegates; the
    // testRegistry mutation lives in test-forms.ts and is reached via
    // the TestFormsContext interface.
    //
    // The evaluator still has the getter `get testRegistry()` (returning
    // this._testRegistry) so we cannot simply assert no occurrence of the
    // symbol. Instead, assert no `.set(` call on testRegistry lives in
    // evaluator.ts (the write happens in the extracted module).
    expect(evaluatorSource).not.toMatch(/this\._?testRegistry\.set\(/);
    expect(evaluatorSource).not.toMatch(/this\._?suiteRegistry\.set\(/);
  });

  test("evaluator.ts no longer contains the deffixture/use-fixtures implementation", () => {
    // These handlers wrote to `(globalThis as any).__deffixture_data__`.
    // After extraction, that write lives only in test-forms.ts.
    expect(evaluatorSource).not.toMatch(/__deffixture_data__/);
  });

  test("evaluator.ts still owns the trampoline (TailCall + isTailCall + createTailCall)", () => {
    expect(evaluatorSource).toMatch(/interface TailCall/);
    expect(evaluatorSource).toMatch(/function isTailCall/);
    expect(evaluatorSource).toMatch(/function createTailCall/);
    // The trampoline drive loop is in eval().
    expect(evaluatorSource).toMatch(/while \(isTailCall\(currentResult\)\)/);
  });

  test("evaluator.ts still owns evalList / evalListAsync / evalFunctionCall dispatch", () => {
    expect(evaluatorSource).toMatch(/private evalList\(/);
    expect(evaluatorSource).toMatch(/private async evalListAsync\(/);
    expect(evaluatorSource).toMatch(/private evalFunctionCall\(/);
    expect(evaluatorSource).toMatch(/private async evalFunctionCallAsync\(/);
  });

  test("evaluator.ts still owns the public eval/evalAsync entry points", () => {
    expect(evaluatorSource).toMatch(/eval\(expr: TLispValue, env: TLispEnvironment\)/);
    expect(evaluatorSource).toMatch(/async evalAsync\(/);
  });

  test("AC4.2: evaluator.ts consults the single classification table (no local SPECIAL_FORMS set)", () => {
    // Before AC4.2, evaluator.ts declared its own `const SPECIAL_FORMS:
    // ReadonlySet<string> = new Set([...])`. After AC4.2, the table lives
    // in special-form-dispatch.ts and the evaluator imports `classifyForm`
    // and `isSpecialForm`.
    expect(evaluatorSource).not.toMatch(/const SPECIAL_FORMS\s*[:=]/);
    expect(evaluatorSource).toContain("classifyForm");
    expect(evaluatorSource).toContain("isSpecialForm");
  });

  test("AC4.8: evaluator.ts holds a per-instance CoverageState (not a module-global)", () => {
    expect(evaluatorSource).toMatch(/readonly coverage: CoverageState/);
    // And no longer imports the module-level coverage mutators.
    expect(evaluatorSource).not.toMatch(/from ["']\.\/test-coverage\.ts["']/);
  });
});
