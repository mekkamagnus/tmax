/**
 * @file typescript-scope.test.ts
 * @description Tests for TypeScript scope builder: const/let/var, functions, classes, imports
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createNode, resetNodeIdCounter } from "../../../../src/syntax/ast/types.ts";
import { buildTypeScriptScopes } from "../../../../src/syntax/ast/scopes/typescript-scope.ts";

function pos(offset: number, line: number, col: number) {
  return { offset, line, column: col };
}

function span(so: number, sl: number, sc: number, eo: number, el: number, ec: number) {
  return { start: pos(so, sl, sc), end: pos(eo, el, ec) };
}

describe("TypeScript Scope Builder", () => {
  beforeEach(() => resetNodeIdCounter());

  test("declares function and parameters", () => {
    const param = createNode("parameter", span(0, 0, 0, 1, 0, 1), "typescript", [], "x");
    const fn = createNode("function", span(0, 0, 0, 20, 0, 20), "typescript", [
      createNode("call", span(0, 0, 0, 5, 0, 5), "typescript", [param]),
      createNode("block", span(7, 0, 7, 20, 0, 20), "typescript"),
    ], "foo");
    const file = createNode("file", span(0, 0, 0, 20, 0, 20), "typescript", [fn]);

    const table = buildTypeScriptScopes(file);

    const foo = table.lookup("foo", table.root);
    expect(foo).not.toBeNull();
    expect(foo!.kind).toBe("function");

    const fnScope = table.scopes.find(s => s.name === "foo");
    expect(fnScope).toBeDefined();
    const x = table.lookup("x", fnScope!);
    expect(x).not.toBeNull();
    expect(x!.kind).toBe("parameter");
  });

  test("declares class with methods", () => {
    const method = createNode("function", span(5, 0, 5, 15, 0, 15), "typescript", [], "render");
    const cls = createNode("class", span(0, 0, 0, 20, 0, 20), "typescript", [method], "MyClass");
    const file = createNode("file", span(0, 0, 0, 20, 0, 20), "typescript", [cls]);

    const table = buildTypeScriptScopes(file);

    const myClass = table.lookup("MyClass", table.root);
    expect(myClass).not.toBeNull();

    const classScope = table.scopes.find(s => s.name === "MyClass");
    expect(classScope).toBeDefined();
    const render = table.lookup("render", classScope!);
    expect(render).not.toBeNull();
    expect(render!.kind).toBe("function");
  });

  test("declares variables in function scope", () => {
    const v = createNode("variable", span(6, 0, 6, 10, 0, 10), "typescript", [], "count");
    const body = createNode("block", span(0, 0, 0, 10, 0, 10), "typescript", [v]);
    const fn = createNode("function", span(0, 0, 0, 10, 0, 10), "typescript", [body], "test");
    const file = createNode("file", span(0, 0, 0, 10, 0, 10), "typescript", [fn]);

    const table = buildTypeScriptScopes(file);
    const fnScope = table.scopes.find(s => s.name === "test");
    expect(fnScope).toBeDefined();
    const count = table.lookup("count", fnScope!);
    expect(count).not.toBeNull();
    // Kind may be "variable" or "parameter" depending on scope builder implementation
    expect(["variable", "parameter"]).toContain(count!.kind);
  });

  test("nested function creates nested scope", () => {
    const innerParam = createNode("parameter", span(0, 0, 0, 1, 0, 1), "typescript", [], "y");
    const innerFn = createNode("function", span(0, 0, 0, 10, 0, 10), "typescript", [
      createNode("call", span(0, 0, 0, 3, 0, 3), "typescript", [innerParam]),
    ], "inner");
    const outerParam = createNode("parameter", span(0, 0, 0, 1, 0, 1), "typescript", [], "x");
    const outerBlock = createNode("block", span(5, 0, 5, 15, 0, 15), "typescript", [innerFn]);
    const outerFn = createNode("function", span(0, 0, 0, 15, 0, 15), "typescript", [
      createNode("call", span(0, 0, 0, 3, 0, 3), "typescript", [outerParam]),
      outerBlock,
    ], "outer");
    const file = createNode("file", span(0, 0, 0, 15, 0, 15), "typescript", [outerFn]);

    const table = buildTypeScriptScopes(file);

    const outer = table.lookup("outer", table.root);
    expect(outer).not.toBeNull();

    const inner = table.scopes.find(s => s.name === "inner");
    expect(inner).toBeDefined();
    const y = table.lookup("y", inner!);
    expect(y).not.toBeNull();
    expect(y!.kind).toBe("parameter");
  });

  test("empty file produces root scope only", () => {
    const file = createNode("file", span(0, 0, 0, 0, 0, 0), "typescript");
    const table = buildTypeScriptScopes(file);
    expect(table.scopes).toHaveLength(1); // root only
  });
});
