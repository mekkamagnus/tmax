import { describe, expect, test } from "bun:test";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";
import { Either } from "../../src/utils/task-either.ts";
import { expectTlispString } from "../helpers/editor-fixture.ts";

describe("SPEC-003/SPEC-007: truthful provide/featurep/require", () => {
  test("provide registers a feature and returns the feature name", () => {
    const interpreter = new TLispInterpreterImpl();
    const result = interpreter.execute('(provide "my-feature")');
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(expectTlispString(result.right)).toBe("my-feature");
    }
  });

  test("featurep returns nil for an unprovided feature", () => {
    const interpreter = new TLispInterpreterImpl();
    const result = interpreter.execute('(featurep "nonexistent")');
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("nil");
    }
  });

  test("featurep returns t after provide", () => {
    const interpreter = new TLispInterpreterImpl();
    interpreter.execute('(provide "provided-feature")');
    const result = interpreter.execute('(featurep "provided-feature")');
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("boolean");
      expect(result.right.value).toBe(true);
    }
  });

  test("featurep returns nil for a feature that was not provided", () => {
    const interpreter = new TLispInterpreterImpl();
    interpreter.execute('(provide "feature-a")');
    const result = interpreter.execute('(featurep "feature-b")');
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("nil");
    }
  });

  test("require returns nil when feature is already provided", () => {
    const interpreter = new TLispInterpreterImpl();
    interpreter.execute('(provide "already-here")');
    const result = interpreter.execute('(require "already-here")');
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.type).toBe("nil");
    }
  });

  test("require returns error when feature is not available", () => {
    const interpreter = new TLispInterpreterImpl();
    const result = interpreter.execute('(require "missing-feature")');
    expect(Either.isLeft(result)).toBe(true);
  });

  test("multiple provides are tracked independently", () => {
    const interpreter = new TLispInterpreterImpl();
    interpreter.execute('(provide "feat-1")');
    interpreter.execute('(provide "feat-2")');

    expect(Either.isRight(interpreter.execute('(featurep "feat-1")'))).toBe(true);
    expect(Either.isRight(interpreter.execute('(featurep "feat-2")'))).toBe(true);

    const f1 = interpreter.execute('(featurep "feat-1")');
    if (Either.isRight(f1)) expect(f1.right.value).toBe(true);

    const f2 = interpreter.execute('(featurep "feat-2")');
    if (Either.isRight(f2)) expect(f2.right.value).toBe(true);
  });
});
