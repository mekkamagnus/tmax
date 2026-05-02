import { test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

test("debug suite registration", () => {
  const mockTerminal = new MockTerminal();
  const mockFileSystem = new MockFileSystem();
  const editor = new Editor(mockTerminal, mockFileSystem);
  editor.start();

  const interpreter = (editor as any).interpreter;
  
  // Execute code
  const code = `(defvar setup-count 0) (deftest-suite "Count Setup" (suite-setup (set! setup-count (+ setup-count 1))) (deftest test-1 () (assert-true t)) (deftest test-2 () (assert-true t)) (deftest test-3 () (assert-true t)))`;
  const result = interpreter.execute(code);
  console.log("Code execution result:", result);
  
  // Check if suite exists
  const suite = interpreter.getSuiteDefinition?.("Count Setup");
  console.log("Suite definition:", suite);
  if (suite) {
    console.log("Suite setup:", suite.setup);
  }
  
  // Run suite
  const suiteResult = interpreter.execute('(test-run-suite "Count Setup")');
  console.log("Suite run result:", suiteResult);
  
  // Check count
  const countResult = interpreter.execute('setup-count');
  console.log("Count result:", countResult);
  
  editor.stop();
});
