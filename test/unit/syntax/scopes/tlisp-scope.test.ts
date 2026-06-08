/**
 * @file tlisp-scope.test.ts
 * @description Tests for T-Lisp scope builder: defun, let, defvar, lambda, scope chain
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createNode, resetNodeIdCounter } from "../../../../src/syntax/ast/types.ts";
import { buildTlispScopes } from "../../../../src/syntax/ast/scopes/tlisp-scope.ts";
import { tlispParser } from "../../../../src/syntax/ast/parsers/tlisp-parser.ts";
import { Either } from "../../../../src/utils/task-either.ts";

function pos(offset: number, line: number, col: number) {
  return { offset, line, column: col };
}

function span(so: number, sl: number, sc: number, eo: number, el: number, ec: number) {
  return { start: pos(so, sl, sc), end: pos(eo, el, ec) };
}

describe("T-Lisp Scope Builder", () => {
  beforeEach(() => resetNodeIdCounter());

  test("defun creates function scope with parameters", () => {
    const result = tlispParser.parse("(defun greet (name) (print name))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);

    const greet = table.lookup("greet", table.root);
    expect(greet).not.toBeNull();
    expect(greet!.kind).toBe("function");

    const fnScope = table.scopes.find(s => s.name === "greet");
    expect(fnScope).toBeDefined();
    const nameSym = table.lookup("name", fnScope!);
    expect(nameSym).not.toBeNull();
    expect(nameSym!.kind).toBe("parameter");
  });

  test("defvar creates variable in root scope", () => {
    const result = tlispParser.parse("(defvar x 42)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const sym = table.lookup("x", table.root);
    expect(sym).not.toBeNull();
    expect(sym!.kind).toBe("variable");
  });

  test("let creates child scope with bindings", () => {
    const result = tlispParser.parse("(let ((a 1) (b 2)) (+ a b))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const letScope = table.scopes.find(s => s.name === "let");
    expect(letScope).toBeDefined();

    const a = table.lookup("a", letScope!);
    expect(a).not.toBeNull();
    expect(a!.kind).toBe("variable");

    const b = table.lookup("b", letScope!);
    expect(b).not.toBeNull();
    expect(b!.kind).toBe("variable");
  });

  test("nested let creates child scope", () => {
    const result = tlispParser.parse("(let ((x 1)) (let ((y 2)) (+ x y)))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const letScopes = table.scopes.filter(s => s.name === "let");
    expect(letScopes.length).toBeGreaterThanOrEqual(2);
  });

  test("multiple defun at top level", () => {
    const source = `
      (defun foo (x) x)
      (defun bar (y) y)
    `;
    const result = tlispParser.parse(source, "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const foo = table.lookup("foo", table.root);
    const bar = table.lookup("bar", table.root);
    expect(foo).not.toBeNull();
    expect(bar).not.toBeNull();
  });

  test("empty source produces root scope only", () => {
    const result = tlispParser.parse("", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    expect(table.scopes.length).toBe(1); // root only
  });

  test("defun with multiple parameters", () => {
    const result = tlispParser.parse("(defun add (a b c) (+ a b c))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const fnScope = table.scopes.find(s => s.name === "add");
    expect(fnScope).toBeDefined();

    const a = table.lookup("a", fnScope!);
    const b = table.lookup("b", fnScope!);
    const c = table.lookup("c", fnScope!);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(a!.kind).toBe("parameter");
    expect(b!.kind).toBe("parameter");
    expect(c!.kind).toBe("parameter");
  });

  test("defconst appears as symbol in root scope", () => {
    const result = tlispParser.parse("(defconst PI 3.14)", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const sym = table.lookup("PI", table.root);
    expect(sym).not.toBeNull();
    expect(sym!.kind).toBe("variable");
  });

  test("defmacro appears as symbol in root scope", () => {
    const result = tlispParser.parse(
      "(defmacro unless (condition &rest body) (list 'if (list 'not condition) (cons 'progn body)))",
      "test",
    );
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const sym = table.lookup("unless", table.root);
    expect(sym).not.toBeNull();
    expect(sym!.kind).toBe("function");
  });

  test("lambda creates a scope with parameters", () => {
    const result = tlispParser.parse("(defun f () ((lambda (x) x) 5))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const lambdaScope = table.scopes.find(s => s.name === "lambda");
    expect(lambdaScope).toBeDefined();

    const x = table.lookup("x", lambdaScope!);
    expect(x).not.toBeNull();
    expect(x!.kind).toBe("parameter");
  });

  test("let* bindings create scope with variables", () => {
    const result = tlispParser.parse("(let* ((a 1) (b a)) (+ a b))", "test");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;

    const table = buildTlispScopes(result.right);
    const letScope = table.scopes.find(s => s.name === "let");
    expect(letScope).toBeDefined();

    const a = table.lookup("a", letScope!);
    const b = table.lookup("b", letScope!);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.kind).toBe("variable");
    expect(b!.kind).toBe("variable");
  });
});
