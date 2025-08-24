/**
 * @file core-functional.test.ts
 * @description Tests for functional core modules
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Either, TaskEither } from "../../src/utils/task-either.ts";
import { FunctionalFileSystemImpl, FunctionalFileSystemUtils as FileSystemUtils } from "../../src/core/filesystem.ts";
import { FunctionalTerminalIOImpl, FunctionalTerminalUtils as TerminalUtils } from "../../src/core/terminal.ts";
import { FunctionalTextBufferImpl, FunctionalBufferUtils as BufferUtils } from "../../src/core/buffer.ts";
import { TypeGuards, Validators } from "../../src/core/types.ts";

Deno.test("Functional Core Modules", async (t) => {
  
  await t.step("FileSystem - should handle file operations functionally", async () => {
    const fs = new FunctionalFileSystemImpl();
    const testPath = "./test-functional-file.txt";
    const testContent = "Hello, functional world!";
    
    // Clean up any existing test file
    await fs.remove(testPath).run();
    
    // Test file existence (should not exist initially)
    const existsResult = await fs.exists(testPath).run();
    assertEquals(Either.isRight(existsResult), true);
    if (Either.isRight(existsResult)) {
      assertEquals(existsResult.right, false);
    }
    
    // Test writing file
    const writeResult = await fs.writeFile(testPath, testContent).run();
    assertEquals(Either.isRight(writeResult), true);
    
    // Test reading file
    const readResult = await fs.readFile(testPath).run();
    assertEquals(Either.isRight(readResult), true);
    if (Either.isRight(readResult)) {
      assertEquals(readResult.right, testContent);
    }
    
    // Test file existence (should exist now)
    const existsResult2 = await fs.exists(testPath).run();
    assertEquals(Either.isRight(existsResult2), true);
    if (Either.isRight(existsResult2)) {
      assertEquals(existsResult2.right, true);
    }
    
    // Test atomic save with backup
    const newContent = "Updated content with backup!";
    const atomicSaveResult = await fs.atomicSave(testPath, newContent).run();
    assertEquals(Either.isRight(atomicSaveResult), true);
    if (Either.isRight(atomicSaveResult)) {
      assertEquals(atomicSaveResult.right.saved, true);
      assertExists(atomicSaveResult.right.backupPath);
    }
    
    // Verify new content
    const newReadResult = await fs.readFile(testPath).run();
    assertEquals(Either.isRight(newReadResult), true);
    if (Either.isRight(newReadResult)) {
      assertEquals(newReadResult.right, newContent);
    }
    
    // Clean up
    await fs.remove(testPath).run();
    if (Either.isRight(atomicSaveResult) && atomicSaveResult.right.backupPath) {
      await fs.remove(atomicSaveResult.right.backupPath).run();
    }
  });

  await t.step("FileSystem Utils - should handle JSON operations", async () => {
    const testPath = "./test-config.json";
    const testData = { theme: "dark", tabSize: 4, autoSave: true };
    
    // Clean up
    await new FunctionalFileSystemImpl().remove(testPath).run();
    
    // Test writing JSON
    const writeResult = await FileSystemUtils.writeJsonFile(testPath, testData).run();
    assertEquals(Either.isRight(writeResult), true);
    
    // Test reading JSON
    const readResult = await FileSystemUtils.readJsonFile<typeof testData>(testPath).run();
    assertEquals(Either.isRight(readResult), true);
    if (Either.isRight(readResult)) {
      assertEquals(readResult.right.theme, "dark");
      assertEquals(readResult.right.tabSize, 4);
      assertEquals(readResult.right.autoSave, true);
    }
    
    // Clean up
    await new FunctionalFileSystemImpl().remove(testPath).run();
  });

  await t.step("Terminal - should handle operations functionally", () => {
    const terminal = new FunctionalTerminalIOImpl();
    
    // Test getting terminal size
    const sizeResult = terminal.getSize();
    assertEquals(Either.isRight(sizeResult), true);
    if (Either.isRight(sizeResult)) {
      assertEquals(typeof sizeResult.right.width, "number");
      assertEquals(typeof sizeResult.right.height, "number");
      assertEquals(sizeResult.right.width > 0, true);
      assertEquals(sizeResult.right.height > 0, true);
    }
    
    // Test TTY check
    const ttyResult = terminal.isStdinTTY();
    assertEquals(Either.isRight(ttyResult), true);
    if (Either.isRight(ttyResult)) {
      assertEquals(typeof ttyResult.right, "boolean");
    }
  });

  await t.step("Terminal Utils - should provide utility functions", async () => {
    const terminal = new FunctionalTerminalIOImpl();
    
    // Test capabilities
    const capabilities = TerminalUtils.getCapabilities(terminal);
    assertEquals(Either.isRight(capabilities), true);
    if (Either.isRight(capabilities)) {
      assertExists(capabilities.right.size);
      assertEquals(typeof capabilities.right.isTTY, "boolean");
    }
  });

  await t.step("Buffer - should handle text operations functionally", () => {
    const buffer = FunctionalTextBufferImpl.create("Hello\nWorld\nFunctional!");
    
    // Test getting content
    const contentResult = buffer.getContent();
    assertEquals(Either.isRight(contentResult), true);
    if (Either.isRight(contentResult)) {
      assertEquals(contentResult.right, "Hello\nWorld\nFunctional!");
    }
    
    // Test getting line count
    const lineCountResult = buffer.getLineCount();
    assertEquals(Either.isRight(lineCountResult), true);
    if (Either.isRight(lineCountResult)) {
      assertEquals(lineCountResult.right, 3);
    }
    
    // Test getting specific line
    const lineResult = buffer.getLine(1);
    assertEquals(Either.isRight(lineResult), true);
    if (Either.isRight(lineResult)) {
      assertEquals(lineResult.right, "World");
    }
    
    // Test insertion
    const insertResult = buffer.insert({ line: 0, column: 5 }, " there");
    assertEquals(Either.isRight(insertResult), true);
    if (Either.isRight(insertResult)) {
      const newContent = insertResult.right.getContent();
      if (Either.isRight(newContent)) {
        assertEquals(newContent.right, "Hello there\nWorld\nFunctional!");
      }
    }
    
    // Test stats
    const statsResult = buffer.getStats();
    assertEquals(Either.isRight(statsResult), true);
    if (Either.isRight(statsResult)) {
      assertEquals(statsResult.right.lines, 3);
      assertEquals(statsResult.right.characters, 23); // "Hello\nWorld\nFunctional!" = 23 chars
      assertEquals(statsResult.right.words, 3);
    }
  });

  await t.step("Buffer Utils - should provide utility functions", () => {
    const content = "Hello world\nThis is a test\nFunctional programming";
    const buffer = FunctionalTextBufferImpl.create(content);
    
    // Test finding all occurrences
    const findResult = BufferUtils.findAll(buffer, "is");
    assertEquals(Either.isRight(findResult), true);
    if (Either.isRight(findResult)) {
      assertEquals(findResult.right.length, 2);
      assertEquals(findResult.right[0]?.line, 1);
      assertEquals(findResult.right[0]?.column, 2);
    }
    
    // Test getting word at position
    const wordResult = BufferUtils.getWordAt(buffer, { line: 1, column: 5 });
    assertEquals(Either.isRight(wordResult), true);
    if (Either.isRight(wordResult)) {
      assertEquals(wordResult.right, "is");
    }
    
    // Test validation
    const validationResult = BufferUtils.validate(buffer);
    assertEquals(Either.isRight(validationResult), true);
    if (Either.isRight(validationResult)) {
      assertEquals(validationResult.right.valid, true);
      assertEquals(validationResult.right.issues.length, 0);
    }
  });

  await t.step("Type Guards - should validate types correctly", () => {
    // Test position validation
    assertEquals(TypeGuards.isPosition({ line: 5, column: 10 }), true);
    assertEquals(TypeGuards.isPosition({ line: -1, column: 10 }), true); // Guard doesn't check validity
    assertEquals(TypeGuards.isPosition({ line: 5 }), false);
    assertEquals(TypeGuards.isPosition("not a position"), false);
    
    // Test range validation
    const validRange = {
      start: { line: 0, column: 0 },
      end: { line: 1, column: 5 }
    };
    assertEquals(TypeGuards.isRange(validRange), true);
    assertEquals(TypeGuards.isRange({ start: { line: 0, column: 0 } }), false);
    
    // Test terminal size validation
    assertEquals(TypeGuards.isTerminalSize({ width: 80, height: 24 }), true);
    assertEquals(TypeGuards.isTerminalSize({ width: 80 }), false);
  });

  await t.step("Validators - should validate business logic", () => {
    // Test position validation
    const validPos = Validators.position({ line: 5, column: 10 });
    assertEquals(Either.isRight(validPos), true);
    
    const invalidPos = Validators.position({ line: -1, column: 10 });
    assertEquals(Either.isLeft(invalidPos), true);
    
    // Test range validation
    const validRange = Validators.range({
      start: { line: 0, column: 0 },
      end: { line: 1, column: 5 }
    });
    assertEquals(Either.isRight(validRange), true);
    
    const invalidRange = Validators.range({
      start: { line: 1, column: 5 },
      end: { line: 0, column: 0 }
    });
    assertEquals(Either.isLeft(invalidRange), true);
    
    // Test editor config validation
    const validConfig = Validators.editorConfig({
      theme: "dark",
      tabSize: 4,
      autoSave: true
    });
    assertEquals(Either.isRight(validConfig), true);
    if (Either.isRight(validConfig)) {
      assertEquals(validConfig.right.theme, "dark");
      assertEquals(validConfig.right.tabSize, 4);
      assertEquals(validConfig.right.maxUndoLevels, 100); // Default value
    }
    
    const invalidConfig = Validators.editorConfig({
      tabSize: 10 // Invalid tab size
    });
    assertEquals(Either.isLeft(invalidConfig), true);
  });

  await t.step("Error handling - should properly handle errors", async () => {
    const fs = new FunctionalFileSystemImpl();
    
    // Test reading non-existent file
    const readResult = await fs.readFile("./non-existent-file.txt").run();
    assertEquals(Either.isLeft(readResult), true);
    if (Either.isLeft(readResult)) {
      assertEquals(readResult.left.includes("Failed to read file"), true);
    }
    
    // Test invalid buffer operations
    const buffer = FunctionalTextBufferImpl.create("test");
    const invalidLineResult = buffer.getLine(10);
    assertEquals(Either.isLeft(invalidLineResult), true);
    
    const invalidInsertResult = buffer.insert({ line: -1, column: 0 }, "text");
    assertEquals(Either.isLeft(invalidInsertResult), true);
  });

  await t.step("Functional composition - should compose operations", async () => {
    const fs = new FunctionalFileSystemImpl();
    const testPath = "./test-composition.txt";
    const originalContent = "Original content";
    const updatedContent = "Updated content";
    
    // Clean up
    await fs.remove(testPath).run();
    
    // Compose operations: write -> read -> verify -> update -> read
    const composedOperation = fs.writeFile(testPath, originalContent)
      .flatMap(() => fs.readFile(testPath))
      .flatMap(content => {
        if (content === originalContent) {
          return fs.writeFile(testPath, updatedContent);
        }
        return TaskEither.left("Content verification failed");
      })
      .flatMap(() => fs.readFile(testPath));
    
    const result = await composedOperation.run();
    assertEquals(Either.isRight(result), true);
    if (Either.isRight(result)) {
      assertEquals(result.right, updatedContent);
    }
    
    // Clean up
    await fs.remove(testPath).run();
  });

  await t.step("Parallel operations - should handle multiple files", async () => {
    const fs = new FunctionalFileSystemImpl();
    const files = [
      { path: "./test-parallel-1.txt", content: "File 1" },
      { path: "./test-parallel-2.txt", content: "File 2" },
      { path: "./test-parallel-3.txt", content: "File 3" }
    ];
    
    // Clean up
    for (const file of files) {
      await fs.remove(file.path).run();
    }
    
    // Write all files in parallel
    const writeOperations = files.map(file => 
      fs.writeFile(file.path, file.content)
    );
    
    const writeResults = await TaskEither.parallel(writeOperations).run();
    assertEquals(Either.isRight(writeResults), true);
    
    // Read all files in parallel using utility function
    const readResult = await FileSystemUtils.readFiles(files.map(f => f.path)).run();
    assertEquals(Either.isRight(readResult), true);
    if (Either.isRight(readResult)) {
      assertEquals(readResult.right.length, 3);
      assertEquals(readResult.right[0]?.content, "File 1");
      assertEquals(readResult.right[1]?.content, "File 2");
      assertEquals(readResult.right[2]?.content, "File 3");
    }
    
    // Clean up
    for (const file of files) {
      await fs.remove(file.path).run();
    }
  });
});