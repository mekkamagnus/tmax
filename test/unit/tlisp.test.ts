/**
 * @file tlisp.test.ts
 * @description Tests for T-Lisp interpreter foundation
 */

import { describe, test, expect } from "bun:test";
import { 
  createNil, 
  createBoolean, 
  createNumber, 
  createString, 
  createSymbol, 
  createList,
  createFunction,
  isNil,
  isTruthy,
  valueToString,
  valuesEqual,
} from "../../src/tlisp/values.ts";
import { TLispEnvironmentImpl } from "../../src/tlisp/environment.ts";
import { TLispInterpreterImpl } from "../../src/tlisp/interpreter.ts";

/**
 * Test suite for T-Lisp values
 */
describe("T-Lisp Values", () => {
  test("should create nil value", () => {
    const nil = createNil();
    expect(nil.type).toBe("nil");
    expect(nil.value).toBe(null);
    expect(isNil(nil)).toBe(true);
  });

  test("should create boolean values", () => {
    const trueVal = createBoolean(true);
    const falseVal = createBoolean(false);
    
    expect(trueVal.type).toBe("boolean");
    expect(trueVal.value).toBe(true);
    expect(falseVal.type).toBe("boolean");
    expect(falseVal.value).toBe(false);
  });

  test("should create number values", () => {
    const num = createNumber(42);
    expect(num.type).toBe("number");
    expect(num.value).toBe(42);
  });

  test("should create string values", () => {
    const str = createString("hello");
    expect(str.type).toBe("string");
    expect(str.value).toBe("hello");
  });

  test("should create symbol values", () => {
    const sym = createSymbol("foo");
    expect(sym.type).toBe("symbol");
    expect(sym.value).toBe("foo");
  });

  test("should create list values", () => {
    const list = createList([createNumber(1), createNumber(2)]);
    expect(list.type).toBe("list");
    expect(list.value.length).toBe(2);
  });

  test("should test truthiness", () => {
    expect(isTruthy(createNil())).toBe(false);
    expect(isTruthy(createBoolean(false))).toBe(false);
    expect(isTruthy(createBoolean(true))).toBe(true);
    expect(isTruthy(createNumber(0))).toBe(true);
    expect(isTruthy(createString(""))).toBe(true);
  });

  test("should convert values to strings", () => {
    expect(valueToString(createNil())).toBe("nil");
    expect(valueToString(createBoolean(true))).toBe("t");
    expect(valueToString(createBoolean(false))).toBe("nil");
    expect(valueToString(createNumber(42))).toBe("42");
    expect(valueToString(createString("hello"))).toBe('"hello"');
    expect(valueToString(createSymbol("foo"))).toBe("foo");
  });

  test("should test value equality", () => {
    expect(valuesEqual(createNil(), createNil())).toBe(true);
    expect(valuesEqual(createNumber(42), createNumber(42))).toBe(true);
    expect(valuesEqual(createNumber(42), createNumber(43))).toBe(false);
    expect(valuesEqual(createString("hello"), createString("hello"))).toBe(true);
  });
});

/**
 * Test suite for T-Lisp environment
 */
describe("T-Lisp Environment", () => {
  let env: TLispEnvironmentImpl;

  test("should create environment", () => {
    env = new TLispEnvironmentImpl();
    expect(env).toBeDefined();
    expect(env.bindings).toBeDefined();
  });

  test("should define and lookup variables", () => {
    const value = createNumber(42);
    env.define("x", value);
    
    const result = env.lookup("x");
    expect(result).toBe(value);
  });

  test("should return undefined for undefined variables", () => {
    const result = env.lookup("undefined-var");
    expect(result).toBe(undefined);
  });

  test("should support parent environments", () => {
    const parent = new TLispEnvironmentImpl();
    const child = new TLispEnvironmentImpl(parent);
    
    parent.define("parent-var", createString("parent"));
    child.define("child-var", createString("child"));
    
    expect(child.lookup("parent-var")?.value).toBe("parent");
    expect(child.lookup("child-var")?.value).toBe("child");
    expect(parent.lookup("child-var")).toBe(undefined);
  });
});

/**
 * Test suite for T-Lisp interpreter foundation
 */
describe("T-Lisp Interpreter Foundation", () => {
  let interpreter: TLispInterpreterImpl;

  test("should create interpreter", () => {
    interpreter = new TLispInterpreterImpl();
    expect(interpreter).toBeDefined();
    expect(interpreter.globalEnv).toBeDefined();
  });

  test("should have built-in functions", () => {
    const plus = interpreter.globalEnv.lookup("+");
    const minus = interpreter.globalEnv.lookup("-");
    const eq = interpreter.globalEnv.lookup("eq");
    const nullFn = interpreter.globalEnv.lookup("null");
    
    expect(plus).toBeDefined();
    expect(minus).toBeDefined();
    expect(eq).toBeDefined();
    expect(nullFn).toBeDefined();
    
    expect(plus?.type).toBe("function");
    expect(minus?.type).toBe("function");
    expect(eq?.type).toBe("function");
    expect(nullFn?.type).toBe("function");
  });

  test("should define custom built-ins", () => {
    interpreter.defineBuiltin("test-fn", (args) => createString("test"));
    
    const testFn = interpreter.globalEnv.lookup("test-fn");
    expect(testFn).toBeDefined();
    expect(testFn.type).toBe("function");
  });

  test("should have placeholder parse method", () => {
    const result = interpreter.parse("(+ 1 2)");
    expect(result).toBeDefined();
  });

  test("should have placeholder eval method", () => {
    const expr = createList([createSymbol("+"), createNumber(1), createNumber(2)]);
    const result = interpreter.eval(expr);
    expect(result).toBeDefined();
  });
});