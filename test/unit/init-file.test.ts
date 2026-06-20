import { describe, expect, test } from "bun:test";
import { Editor } from "../../src/editor/editor.ts";
import { MockFileSystem } from "../mocks/filesystem.ts";
import { MockTerminal } from "../mocks/terminal.ts";
import { Either } from "../../src/utils/task-either.ts";
import { expectTlispString, expectTlispNumber } from "../helpers/editor-fixture.ts";

describe("SPEC-025: init file loading", () => {
  test("init-file-path returns default XDG path when no custom init file is set", async () => {
    const oldHome = process.env.HOME;
    process.env.HOME = `/tmp/tmax-init-test-${Date.now()}`;
    try {
      const editor = new Editor(new MockTerminal(), new MockFileSystem());
      await editor.start();

      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("(init-file-path)");
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(expectTlispString(result.right)).toContain(".config/tmax/init.tlisp");
      }
    } finally {
      process.env.HOME = oldHome;
    }
  });

  test("init-file-path returns the custom init file path when provided", async () => {
    const fs = new MockFileSystem();
    await fs.writeFile("/custom/init.tlisp", '(defvar my-init-var 42)');

    const editor = new Editor(new MockTerminal(), fs, "/custom/init.tlisp");
    await editor.start();

    const interpreter = editor.getInterpreter();
    const result = interpreter.execute("(init-file-path)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(expectTlispString(result.right)).toContain("/custom/init.tlisp");
    }
  });

  test("custom init file is loaded and evaluated on startup", async () => {
    const fs = new MockFileSystem();
    await fs.writeFile("/test/init.tlisp", '(defvar my-test-var "loaded")');

    const editor = new Editor(new MockTerminal(), fs, "/test/init.tlisp");
    await editor.start();

    const interpreter = editor.getInterpreter();
    const result = interpreter.execute("my-test-var");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(expectTlispString(result.right)).toContain("loaded");
    }
  });

  test("eval-init-file reloads the init file at runtime", async () => {
    const fs = new MockFileSystem();
    await fs.writeFile("/reload/init.tlisp", '(defvar reload-test 1)');

    const editor = new Editor(new MockTerminal(), fs, "/reload/init.tlisp");
    await editor.start();

    const interpreter = editor.getInterpreter();

    // Verify initial value
    const initial = interpreter.execute("reload-test");
    expect(Either.isRight(initial)).toBe(true);
    if (Either.isRight(initial)) {
      expect(expectTlispNumber(initial.right)).toBe(1);
    }

    // Update the init file content
    await fs.writeFile("/reload/init.tlisp", '(defvar reload-test 99)');

    // Reload
    await editor.evalInitFile();

    // Verify updated value
    const reloaded = interpreter.execute("reload-test");
    expect(Either.isRight(reloaded)).toBe(true);
    if (Either.isRight(reloaded)) {
      expect(expectTlispNumber(reloaded.right)).toBe(99);
    }
  });

  test("missing init file does not crash the editor", async () => {
    const fs = new MockFileSystem();

    const editor = new Editor(new MockTerminal(), fs, "/nonexistent/init.tlisp");
    await editor.start();

    const interpreter = editor.getInterpreter();
    const result = interpreter.execute("(+ 1 2)");
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(expectTlispNumber(result.right)).toBe(3);
    }
  });

  test("default init file at XDG path is loaded on startup", async () => {
    const oldHome = process.env.HOME;
    const tempHome = `/tmp/tmax-test-home-${Date.now()}`;
    process.env.HOME = tempHome;

    try {
      const fs = new MockFileSystem();
      await fs.writeFile(`${tempHome}/.config/tmax/init.tlisp`, '(defvar xdg-test-var "xdg")');

      const editor = new Editor(new MockTerminal(), fs);
      await editor.start();

      const interpreter = editor.getInterpreter();
      const result = interpreter.execute("xdg-test-var");
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(expectTlispString(result.right)).toContain("xdg");
      }
    } finally {
      process.env.HOME = oldHome;
    }
  });
});
