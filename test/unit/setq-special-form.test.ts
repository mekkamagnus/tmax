/**
 * @file setq-special-form.test.ts
 * @description BUG-31 — `setq` is a special form (alias of `set!`): the name
 * argument is an UNEVALUATED symbol. Pins accumulator + ghost-binding semantics
 * on both the sync `execute()` and async `executeAsync()` paths so the old
 * eager-builtin regression cannot return.
 */
import { describe, test, expect } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";
import type { TLispValue, EvalError } from "../../src/tlisp/types.ts";

/** Extract the `.value` from a successful eval; throw the Left message if it failed. */
function val(r: Either<EvalError, TLispValue>): unknown {
  if (Either.isLeft(r)) {
    throw new Error(`eval failed: ${(r.left as EvalError).message}`);
  }
  return (r.right as { value: unknown }).value;
}

describe("BUG-31 — setq is a special form (alias of set!, name not evaluated)", () => {
  test("defvar + setq accumulator increments (sync)", () => {
    const i = new TLispInterpreterImpl();
    expect(val(i.execute("(progn (defvar counter 0) (setq counter (+ counter 1)) counter)"))).toBe(1);
  });

  test("defvar + setq accumulator increments (async)", async () => {
    const i = new TLispInterpreterImpl();
    expect(val(await i.executeAsync("(progn (defvar counter 0) (setq counter (+ counter 1)) counter)"))).toBe(1);
  });

  test("let-bound dolist accumulator returns 10 (sync)", () => {
    const i = new TLispInterpreterImpl();
    expect(val(i.execute("(let ((acc 0)) (dolist (x (list 1 2 3 4)) (setq acc (+ acc x))) acc)"))).toBe(10);
  });

  test("let-bound dolist accumulator returns 10 (async)", async () => {
    const i = new TLispInterpreterImpl();
    expect(val(await i.executeAsync("(let ((acc 0)) (dolist (x (list 1 2 3 4)) (setq acc (+ acc x))) acc)"))).toBe(10);
  });

  test("no ghost binding: setq on a string-valued var updates it and creates no var named after the old value", () => {
    const i = new TLispInterpreterImpl();
    expect(Either.isRight(i.execute('(defvar s "hello")'))).toBe(true);
    expect(val(i.execute('(setq s "world")'))).toBe("world");
    // The old eager builtin would have created a variable literally named "hello".
    expect(i.globalEnv.lookup("hello")).toBeUndefined();
    // The actual variable was updated.
    expect((i.globalEnv.lookup("s") as { value: unknown } | undefined)?.value).toBe("world");
  });

  test("a string name is rejected — name must be a symbol (sync + async)", async () => {
    const sync = new TLispInterpreterImpl();
    const syncR = sync.execute('(setq "x" 1)');
    expect(Either.isLeft(syncR)).toBe(true);
    if (Either.isLeft(syncR)) {
      expect(syncR.left.message).toMatch(/symbol/i);
    }

    const async_ = new TLispInterpreterImpl();
    const asyncR = await async_.executeAsync('(setq "x" 1)');
    expect(Either.isLeft(asyncR)).toBe(true);
    if (Either.isLeft(asyncR)) {
      expect(asyncR.left.message).toMatch(/symbol/i);
    }
  });

  test("setq and set! mutate the same binding (alias semantics)", () => {
    const i = new TLispInterpreterImpl();
    i.execute("(defvar v 1)");
    i.execute("(setq v 10)");
    expect((i.globalEnv.lookup("v") as { value: unknown } | undefined)?.value).toBe(10);
    i.execute("(set! v 20)");
    expect((i.globalEnv.lookup("v") as { value: unknown } | undefined)?.value).toBe(20);
  });

  test("while loop with setq counter terminates at expected value", () => {
    const i = new TLispInterpreterImpl();
    // (defvar n 0) (defvar i 0) (while (< i 5) (setq n (+ n i)) (setq i (+ i 1))) n  => 0+1+2+3+4 = 10
    expect(val(i.execute("(progn (defvar n 0) (defvar i 0) (while (< i 5) (setq n (+ n i)) (setq i (+ i 1))) n)"))).toBe(10);
  });
});
