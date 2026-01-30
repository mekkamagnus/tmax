import { createEvaluatorWithBuiltins } from "./src/tlisp/evaluator.ts";
import { TLispParser } from "./src/tlisp/parser.ts";
import { Either } from "./src/utils/task-either.ts";

// Simple test to see if evaluator works
const { evaluator, env } = createEvaluatorWithBuiltins();
const parser = new TLispParser();

console.log("Testing simple expression evaluation...");

// Test a simple number
try {
  const expr = parser.parse("42");
  if (Either.isRight(expr)) {
    console.log("Parsed expression:", expr.right);
    const result = evaluator.eval(expr.right, env);
    console.log("Evaluation result:", result);
  } else {
    console.error("Parse failed:", expr.left);
  }
} catch (e) {
  console.error("Error during evaluation:", e);
}

// Test quasiquote
try {
  console.log("\nTesting quasiquote...");
  const expr = parser.parse("`(a b c)");
  if (Either.isRight(expr)) {
    console.log("Parsed quasiquote expression:", expr.right);
    const result = evaluator.eval(expr.right, env);
    console.log("Quasiquote evaluation result:", result);
  } else {
    console.error("Quasiquote parse failed:", expr.left);
  }
} catch (e) {
  console.error("Error during quasiquote evaluation:", e);
}