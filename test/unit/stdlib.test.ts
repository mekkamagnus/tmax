/**
 * @file stdlib.test.ts
 * @description Tests for T-Lisp standard library functions
 */

import { assertEquals, assertThrows } from "@std/assert";
import { createEvaluatorWithBuiltins } from "../../src/tlisp/evaluator.ts";
import { TLispParser } from "../../src/tlisp/parser.ts";
import { createNumber, createString, createBoolean, createNil, createList, createSymbol } from "../../src/tlisp/values.ts";

/**
 * Test suite for T-Lisp standard library
 */
Deno.test("T-Lisp Standard Library", async (t) => {
  const { evaluator, env } = createEvaluatorWithBuiltins();
  const parser = new TLispParser();

  // String functions
  await t.step("should handle string operations", async (t) => {
    await t.step("length function", () => {
      let expr = parser.parse('(length "hello")');
      let result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(5));
      
      expr = parser.parse("(length '(1 2 3 4))");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(4));
    });

    await t.step("substring function", () => {
      const expr = parser.parse('(substring "hello world" 0 5)');
      const result = evaluator.eval(expr, env);
      assertEquals(result, createString("hello"));
    });

    await t.step("string-append function", () => {
      const expr = parser.parse('(string-append "hello" " " "world")');
      const result = evaluator.eval(expr, env);
      assertEquals(result, createString("hello world"));
    });

    await t.step("string comparison functions", () => {
      let expr = parser.parse('(string= "hello" "hello")');
      let result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse('(string= "hello" "world")');
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(false));

      expr = parser.parse('(string< "apple" "banana")');
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse('(string> "banana" "apple")');
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));
    });

    await t.step("string case functions", () => {
      let expr = parser.parse('(string-upcase "hello")');
      let result = evaluator.eval(expr, env);
      assertEquals(result, createString("HELLO"));

      expr = parser.parse('(string-downcase "WORLD")');
      result = evaluator.eval(expr, env);
      assertEquals(result, createString("world"));
    });
  });

  // List functions
  await t.step("should handle advanced list operations", async (t) => {
    await t.step("append function", () => {
      const expr = parser.parse("(append '(1 2) '(3 4) '(5))");
      const result = evaluator.eval(expr, env);
      assertEquals(result.type, "list");
      const list = result.value as any[];
      assertEquals(list.length, 5);
      assertEquals(list[0].value, 1);
      assertEquals(list[4].value, 5);
    });

    await t.step("reverse function", () => {
      const expr = parser.parse("(reverse '(1 2 3 4))");
      const result = evaluator.eval(expr, env);
      assertEquals(result.type, "list");
      const list = result.value as any[];
      assertEquals(list.length, 4);
      assertEquals(list[0].value, 4);
      assertEquals(list[3].value, 1);
    });

    await t.step("nth function", () => {
      let expr = parser.parse("(nth 0 '(a b c))");
      let result = evaluator.eval(expr, env);
      assertEquals(result.type, "symbol");
      assertEquals(result.value, "a");

      expr = parser.parse("(nth 2 '(a b c))");
      result = evaluator.eval(expr, env);
      assertEquals(result.type, "symbol");
      assertEquals(result.value, "c");

      expr = parser.parse("(nth 5 '(a b c))");
      result = evaluator.eval(expr, env);
      assertEquals(result.type, "nil");
    });

    await t.step("last function", () => {
      let expr = parser.parse("(last '(1 2 3 4))");
      let result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(4));

      expr = parser.parse("(last '())");
      result = evaluator.eval(expr, env);
      assertEquals(result.type, "nil");
    });

    await t.step("member function", () => {
      let expr = parser.parse("(member 2 '(1 2 3 4))");
      let result = evaluator.eval(expr, env);
      assertEquals(result.type, "list");
      let list = result.value as any[];
      assertEquals(list.length, 3);
      assertEquals(list[0].value, 2);

      expr = parser.parse("(member 5 '(1 2 3 4))");
      result = evaluator.eval(expr, env);
      assertEquals(result.type, "nil");
    });
  });

  // Type predicates
  await t.step("should handle type predicates", async (t) => {
    await t.step("basic type predicates", () => {
      let expr = parser.parse("(numberp 42)");
      let result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse('(stringp "hello")');
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse("(symbolp 'foo)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse("(listp '(1 2 3))");
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse("(functionp +)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));
    });

    await t.step("number predicates", () => {
      let expr = parser.parse("(zerop 0)");
      let result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse("(zerop 5)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(false));

      expr = parser.parse("(evenp 4)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse("(evenp 3)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(false));

      expr = parser.parse("(oddp 3)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(true));

      expr = parser.parse("(oddp 4)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createBoolean(false));
    });
  });

  // Mathematical functions
  await t.step("should handle mathematical operations", async (t) => {
    await t.step("basic math functions", () => {
      let expr = parser.parse("(abs -5)");
      let result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(5));

      expr = parser.parse("(abs 3)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(3));

      expr = parser.parse("(min 3 1 4 2)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(1));

      expr = parser.parse("(max 3 1 4 2)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(4));
    });

    await t.step("advanced math functions", () => {
      let expr = parser.parse("(sqrt 16)");
      let result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(4));

      expr = parser.parse("(expt 2 3)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(8));

      expr = parser.parse("(mod 7 3)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(1));

      expr = parser.parse("(floor 3.7)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(3));

      expr = parser.parse("(ceiling 3.2)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(4));

      expr = parser.parse("(round 3.6)");
      result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(4));
    });
  });

  // Logical functions
  await t.step("should handle logical operations", () => {
    let expr = parser.parse("(not t)");
    let result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(false));

    expr = parser.parse("(not nil)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(true));

    expr = parser.parse("(not 0)");
    result = evaluator.eval(expr, env);
    assertEquals(result, createBoolean(false));
  });

  // I/O functions
  await t.step("should handle I/O operations", () => {
    // Test print function (returns nil)
    const expr = parser.parse('(print "hello" 42 t)');
    const result = evaluator.eval(expr, env);
    assertEquals(result.type, "nil");
  });

  // Error handling
  await t.step("should handle errors appropriately", async (t) => {
    await t.step("should throw on wrong argument types", () => {
      assertThrows(() => {
        const expr = parser.parse("(length 42)");
        evaluator.eval(expr, env);
      });

      assertThrows(() => {
        const expr = parser.parse("(sqrt -4)");
        evaluator.eval(expr, env);
      });

      assertThrows(() => {
        const expr = parser.parse("(mod 5 0)");
        evaluator.eval(expr, env);
      });
    });

    await t.step("should throw on wrong argument counts", () => {
      assertThrows(() => {
        const expr = parser.parse("(abs 1 2)");
        evaluator.eval(expr, env);
      });

      assertThrows(() => {
        const expr = parser.parse("(min)");
        evaluator.eval(expr, env);
      });
    });
  });

  // Integration tests
  await t.step("should handle complex standard library usage", async (t) => {
    await t.step("combined string and list operations", () => {
      const expr = parser.parse(`
        (let ((words '("hello" "world" "from" "T-Lisp")))
          (length (string-append 
            (nth 0 words) 
            " " 
            (nth 1 words))))
      `);
      const result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(11)); // "hello world".length
    });

    await t.step("mathematical computations", () => {
      const expr = parser.parse(`
        (let ((numbers '(1 2 3 4 5)))
          (+ (abs (- (nth 0 numbers) (nth 4 numbers)))
             (sqrt (expt (nth 1 numbers) 2))))
      `);
      const result = evaluator.eval(expr, env);
      assertEquals(result, createNumber(6)); // abs(1-5) + sqrt(2^2) = 4 + 2 = 6
    });

    await t.step("type checking and conditional logic", () => {
      const expr = parser.parse(`
        (defun describe-value (x)
          (if (numberp x)
              (if (zerop x)
                  "zero"
                  (if (evenp x) "even number" "odd number"))
              (if (stringp x)
                  "text"
                  "other")))
      `);
      evaluator.eval(expr, env);

      let testExpr = parser.parse("(describe-value 0)");
      let result = evaluator.eval(testExpr, env);
      assertEquals(result, createString("zero"));

      testExpr = parser.parse("(describe-value 4)");
      result = evaluator.eval(testExpr, env);
      assertEquals(result, createString("even number"));

      testExpr = parser.parse("(describe-value 3)");
      result = evaluator.eval(testExpr, env);
      assertEquals(result, createString("odd number"));

      testExpr = parser.parse('(describe-value "hello")');
      result = evaluator.eval(testExpr, env);
      assertEquals(result, createString("text"));
    });
  });
});