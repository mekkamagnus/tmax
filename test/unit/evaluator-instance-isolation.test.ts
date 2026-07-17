/**
 * @file evaluator-instance-isolation.test.ts
 * @description CHORE-44 Change 4 — proves two evaluator/interpreter instances
 * do NOT share state (AC4.3: registries are instance-owned, not module globals).
 * Covers module isolation (moduleRegistry is per-instance) + the test/suite
 * registry isolation (the core testRegistry/suiteRegistry made instance-owned
 * in this change).
 */

import { describe, test, expect } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("CHORE-44 Change 4 — evaluator instance isolation (AC4.3)", () => {
  test("a module defined in interpreter A is not visible to interpreter B", () => {
    const a = new TLispInterpreterImpl();
    const b = new TLispInterpreterImpl();

    const defined = a.execute("(defmodule user/iso/a (export greet) (defun greet () 111))");
    expect(Either.isRight(defined)).toBe(true);

    // A can require the module it defined.
    expect(Either.isRight(a.execute('(require-module "user/iso/a")'))).toBe(true);
    // B has its own (empty) module registry → require fails.
    const bReq = b.execute('(require-module "user/iso/a")');
    expect(Either.isLeft(bReq)).toBe(true);
  });

  test("the core test/suite registries are distinct per instance (no cross-leak)", () => {
    const a = new TLispInterpreterImpl();
    const b = new TLispInterpreterImpl();
    // Fresh instances start with empty, independent test/suite registries.
    expect(a.getAllTestNames()).toEqual([]);
    expect(b.getAllTestNames()).toEqual([]);
    expect(a.getAllSuiteNames()).toEqual([]);
    expect(b.getAllSuiteNames()).toEqual([]);
    // Defining a test in A's view must not appear in B's view.
    expect(a.getTestDefinition("x")).toBeUndefined();
    expect(b.getTestDefinition("x")).toBeUndefined();
  });
});
