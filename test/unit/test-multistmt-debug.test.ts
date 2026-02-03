import { test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

test("debug multi-statement exec", () => {
  const mockTerminal = new MockTerminal();
  const mockFileSystem = new MockFileSystem();
  const editor = new Editor(mockTerminal, mockFileSystem);
  editor.start();

  const interpreter = (editor as any).interpreter;
  
  // This is exactly what the test does
  const code = `(defvar setup-count 0) (deftest-suite "Count Setup" (suite-setup (set! setup-count (+ setup-count 1))) (deftest test-1 () (assert-true t)) (deftest test-2 () (assert-true t)) (deftest test-3 () (assert-true t)))`;
  
  interpreter.execute(code);
  interpreter.execute('(test-run-suite "Count Setup")');
  
  const countResult = interpreter.execute('setup-count');
  console.log("Count result:", countResult);
  console.log("Count value:", countResult.right.value);
  
  editor.stop();
  
  expect(countResult.right.value).toBe(1);
});
