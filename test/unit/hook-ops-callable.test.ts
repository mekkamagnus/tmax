/**
 * @file hook-ops-callable.test.ts
 * @description Unit tests for callable hooks and append ordering
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createHookOps, type HookRegistry } from "../../src/editor/api/hook-ops.ts";
import type { TLispValue } from "../../src/tlisp/types.ts";
import { createString, createNil, createBoolean, createFunction, createSymbol } from "../../src/tlisp/values.ts";
import { Either } from "../../src/utils/task-either.ts";

describe("Hook Operations", () => {
  let hooks: HookRegistry;
  let executedFunctions: string[];
  let api: Map<string, any>;

  beforeEach(() => {
    hooks = new Map();
    executedFunctions = [];

    const evalFunction = (name: string) => {
      executedFunctions.push(name);
      return Either.right(createNil());
    };

    api = createHookOps(hooks, evalFunction);
  });

  const call = (name: string, ...args: TLispValue[]) => {
    const fn = api.get(name);
    if (!fn) throw new Error(`Function not found: ${name}`);
    return fn(args);
  };

  test("add-hook adds a string function name", () => {
    call("add-hook", createString("test-hook"), createString("my-fn"));
    const list = hooks.get("test-hook");
    expect(list).toBeDefined();
    expect(list!.length).toBe(1);
    expect(list![0]).toBe("my-fn");
  });

  test("add-hook prepends by default", () => {
    call("add-hook", createString("test-hook"), createString("fn-a"));
    call("add-hook", createString("test-hook"), createString("fn-b"));

    const list = hooks.get("test-hook");
    expect(list![0]).toBe("fn-b");  // prepended
    expect(list![1]).toBe("fn-a");
  });

  test("add-hook appends with t argument", () => {
    call("add-hook", createString("test-hook"), createString("first"));
    call("add-hook", createString("test-hook"), createString("second"), createBoolean(true));

    const list = hooks.get("test-hook");
    expect(list![0]).toBe("first");
    expect(list![1]).toBe("second");
  });

  test("run-hooks executes all hook functions in order", () => {
    call("add-hook", createString("test-hook"), createString("fn-a"));
    call("add-hook", createString("test-hook"), createString("fn-b"));

    const list = hooks.get("test-hook");
    expect(list!.length).toBe(2);

    call("run-hooks", createString("test-hook"));
    // fn-b prepended before fn-a, so execution order is: fn-b, fn-a
    expect(executedFunctions).toEqual(["fn-b", "fn-a"]);
  });

  test("run-hooks executes callable function entries", () => {
    const callable = createFunction(() => {
      executedFunctions.push("lambda");
      return Either.right(createNil());
    });

    call("add-hook", createString("test-hook"), callable);
    call("run-hooks", createString("test-hook"));

    expect(executedFunctions).toEqual(["lambda"]);
  });

  test("run-hooks executes symbol entries through evaluator callback", () => {
    call("add-hook", createString("test-hook"), createSymbol("symbol-hook"));
    call("run-hooks", createString("test-hook"));

    expect(executedFunctions).toEqual(["symbol-hook"]);
  });

  test("run-hooks on nonexistent hook returns nil without error", () => {
    const result = call("run-hooks", createString("no-such-hook"));
    expect(Either.isRight(result)).toBe(true);
  });

  test("remove-hook removes a function from the hook", () => {
    call("add-hook", createString("test-hook"), createString("fn-a"));
    call("add-hook", createString("test-hook"), createString("fn-b"));

    call("remove-hook", createString("test-hook"), createString("fn-a"));
    const list = hooks.get("test-hook");
    expect(list!.length).toBe(1);
    expect(list![0]).toBe("fn-b");
  });

  test("remove-hook removes callable entries by reference", () => {
    const callable = createFunction(() => Either.right(createNil()));
    call("add-hook", createString("test-hook"), callable);

    call("remove-hook", createString("test-hook"), callable);

    expect(hooks.get("test-hook")).toEqual([]);
  });

  test("hook-list returns all functions in the hook", () => {
    call("add-hook", createString("test-hook"), createString("fn-a"));
    call("add-hook", createString("test-hook"), createString("fn-b"));

    const result = call("hook-list", createString("test-hook"));
    const names = result.right.value.map((v: TLispValue) => v.value);
    expect(names).toEqual(["fn-b", "fn-a"]);
  });

  test("hook-list returns inspectable names for callable entries", () => {
    const callable = createFunction(() => Either.right(createNil()));
    call("add-hook", createString("test-hook"), callable);
    call("add-hook", createString("test-hook"), createSymbol("symbol-hook"), createBoolean(true));

    const result = call("hook-list", createString("test-hook"));
    const names = result.right.value.map((v: TLispValue) => v.value);

    expect(names).toEqual(["#<lambda>", "symbol-hook"]);
  });

  test("hook-list returns nil for nonexistent hook", () => {
    const result = call("hook-list", createString("no-such-hook"));
    expect(result.right.type).toBe("nil");
  });
});
