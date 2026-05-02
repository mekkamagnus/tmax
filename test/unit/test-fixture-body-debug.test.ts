import { describe, test, beforeEach, afterEach } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { resetFixtureState } from "../../src/tlisp/test-framework.ts";

describe("Debug Fixture Body", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    editor = new Editor(mockTerminal, mockFileSystem);
    editor.start();
    resetFixtureState();
  });

  afterEach(() => {
    editor.stop();
  });

  test("check if fixture body is stored", () => {
    const interpreter = editor.getInterpreter();

    // Define fixture
    const defResult = interpreter.execute('(deffixture setup_x () (defvar x 100))');
    console.log("Def result:", defResult._tag);

    // Check global storage
    const globalFixtures = (globalThis as any).__deffixture_data__;
    if (globalFixtures) {
      console.log("Global fixtures:", Array.from(globalFixtures.keys()));
      const fixture = globalFixtures.get("setup_x");
      if (fixture) {
        console.log("Fixture data:", JSON.stringify(fixture, null, 2));
      }
    }
  });
});
