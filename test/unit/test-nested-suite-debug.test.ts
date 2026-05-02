import { test, expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

test("debug nested suite", () => {
  const mockTerminal = new MockTerminal();
  const mockFileSystem = new MockFileSystem();
  const editor = new Editor(mockTerminal, mockFileSystem);
  editor.start();

  const interpreter = (editor as any).interpreter;
  
  const code = `(deftest-suite "Parent Suite" (deftest test-parent () (assert-true t)) (deftest-suite "Child Suite" (deftest test-child () (assert-true t))))`;
  
  const result = interpreter.execute(code);
  console.log("Define result:", result);
  
  // Check parent suite
  const parentSuite = interpreter.getSuiteDefinition?.("Parent Suite");
  console.log("Parent suite:", parentSuite);
  
  // Check child suite
  const childSuite = interpreter.getSuiteDefinition?.("Child Suite");
  console.log("Child suite:", childSuite);
  
  // Run parent suite
  const runResult = interpreter.execute('(test-run-suite "Parent Suite")');
  console.log("Run result:", runResult);
  
  if (runResult._tag === "Right") {
    const [passed, failed, total] = runResult.right.value;
    console.log("Passed:", passed.value, "Failed:", failed.value, "Total:", total.value);
  }
  
  editor.stop();
});
