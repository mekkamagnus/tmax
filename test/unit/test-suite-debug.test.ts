import { test, expect, beforeEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";

test("debug suite setup", () => {
  const mockTerminal = new MockTerminal();
  const mockFileSystem = new MockFileSystem();
  const editor = new Editor(mockTerminal, mockFileSystem);
  editor.start();

  const interpreter = (editor as any).interpreter;
  
  // Define variable
  interpreter.execute('(defvar setup-count 0)');
  
  // Define suite
  interpreter.execute('(deftest-suite "Count Setup" (suite-setup (set! setup-count (+ setup-count 1))) (deftest test-1 () (assert-true t)))');
  
  // Check variable before
  const before = interpreter.execute('setup-count');
  console.log("Before suite run:", before);
  
  // Run suite
  const suiteResult = interpreter.execute('(test-run-suite "Count Setup")');
  console.log("Suite result:", suiteResult);
  
  // Check variable after
  const after = interpreter.execute('setup-count');
  console.log("After suite run:", after);
  
  editor.stop();
});
