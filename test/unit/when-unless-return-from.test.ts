/**
 * @file when-unless-return-from.test.ts
 * @description BUG-32 — three missing control-flow special forms. Pins
 * behavior on both sync `execute()` and async `executeAsync()` paths.
 */
import { describe, test, expect } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";
import type { TLispValue, EvalError } from "../../src/tlisp/types.ts";

/** Extract the `.value` from a successful eval; throw the Left message if failed. */
function val(r: Either<EvalError, TLispValue>): unknown {
  if (Either.isLeft(r)) throw new Error(`eval failed: ${r.left.message}`);
  return (r.right as { value: unknown }).value;
}

/** The type tag of a successful eval result (e.g. "nil", "number"). Throws on Left. */
function rightType(r: Either<EvalError, TLispValue>): string {
  if (Either.isLeft(r)) throw new Error(`eval failed: ${r.left.message}`);
  return (r.right as { type: string }).type;
}

describe("BUG-32 — when/unless/return-from special forms", () => {
  describe("when", () => {
    test("truthy -> body value (sync + async)", async () => {
      expect(val(new TLispInterpreterImpl().execute("(when t 1)"))).toBe(1);
      expect(val(await new TLispInterpreterImpl().executeAsync("(when t 1)"))).toBe(1);
    });
    test("falsy -> nil (sync + async)", async () => {
      expect(rightType(new TLispInterpreterImpl().execute("(when nil 1)"))).toBe("nil");
      expect(rightType(await new TLispInterpreterImpl().executeAsync("(when nil 1)"))).toBe("nil");
    });
    test("multi-form body returns last; body not evaluated when falsy", () => {
      const i = new TLispInterpreterImpl();
      expect(val(i.execute("(when t 1 2 3)"))).toBe(3);
      // falsy: body with an undefined symbol must NOT error (proves no eager eval)
      expect(Either.isRight(i.execute("(when nil undefined-symbol-xyz)"))).toBe(true);
    });
    test("condition is evaluated", () => {
      expect(val(new TLispInterpreterImpl().execute("(when (> 3 2) 7)"))).toBe(7);
    });
  });

  describe("unless", () => {
    test("falsy -> body value (sync + async)", async () => {
      expect(val(new TLispInterpreterImpl().execute("(unless nil 1)"))).toBe(1);
      expect(val(await new TLispInterpreterImpl().executeAsync("(unless nil 1)"))).toBe(1);
    });
    test("truthy -> nil", () => {
      expect(rightType(new TLispInterpreterImpl().execute("(unless t 1)"))).toBe("nil");
    });
    test("multi-form body returns last", () => {
      expect(val(new TLispInterpreterImpl().execute("(unless nil 1 2 3)"))).toBe(3);
    });
  });

  describe("return-from", () => {
    test("early exit with value; body after return-from not evaluated", () => {
      expect(val(new TLispInterpreterImpl().execute("(progn (defun f () (return-from f 9) 1) (f))"))).toBe(9);
    });
    test("default value is nil when omitted", () => {
      const i = new TLispInterpreterImpl();
      i.execute("(defun g () (return-from g))");
      expect(rightType(i.execute("(g)"))).toBe("nil");
    });
    test("exits from inside dolist (nonlocal through a loop)", () => {
      const src = "(progn (defun first-over (xs) (dolist (x xs) (when (> x 3) (return-from first-over x)))) (first-over (quote (1 2 5 9))))";
      expect(val(new TLispInterpreterImpl().execute(src))).toBe(5);
    });
    test("sync + async agree on early-exit value", async () => {
      const src = "(progn (defun f () (return-from f 42) 1) (f))";
      expect(val(new TLispInterpreterImpl().execute(src))).toBe(42);
      expect(val(await new TLispInterpreterImpl().executeAsync(src))).toBe(42);
    });
    test("top-level return-from is a clean error, not a crash (sync + async)", async () => {
      const sync = new TLispInterpreterImpl().execute("(return-from no-such 1)");
      expect(Either.isLeft(sync)).toBe(true);
      if (Either.isLeft(sync)) expect(sync.left.message).toMatch(/no enclosing function/);
      const asyncR = await new TLispInterpreterImpl().executeAsync("(return-from no-such 1)");
      expect(Either.isLeft(asyncR)).toBe(true);
      if (Either.isLeft(asyncR)) expect(asyncR.left.message).toMatch(/no enclosing function/);
    });
  });

  describe("forms are no longer 'Undefined symbol'", () => {
    test("when/unless/return-from are recognized special forms", () => {
      for (const src of ["(when t 1)", "(unless nil 1)", "(progn (defun f () (return-from f 0)) (f))"]) {
        const r = new TLispInterpreterImpl().execute(src);
        if (Either.isLeft(r)) {
          expect(r.left.message).not.toMatch(/Undefined symbol: (when|unless|return-from)/);
        }
      }
    });
  });
});
