/**
 * @file test-key-bind-enhancements.test.ts
 * @description Test the enhanced key-bind functionality including key-unbind, key-bindings, and key-binding
 */

import { describe, test, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import {
  expectRight,
  expectTlispList,
  expectTlispString,
} from "../helpers/editor-fixture.ts";

describe("Enhanced Key Bind Functions", () => {
  let editor: Editor;
  let mockTerminal: MockTerminal;
  let mockFileSystem: MockFileSystem;

  beforeEach(async () => {
    mockTerminal = new MockTerminal();
    mockFileSystem = new MockFileSystem();
    // Create an empty filesystem for these tests
    editor = new Editor(mockTerminal, mockFileSystem);
    // Start the editor to initialize the interpreter
    await editor.start();
  });

  afterEach(() => {
    editor.stop();
  });

  test("should create binding with key-bind function", async () => {
    const interpreter = editor.getInterpreter();

    // Test basic key binding creation
    const result = interpreter.execute('(key-bind "C-c C-c" "(some-command)")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("string");
    expect(value.value).toBe("C-c C-c");

    // Verify the binding was actually created
    const keyMappings = editor.getKeyMappings();
    const mappings = keyMappings.get("C-c C-c");

    expect(mappings).toBeDefined();
    expect(mappings!.length).toBe(1);
    expect(mappings![0]!.command).toBe("(some-command)");
    expect(mappings![0]!.mode).toBeUndefined(); // No mode specified
  });

  test("should create mode-specific binding", async () => {
    const interpreter = editor.getInterpreter();

    // Test mode-specific key binding creation
    const result = interpreter.execute('(key-bind "k" "(kill-line)" "normal")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("string");
    expect(value.value).toBe("k");

    // Verify the binding was actually created with mode
    const keyMappings = editor.getKeyMappings();
    const mappings = keyMappings.get("k");

    expect(mappings).toBeDefined();
    const binding = mappings?.find(mapping => mapping.command === "(kill-line)");
    expect(binding).toBeDefined();
    expect(binding?.mode).toBe("normal");
  });

  test("should handle two-key sequences", async () => {
    const interpreter = editor.getInterpreter();

    // Test two-key sequence binding
    const result = interpreter.execute('(key-bind "g d" "(goto-definition)")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("string");
    expect(value.value).toBe("g d");

    // Verify the binding was actually created
    const keyMappings = editor.getKeyMappings();
    const mappings = keyMappings.get("g d");

    expect(mappings).toBeDefined();
    expect(mappings!.length).toBe(1);
    expect(mappings![0]!.command).toBe("(goto-definition)");
  });

  test("should remove binding with key-unbind function", async () => {
    const interpreter = editor.getInterpreter();

    // First create a binding
    interpreter.execute('(key-bind "C-c C-c" "(some-command)")');

    // Verify it exists
    let keyMappings = editor.getKeyMappings();
    let mappings = keyMappings.get("C-c C-c");
    expect(mappings).toBeDefined();
    expect(mappings!.length).toBe(1);

    // Now remove it
    const result = interpreter.execute('(key-unbind "C-c C-c")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("string");
    expect(value.value).toBe("C-c C-c");

    // Verify it was removed
    keyMappings = editor.getKeyMappings();
    mappings = keyMappings.get("C-c C-c");
    expect(mappings).toBeUndefined();
  });

  test("should remove mode-specific binding with key-unbind", async () => {
    const interpreter = editor.getInterpreter();

    // Create a mode-specific binding
    interpreter.execute('(key-bind "k" "(kill-line)" "normal")');

    // Verify it exists
    let keyMappings = editor.getKeyMappings();
    let mappings = keyMappings.get("k");
    expect(mappings).toBeDefined();
    expect(mappings?.some(mapping =>
      mapping.command === "(kill-line)" && mapping.mode === "normal"
    )).toBe(true);

    // Now remove it with mode specification
    const result = interpreter.execute('(key-unbind "k" "normal")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("string");
    expect(value.value).toBe("k");

    // Verify it was removed
    keyMappings = editor.getKeyMappings();
    mappings = keyMappings.get("k");
    expect(mappings?.some(mapping =>
      mapping.command === "(kill-line)" && mapping.mode === "normal"
    ) ?? false).toBe(false);
  });

  test("should list all active bindings with key-bindings function", async () => {
    const interpreter = editor.getInterpreter();

    // Create some bindings
    interpreter.execute('(key-bind "a" "(command-a)")');
    interpreter.execute('(key-bind "b" "(command-b)" "normal")');
    interpreter.execute('(key-bind "c" "(command-c)" "insert")');

    // Get all bindings
    const result = interpreter.execute('(key-bindings)');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("list");

    const bindingsList = expectTlispList(value);
    expect(bindingsList.length).toBeGreaterThanOrEqual(3); // At least the 3 we added

    // Check that our bindings are in the list
    const bindingStrings = bindingsList.map((item: any) => {
      if (item.type === 'list' && item.value.length >= 2) {
        return { key: item.value[0].value, command: item.value[1].value, mode: item.value[2]?.value };
      }
      return null;
    });

    const hasA = bindingStrings.some((b: any) => b && b.key === "a" && b.command === "(command-a)" && !b.mode);
    const hasB = bindingStrings.some((b: any) => b && b.key === "b" && b.command === "(command-b)" && b.mode === "normal");
    const hasC = bindingStrings.some((b: any) => b && b.key === "c" && b.command === "(command-c)" && b.mode === "insert");

    expect(hasA).toBe(true);
    expect(hasB).toBe(true);
    expect(hasC).toBe(true);
  });

  test("should return command and source info with key-binding function", async () => {
    const interpreter = editor.getInterpreter();

    // Create a binding
    interpreter.execute('(key-bind "C-c C-c" "(some-command)")');

    // Get info about the binding
    const result = interpreter.execute('(key-binding "C-c C-c")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("list");

    const resultArray = expectTlispList(value);
    expect(resultArray.length).toBe(3);
    expect(expectTlispString(resultArray[0]!)).toBe("(some-command)"); // command
    expect(expectTlispString(resultArray[1]!)).toBe("source");         // source
    expect(expectTlispString(resultArray[2]!)).toBe("all");            // mode
  });

  test("should return mode-specific binding info with key-binding function", async () => {
    const interpreter = editor.getInterpreter();

    // Create a mode-specific binding
    interpreter.execute('(key-bind "k" "(kill-line)" "normal")');

    // Get info about the binding with mode
    const result = interpreter.execute('(key-binding "k" "normal")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("list");

    const resultArray = expectTlispList(value);
    expect(resultArray.length).toBe(3);
    expect(expectTlispString(resultArray[0]!)).toBe("(kill-line)"); // command
    expect(expectTlispString(resultArray[1]!)).toBe("source");      // source
    expect(expectTlispString(resultArray[2]!)).toBe("normal");      // mode
  });

  test("should handle conflicting bindings by overriding previous bindings", async () => {
    const interpreter = editor.getInterpreter();

    // Create a binding
    const result1 = interpreter.execute('(key-bind "x" "(original-command)" "normal")');
    expect(result1).toBeDefined();
    expect(result1._tag).toBe("Right");

    // Verify it exists
    let keyMappings = editor.getKeyMappings();
    let mappings = keyMappings.get("x");
    expect(mappings).toBeDefined();
    expect(mappings![0]!.command).toBe("(original-command)");

    // Override with new command
    const result2 = interpreter.execute('(key-bind "x" "(new-command)" "normal")');
    expect(result2).toBeDefined();
    expect(result2._tag).toBe("Right");

    // Verify the new command is there
    keyMappings = editor.getKeyMappings();
    mappings = keyMappings.get("x");
    expect(mappings).toBeDefined();
    expect(mappings!.length).toBe(1);
    expect(mappings![0]!.command).toBe("(new-command)");
  });

  test("should return nil when key-binding function is called for non-existent key", async () => {
    const interpreter = editor.getInterpreter();

    // Get info about a non-existent binding
    const result = interpreter.execute('(key-binding "non-existent-key")');

    expect(result).toBeDefined();
    expect(result._tag).toBe("Right");

    const value = expectRight(result);
    expect(value.type).toBe("nil");
  });
});
