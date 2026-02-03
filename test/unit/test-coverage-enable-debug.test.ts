import { test, expect } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { registerTestingFramework } from "../../src/tlisp/test-framework.ts";
import { resetCoverageState, setCoverageEnabled, isCoverageEnabled } from "../../src/tlisp/test-coverage.ts";

test("debug coverage-enable", () => {
  resetCoverageState();
  setCoverageEnabled(true);
  console.log("Before execute - coverage enabled:", isCoverageEnabled());

  const interpreter = new TLispInterpreterImpl();
  registerTestingFramework(interpreter);

  console.log("After interpreter create - coverage enabled:", isCoverageEnabled());

  interpreter.execute("(coverage-enable false)");
  console.log("After coverage-enable false - coverage enabled:", isCoverageEnabled());

  expect(isCoverageEnabled()).toBe(false);
});
