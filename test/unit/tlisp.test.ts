/**
 * @file tlisp.test.ts
 * @description Tests for T-Lisp interpreter foundation
 */

import { assertEquals, assertExists } from "@std/assert";
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
Deno.test("T-Lisp Values", async (t) => {
  await t.step("should create nil value", () => {
    const nil = createNil();
    assertEquals(nil.type, "nil");
    assertEquals(nil.value, null);
    assertEquals(isNil(nil), true);
  });

  await t.step("should create boolean values", () => {
    const trueVal = createBoolean(true);
    const falseVal = createBoolean(false);
    
    assertEquals(trueVal.type, "boolean");
    assertEquals(trueVal.value, true);
    assertEquals(falseVal.type, "boolean");
    assertEquals(falseVal.value, false);
  });

  await t.step("should create number values", () => {
    const num = createNumber(42);
    assertEquals(num.type, "number");
    assertEquals(num.value, 42);
  });

  await t.step("should create string values", () => {
    const str = createString("hello");
    assertEquals(str.type, "string");
    assertEquals(str.value, "hello");
  });

  await t.step("should create symbol values", () => {
    const sym = createSymbol("foo");
    assertEquals(sym.type, "symbol");
    assertEquals(sym.value, "foo");
  });

  await t.step("should create list values", () => {
    const list = createList([createNumber(1), createNumber(2)]);
    assertEquals(list.type, "list");
    assertEquals(list.value.length, 2);
  });

  await t.step("should test truthiness", () => {
    assertEquals(isTruthy(createNil()), false);
    assertEquals(isTruthy(createBoolean(false)), false);
    assertEquals(isTruthy(createBoolean(true)), true);
    assertEquals(isTruthy(createNumber(0)), true);
    assertEquals(isTruthy(createString("")), true);
  });

  await t.step("should convert values to strings", () => {
    assertEquals(valueToString(createNil()), "nil");
    assertEquals(valueToString(createBoolean(true)), "t");
    assertEquals(valueToString(createBoolean(false)), "nil");
    assertEquals(valueToString(createNumber(42)), "42");
    assertEquals(valueToString(createString("hello")), '"hello"');
    assertEquals(valueToString(createSymbol("foo")), "foo");
  });

  await t.step("should test value equality", () => {
    assertEquals(valuesEqual(createNil(), createNil()), true);
    assertEquals(valuesEqual(createNumber(42), createNumber(42)), true);
    assertEquals(valuesEqual(createNumber(42), createNumber(43)), false);
    assertEquals(valuesEqual(createString("hello"), createString("hello")), true);
  });
});

/**
 * Test suite for T-Lisp environment
 */
Deno.test("T-Lisp Environment", async (t) => {
  let env: TLispEnvironmentImpl;

  await t.step("should create environment", () => {
    env = new TLispEnvironmentImpl();
    assertExists(env);
    assertExists(env.bindings);
  });

  await t.step("should define and lookup variables", () => {
    const value = createNumber(42);
    env.define("x", value);
    
    const result = env.lookup("x");
    assertEquals(result, value);
  });

  await t.step("should return undefined for undefined variables", () => {
    const result = env.lookup("undefined-var");
    assertEquals(result, undefined);
  });

  await t.step("should support parent environments", () => {
    const parent = new TLispEnvironmentImpl();
    const child = new TLispEnvironmentImpl(parent);
    
    parent.define("parent-var", createString("parent"));
    child.define("child-var", createString("child"));
    
    assertEquals(child.lookup("parent-var")?.value, "parent");
    assertEquals(child.lookup("child-var")?.value, "child");
    assertEquals(parent.lookup("child-var"), undefined);
  });
});

/**
 * Test suite for T-Lisp interpreter foundation
 */
Deno.test("T-Lisp Interpreter Foundation", async (t) => {
  let interpreter: TLispInterpreterImpl;

  await t.step("should create interpreter", () => {
    interpreter = new TLispInterpreterImpl();
    assertExists(interpreter);
    assertExists(interpreter.globalEnv);
  });

  await t.step("should have built-in functions", () => {
    const plus = interpreter.globalEnv.lookup("+");
    const minus = interpreter.globalEnv.lookup("-");
    const eq = interpreter.globalEnv.lookup("eq");
    const nullFn = interpreter.globalEnv.lookup("null");
    
    assertExists(plus);
    assertExists(minus);
    assertExists(eq);
    assertExists(nullFn);
    
    assertEquals(plus?.type, "function");
    assertEquals(minus?.type, "function");
    assertEquals(eq?.type, "function");
    assertEquals(nullFn?.type, "function");
  });

  await t.step("should define custom built-ins", () => {
    interpreter.defineBuiltin("test-fn", (args) => createString("test"));
    
    const testFn = interpreter.globalEnv.lookup("test-fn");
    assertExists(testFn);
    assertEquals(testFn.type, "function");
  });

  await t.step("should have placeholder parse method", () => {
    const result = interpreter.parse("(+ 1 2)");
    assertEquals(result.type, "nil");
  });

  await t.step("should have placeholder eval method", () => {
    const expr = createList([createSymbol("+"), createNumber(1), createNumber(2)]);
    const result = interpreter.eval(expr);
    assertEquals(result.type, "nil");
  });
});