/**
 * @file core-functional.test.ts
 * @description Tests for the canonical core contracts and their engines.
 *
 * Migrated in CHORE-44 Change 9 from the prior parallel `Functional*`
 * interfaces to the canonical contracts:
 *   - `TextBuffer` / `TextBufferImpl` (Either-returning, `src/core/buffer.ts`)
 *   - `TerminalEngine` (TaskEither-returning internal engine,
 *     `src/core/terminal.ts`); the public `TerminalIOImpl` adapts it to the
 *     promise-based `TerminalIO` contract.
 *   - `FileSystemImpl` static `*E` helpers (TaskEither engine) and canonical
 *     promise-based `FileSystem` methods (`src/core/filesystem.ts`).
 *   - `TypeGuards` / `Validators` (now in `src/core/contracts/editor.ts`).
 */

import { describe, test, expect } from "bun:test";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import {
  FileSystemImpl,
  FileSystemUtils,
} from "../../src/core/filesystem.ts";
import { TerminalEngine, TerminalUtils } from "../../src/core/terminal.ts";
import { TextBufferImpl, BufferUtils } from "../../src/core/buffer.ts";
import { TypeGuards, Validators } from "../../src/core/types.ts";
import { createFileSystemError } from "../../src/error/types.ts";

describe("Canonical Core Contracts", () => {
  test("FileSystem - should handle file operations via the TaskEither engine", async () => {
    const testPath = "./test-functional-file.txt";
    const testContent = "Hello, functional world!";

    // Clean up any existing test file
    await FileSystemImpl.removeE(testPath).run();

    // Test file existence (should not exist initially)
    const existsResult = await FileSystemImpl.existsE(testPath).run();
    expect(Either.isRight(existsResult)).toBe(true);
    if (Either.isRight(existsResult)) {
      expect(existsResult.right).toBe(false);
    }

    // Test writing file
    const writeResult = await FileSystemImpl.writeFileE(testPath, testContent).run();
    expect(Either.isRight(writeResult)).toBe(true);

    // Test reading file
    const readResult = await FileSystemImpl.readFileE(testPath).run();
    expect(Either.isRight(readResult)).toBe(true);
    if (Either.isRight(readResult)) {
      expect(readResult.right).toBe(testContent);
    }

    // Test file existence (should exist now)
    const existsResult2 = await FileSystemImpl.existsE(testPath).run();
    expect(Either.isRight(existsResult2)).toBe(true);
    if (Either.isRight(existsResult2)) {
      expect(existsResult2.right).toBe(true);
    }

    // Test atomic save with backup
    const newContent = "Updated content with backup!";
    const atomicSaveResult = await FileSystemImpl.atomicSaveE(testPath, newContent).run();
    expect(Either.isRight(atomicSaveResult)).toBe(true);
    if (Either.isRight(atomicSaveResult)) {
      expect(atomicSaveResult.right.saved).toBe(true);
      expect(atomicSaveResult.right.backupPath).toBeDefined();
    }

    // Verify new content
    const newReadResult = await FileSystemImpl.readFileE(testPath).run();
    expect(Either.isRight(newReadResult)).toBe(true);
    if (Either.isRight(newReadResult)) {
      expect(newReadResult.right).toBe(newContent);
    }

    // Clean up
    await FileSystemImpl.removeE(testPath).run();
    if (Either.isRight(atomicSaveResult) && atomicSaveResult.right.backupPath) {
      await FileSystemImpl.removeE(atomicSaveResult.right.backupPath).run();
    }
  });

  test("FileSystem - canonical promise-based methods round-trip", async () => {
    const fs = new FileSystemImpl();
    const testPath = "./test-canonical-fs.txt";

    await FileSystemImpl.removeE(testPath).run();
    await fs.writeFile(testPath, "canonical");
    expect(await fs.exists(testPath)).toBe(true);
    expect(await fs.readFile(testPath)).toBe("canonical");
    await FileSystemImpl.removeE(testPath).run();
  });

  test("FileSystem Utils - should handle JSON operations", async () => {
    const testPath = "./test-config.json";
    const testData = { theme: "dark", tabSize: 4, autoSave: true };

    // Clean up
    await FileSystemImpl.removeE(testPath).run();

    // Test writing JSON
    const writeResult = await FileSystemUtils.writeJsonFile(testPath, testData).run();
    expect(Either.isRight(writeResult)).toBe(true);

    // Test reading JSON
    const readResult = await FileSystemUtils.readJsonFile<typeof testData>(testPath).run();
    expect(Either.isRight(readResult)).toBe(true);
    if (Either.isRight(readResult)) {
      expect(readResult.right.theme).toBe("dark");
      expect(readResult.right.tabSize).toBe(4);
      expect(readResult.right.autoSave).toBe(true);
    }

    // Clean up
    await FileSystemImpl.removeE(testPath).run();
  });

  test("Terminal - engine should report size and TTY via Either", () => {
    const terminal = new TerminalEngine();

    // Test getting terminal size
    const sizeResult = terminal.getSize();
    expect(Either.isRight(sizeResult)).toBe(true);
    if (Either.isRight(sizeResult)) {
      expect(typeof sizeResult.right.width).toBe("number");
      expect(typeof sizeResult.right.height).toBe("number");
      expect(sizeResult.right.width > 0).toBe(true);
      expect(sizeResult.right.height > 0).toBe(true);
    }

    // Test TTY check - verify it doesn't throw
    const ttyResult = terminal.isStdinTTY();
    expect(Either.isRight(ttyResult)).toBe(true);
    // We don't check the value since it varies by environment (undefined in non-TTY, boolean in TTY)
  });

  test("Terminal Utils - should provide utility functions", () => {
    const terminal = new TerminalEngine();

    // Test capabilities
    const capabilities = TerminalUtils.getCapabilities(terminal);
    expect(Either.isRight(capabilities)).toBe(true);
    if (Either.isRight(capabilities)) {
      expect(capabilities.right.size).toBeDefined();
      // isTTY is present but value varies by environment
      expect("isTTY" in capabilities.right).toBe(true);
    }
  });

  test("Buffer - should handle text operations functionally", () => {
    const buffer = TextBufferImpl.create("Hello\nWorld\nFunctional!");

    // Test getting content
    const contentResult = buffer.getContent();
    expect(Either.isRight(contentResult)).toBe(true);
    if (Either.isRight(contentResult)) {
      expect(contentResult.right).toBe("Hello\nWorld\nFunctional!");
    }

    // Test getting line count
    const lineCountResult = buffer.getLineCount();
    expect(Either.isRight(lineCountResult)).toBe(true);
    if (Either.isRight(lineCountResult)) {
      expect(lineCountResult.right).toBe(3);
    }

    // Test getting specific line
    const lineResult = buffer.getLine(1);
    expect(Either.isRight(lineResult)).toBe(true);
    if (Either.isRight(lineResult)) {
      expect(lineResult.right).toBe("World");
    }

    // Test insertion
    const insertResult = buffer.insert({ line: 0, column: 5 }, " there");
    expect(Either.isRight(insertResult)).toBe(true);
    if (Either.isRight(insertResult)) {
      const newContent = insertResult.right.getContent();
      if (Either.isRight(newContent)) {
        expect(newContent.right).toBe("Hello there\nWorld\nFunctional!");
      }
    }

    // Test stats
    const statsResult = buffer.getStats();
    expect(Either.isRight(statsResult)).toBe(true);
    if (Either.isRight(statsResult)) {
      expect(statsResult.right.lines).toBe(3);
      expect(statsResult.right.characters).toBe(23); // "Hello\nWorld\nFunctional!" = 23 chars
      expect(statsResult.right.words).toBe(3);
    }
  });

  test("Buffer Utils - should provide utility functions", () => {
    const content = "Hello world\nThis is a test\nFunctional programming";
    const buffer = TextBufferImpl.create(content);

    // Test finding all occurrences
    const findResult = BufferUtils.findAll(buffer, "is");
    expect(Either.isRight(findResult)).toBe(true);
    if (Either.isRight(findResult)) {
      expect(findResult.right.length).toBe(2);
      expect(findResult.right[0]?.line).toBe(1);
      expect(findResult.right[0]?.column).toBe(2);
    }

    // Test getting word at position
    const wordResult = BufferUtils.getWordAt(buffer, { line: 1, column: 5 });
    expect(Either.isRight(wordResult)).toBe(true);
    if (Either.isRight(wordResult)) {
      expect(wordResult.right).toBe("is");
    }

    // Test validation
    const validationResult = BufferUtils.validate(buffer);
    expect(Either.isRight(validationResult)).toBe(true);
    if (Either.isRight(validationResult)) {
      expect(validationResult.right.valid).toBe(true);
      expect(validationResult.right.issues.length).toBe(0);
    }
  });

  test("Type Guards - should validate types correctly", () => {
    // Test position validation
    expect(TypeGuards.isPosition({ line: 5, column: 10 })).toBe(true);
    expect(TypeGuards.isPosition({ line: -1, column: 10 })).toBe(true); // Guard doesn't check validity
    expect(TypeGuards.isPosition({ line: 5 })).toBe(false);
    expect(TypeGuards.isPosition("not a position")).toBe(false);

    // Test range validation
    const validRange = {
      start: { line: 0, column: 0 },
      end: { line: 1, column: 5 }
    };
    expect(TypeGuards.isRange(validRange)).toBe(true);
    expect(TypeGuards.isRange({ start: { line: 0, column: 0 } })).toBe(false);

    // Test terminal size validation
    expect(TypeGuards.isTerminalSize({ width: 80, height: 24 })).toBe(true);
    expect(TypeGuards.isTerminalSize({ width: 80 })).toBe(false);
  });

  test("Validators - should validate business logic", () => {
    // Test position validation
    const validPos = Validators.position({ line: 5, column: 10 });
    expect(Either.isRight(validPos)).toBe(true);

    const invalidPos = Validators.position({ line: -1, column: 10 });
    expect(Either.isLeft(invalidPos)).toBe(true);

    // Test range validation
    const validRange = Validators.range({
      start: { line: 0, column: 0 },
      end: { line: 1, column: 5 }
    });
    expect(Either.isRight(validRange)).toBe(true);

    const invalidRange = Validators.range({
      start: { line: 1, column: 5 },
      end: { line: 0, column: 0 }
    });
    expect(Either.isLeft(invalidRange)).toBe(true);

    // Test editor config validation
    const validConfig = Validators.editorConfig({
      theme: "dark",
      tabSize: 4,
      autoSave: true
    });
    expect(Either.isRight(validConfig)).toBe(true);
    if (Either.isRight(validConfig)) {
      expect(validConfig.right.theme).toBe("dark");
      expect(validConfig.right.tabSize).toBe(4);
      expect(validConfig.right.maxUndoLevels).toBe(100); // Default value
    }

    const invalidConfig = Validators.editorConfig({
      tabSize: 10 // Invalid tab size
    });
    expect(Either.isLeft(invalidConfig)).toBe(true);
  });

  test("Error handling - should properly handle errors", async () => {
    // Test reading non-existent file via the TaskEither engine
    const readResult = await FileSystemImpl.readFileE("./non-existent-file.txt").run();
    expect(Either.isLeft(readResult)).toBe(true);
    if (Either.isLeft(readResult)) {
      expect(readResult.left.message).toContain("Failed to read file");
    }

    // Test invalid buffer operations
    const buffer = TextBufferImpl.create("test");
    const invalidLineResult = buffer.getLine(10);
    expect(Either.isLeft(invalidLineResult)).toBe(true);

    const invalidInsertResult = buffer.insert({ line: -1, column: 0 }, "text");
    expect(Either.isLeft(invalidInsertResult)).toBe(true);
  });

  test("Functional composition - should compose operations", async () => {
    const testPath = "./test-composition.txt";
    const originalContent = "Original content";
    const updatedContent = "Updated content";

    // Clean up
    await FileSystemImpl.removeE(testPath).run();

    // Compose operations against the engine's TaskEither helpers:
    // write -> read -> verify -> update -> read
    const composedOperation = FileSystemImpl.writeFileE(testPath, originalContent)
      .flatMap(() => FileSystemImpl.readFileE(testPath))
      .flatMap(content => {
        if (content === originalContent) {
          return FileSystemImpl.writeFileE(testPath, updatedContent);
        }
        return TaskEither.left(createFileSystemError("WriteError", "Content verification failed", testPath));
      })
      .flatMap(() => FileSystemImpl.readFileE(testPath));

    const result = await composedOperation.run();
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toBe(updatedContent);
    }

    // Clean up
    await FileSystemImpl.removeE(testPath).run();
  });

  test("Parallel operations - should handle multiple files", async () => {
    const files = [
      { path: "./test-parallel-1.txt", content: "File 1" },
      { path: "./test-parallel-2.txt", content: "File 2" },
      { path: "./test-parallel-3.txt", content: "File 3" }
    ];

    // Clean up
    for (const file of files) {
      await FileSystemImpl.removeE(file.path).run();
    }

    // Write all files in parallel via the engine helpers
    const writeOperations = files.map(file =>
      FileSystemImpl.writeFileE(file.path, file.content)
    );

    const writeResults = await TaskEither.parallel(writeOperations).run();
    expect(Either.isRight(writeResults)).toBe(true);

    // Read all files in parallel using utility function
    const readResult = await FileSystemUtils.readFiles(files.map(f => f.path)).run();
    expect(Either.isRight(readResult)).toBe(true);
    if (Either.isRight(readResult)) {
      expect(readResult.right.length).toBe(3);
      expect(readResult.right[0]?.content).toBe("File 1");
      expect(readResult.right[1]?.content).toBe("File 2");
      expect(readResult.right[2]?.content).toBe("File 3");
    }

    // Clean up
    for (const file of files) {
      await FileSystemImpl.removeE(file.path).run();
    }
  });
});
