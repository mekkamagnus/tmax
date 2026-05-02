import { TLispInterpreterImpl } from "./src/tlisp/interpreter.ts";
import { registerTestingFramework } from "./src/tlisp/test-framework.ts";

const interpreter = new TLispInterpreterImpl();
registerTestingFramework(interpreter);

// Test simple deffixture
const result = interpreter.execute(`
  (deffixture simple-fixture ()
    (defvar x 10))
`);

console.log("Result:", result);
