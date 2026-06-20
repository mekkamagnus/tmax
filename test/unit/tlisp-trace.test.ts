import { describe, expect, test } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("SPEC-009: trace/untrace wired into evaluator", () => {
  test("trace-list returns empty when nothing is traced", () => {
    const interp = new TLispInterpreterImpl();
    const result = interp.execute("(trace-list)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("list");
      expect((result.right.value as any[]).length).toBe(0);
    }
  });

  test("trace registers a function for tracing", () => {
    const interp = new TLispInterpreterImpl();
    interp.execute("(defun my-traced-fn (x) (+ x 1))");
    interp.execute('(trace "my-traced-fn")');

    const list = interp.execute("(trace-list)");
    expect(Either.isRight(list)).toBe(true);
    if (Either.isRight(list)) {
      const items = list.right.value as any[];
      expect(items.length).toBe(1);
    }
  });

  test("calling a traced function records trace entries", () => {
    const interp = new TLispInterpreterImpl();
    interp.execute("(defun my-traced-fn (x) (+ x 1))");
    interp.execute('(trace "my-traced-fn")');

    // Call the traced function
    interp.execute("(my-traced-fn 41)");

    // The trace history should have entries
    const history = interp.getDebugState().getTraceHistory();
    expect(history.length).toBeGreaterThan(0);

    // Should have enter and exit entries
    const entries = history.filter(e => e.functionName === "my-traced-fn");
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some(e => e.direction === "enter")).toBe(true);
    expect(entries.some(e => e.direction === "exit")).toBe(true);
  });

  test("calling an untraced function does not record trace entries", () => {
    const interp = new TLispInterpreterImpl();
    interp.execute("(defun untraced-fn (x) (* x 2))");

    // No trace set
    interp.execute("(untraced-fn 5)");

    const history = interp.getDebugState().getTraceHistory();
    expect(history.length).toBe(0);
  });

  test("untrace removes a function from tracing", () => {
    const interp = new TLispInterpreterImpl();
    interp.execute("(defun my-fn (x) x)");
    interp.execute('(trace "my-fn")');
    interp.execute('(untrace "my-fn")');

    const list = interp.execute("(trace-list)");
    expect(Either.isRight(list)).toBe(true);
    if (Either.isRight(list)) {
      expect((list.right.value as any[]).length).toBe(0);
    }
  });
});
