import { Editor } from "./src/editor/editor.ts";
import { MockTerminal } from "./mocks/terminal.ts";
import { MockFileSystem } from "./mocks/filesystem.ts";
import { resetFixtureState } from "./src/tlisp/test-framework.ts";

const mockTerminal = new MockTerminal();
const mockFileSystem = new MockFileSystem();
const editor = new Editor(mockTerminal, mockFileSystem);
editor.start();
resetFixtureState();

const interpreter = editor.getInterpreter();

// Define fixture
console.log("1. Defining fixture...");
const defResult = interpreter.execute('(deffixture setup-x () (defvar x 100))');
console.log("Def result:", defResult);

// Define test
console.log("2. Defining test...");
const testDefResult = interpreter.execute('(deftest test-with-x () (use-fixtures setup-x) (assert-equal x 100))');
console.log("Test def result:", testDefResult);

// Run test
console.log("3. Running test...");
const runResult = interpreter.execute('(test-run "test-with-x")');
console.log("Run result:", runResult);

editor.stop();
