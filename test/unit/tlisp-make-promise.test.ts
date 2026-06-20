import { describe, expect, test } from "bun:test";
import { createStartedEditor, expectRight } from "../helpers/editor-fixture.ts";
import { Either } from "../../src/utils/task-either.ts";

async function executeEditorAsync(source: string) {
  const editor = await createStartedEditor();
  const result = await editor.getInterpreter().executeAsync!(source);
  return { editor, result };
}

// RFC-018 Step 1.4 — make-promise: produces a T-Lisp promise from a zero-arg
// thunk. It is the inverse of the consumer surface (promise-value/promise-then)
// and lets user T-Lisp code introduce an async computation.
//
// IMPORTANT semantics (verified against evaluator.ts:2419/2426): the async
// evaluator auto-unwraps every function-call result via awaitIfPromise. So a
// promise produced by make-promise is resolved at the call boundary and does
// NOT survive as a first-class holdable value. This means make-promise today
// enables DEFERRED ASYNC COMPUTATION (the promise's resolution becomes the
// enclosing expression's value) but does NOT yet enable promises as values
// that can be passed to promise-then in a later step — that requires an
// evaluator change to opt out of auto-unwrap, tracked as a follow-up in
// RFC-018. These tests pin the working behavior.
describe("make-promise (RFC-018 Step 1.4)", () => {
  test("defers and resolves a thunk's value as the enclosing result", async () => {
    const { result } = await executeEditorAsync(
      `(async-let () (make-promise (lambda () (+ 1 2))))`,
    );
    const value = expectRight(result, `T-Lisp failed`);
    expect(value).toEqual({ type: "number", value: 3 });
  });

  test("defers a thunk that wraps an async builtin (shell-exec)", async () => {
    const { result } = await executeEditorAsync(
      `(async-let () (make-promise (lambda () (shell-exec "echo hi"))))`,
    );
    const value = expectRight(result, `T-Lisp failed`);
    // shell-exec returns (stdout stderr exitCode); the first element is "hi\n".
    expect(value).toEqual({
      type: "list",
      value: [
        { type: "string", value: "hi" },
        { type: "string", value: "" },
        { type: "number", value: 0 },
      ],
    });
  });

  test("rejects a non-callable thunk with a TypeError", async () => {
    const { result } = await executeEditorAsync(
      `(async-let () (make-promise 42))`,
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.variant).toBe("TypeError");
      expect(result.left.message).toContain("thunk must be a function");
    }
  });

  test("requires async evaluation context (errors when called sync)", async () => {
    const { result } = await executeEditorAsync(`(make-promise (lambda () 1))`);
    // Outside async-let the asyncMode guard fires before the thunk check.
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("async evaluation");
    }
  });

  test("a thunk that throws surfaces as an EvalError", async () => {
    const { result } = await executeEditorAsync(
      `(async-let () (make-promise (lambda () (error "boom"))))`,
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.type).toBe("EvalError");
    }
  });
});
