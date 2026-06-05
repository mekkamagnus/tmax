import { describe, expect, test } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";

const execute = (interpreter: TLispInterpreterImpl, source: string) => {
  const result = interpreter.execute(source);
  if (Either.isLeft(result)) throw new Error(result.left.message);
  return result.right;
};

describe("T-Lisp completion runtime primitives", () => {
  test("supports dynamic calls and list transforms", () => {
    const interpreter = new TLispInterpreterImpl();

    expect(execute(interpreter, "(funcall '+ 1 2 3)").value).toBe(6);
    expect(execute(interpreter, "(apply '+ '(1 2 3))").value).toBe(6);
    expect(execute(interpreter, "(mapcar (lambda (x) (* x 2)) '(1 2 3))").value).toEqual([
      { type: "number", value: 2 },
      { type: "number", value: 4 },
      { type: "number", value: 6 },
    ]);
    expect(execute(interpreter, "(filter (lambda (x) (> x 1)) '(1 2 3))").value).toEqual([
      { type: "number", value: 2 },
      { type: "number", value: 3 },
    ]);
  });

  test("provides domain-neutral string spans and list slicing", () => {
    const interpreter = new TLispInterpreterImpl();

    expect(execute(interpreter, '(string-match-spans "buf" "buffer-buffer" false)').value).toEqual([
      { type: "list", value: [{ type: "number", value: 0 }, { type: "number", value: 3 }] },
      { type: "list", value: [{ type: "number", value: 7 }, { type: "number", value: 10 }] },
    ]);
    expect(execute(interpreter, "(list-slice '(1 2 3 4) 1 3)").value).toEqual([
      { type: "number", value: 2 },
      { type: "number", value: 3 },
    ]);
  });
});
